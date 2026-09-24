// Phase 0 spike: can we list receipt mails over IMAP, and what do their attachments look like?
//
// Usage: fill in .env in the repo root (see .env.example), then
//   pnpm spike:imap                  # last 30 mails
//   pnpm spike:imap -- --last 100
//
// The mailbox is opened read-only: no mail is marked as read, moved or deleted.
// Only headers and the MIME structure are fetched, never bodies.

import { ImapFlow } from 'imapflow'

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  fail('No .env in the repo root. Copy .env.example to .env and fill in the IMAP_* values.')
}

const { IMAP_HOST, IMAP_PORT = '993', IMAP_USER, IMAP_PASSWORD, IMAP_MAILBOX = 'INBOX' } = process.env
if (!IMAP_HOST || !IMAP_USER || !IMAP_PASSWORD) fail('IMAP_HOST, IMAP_USER and IMAP_PASSWORD must be set in .env.')
const last = Number(argValue('--last') ?? 30)

const client = new ImapFlow({
  host: IMAP_HOST,
  port: Number(IMAP_PORT),
  secure: Number(IMAP_PORT) === 993,
  auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
  logger: false,
})

try {
  await client.connect()
} catch (e) {
  fail(`Cannot log in to ${IMAP_HOST}:${IMAP_PORT} as ${IMAP_USER}: ${e.responseText ?? e.message}`)
}

try {
  const folders = await client.list()
  console.log(`Folders: ${folders.map((f) => f.path).join(' · ')}\n`)

  const box = await client.mailboxOpen(IMAP_MAILBOX, { readOnly: true })
  console.log(`${IMAP_MAILBOX}: ${box.exists} mail(s), showing the last ${Math.min(last, box.exists)}\n`)
  if (!box.exists) process.exit(0)

  const from = Math.max(1, box.exists - last + 1)
  const stats = { mails: 0, withPdf: 0, withImage: 0, withoutAttachment: 0 }
  for await (const msg of client.fetch(`${from}:*`, { envelope: true, bodyStructure: true })) {
    stats.mails++
    const files = attachments(msg.bodyStructure)
    if (files.some((f) => f.type === 'application/pdf')) stats.withPdf++
    if (files.some((f) => f.type.startsWith('image/'))) stats.withImage++
    if (!files.length) stats.withoutAttachment++

    const sender = msg.envelope.from?.[0]?.address ?? '?'
    const date = msg.envelope.date?.toISOString().slice(0, 10) ?? '?'
    console.log(`${date}  ${sender}\n            ${truncate(msg.envelope.subject ?? '', 80)}`)
    for (const f of files) console.log(`            📎 ${f.name} (${f.type}, ${Math.round(f.size / 1024)} KB)`)
  }
  console.log(`\n${stats.mails} mails · ${stats.withPdf} with PDF · ${stats.withImage} with image · ${stats.withoutAttachment} without attachment`)
  console.log('Mails without attachment can still be receipts (HTML invoices, download links) – that is what the LLM filter has to judge.')
} finally {
  await client.logout()
}

// --- helpers ---------------------------------------------------------------

function attachments(node, out = []) {
  if (!node) return out
  const name = node.dispositionParameters?.filename ?? node.parameters?.name
  if (name || node.disposition === 'attachment') out.push({ name: name ?? '(unnamed)', type: node.type, size: node.size ?? 0 })
  for (const child of node.childNodes ?? []) attachments(child, out)
  return out
}

function truncate(s, n) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
