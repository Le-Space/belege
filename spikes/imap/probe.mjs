// Phase 0 spike: can we list receipt mails over IMAP, and what do their attachments look like?
//
// Usage: fill in .env in the repo root (see .env.example), then
//   pnpm spike:imap                          # last 30 mails in IMAP_MAILBOX
//   pnpm spike:imap -- --last 100
//   pnpm spike:imap -- --month 2026-08       # everything that arrived in August 2026
//   pnpm spike:imap -- --month 2026-08 --folder Sent
//   pnpm spike:imap -- --month 2026-08 --all-folders
//
// --all-folders skips Trash, Junk and Drafts but keeps Sent: outgoing invoices are how
// customers get found. The month filter uses the arrival date on the server.
//
// Every folder is opened read-only: no mail is marked as read, moved or deleted.
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
const month = argValue('--month')
if (month && !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail('--month expects YYYY-MM, e.g. --month 2026-08')
const range = month ? monthRange(month) : null

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

const total = { mails: 0, withPdf: 0, withImage: 0, withoutAttachment: 0 }
try {
  const folders = await client.list()
  console.log(`Folders: ${folders.map((f) => f.path).join(' · ')}\n`)

  const skip = new Set(['\\Trash', '\\Junk', '\\Drafts'])
  const targets = process.argv.includes('--all-folders')
    ? folders.filter((f) => !skip.has(f.specialUse) && !f.flags?.has('\\Noselect')).map((f) => f.path)
    : [argValue('--folder') ?? IMAP_MAILBOX]

  for (const folder of targets) await listFolder(folder)
  if (targets.length > 1) console.log(`\nAll folders: ${summary(total)}`)
  console.log('Mails without attachment can still be receipts (HTML invoices, download links) – that is what the LLM filter has to judge.')
} finally {
  await client.logout()
}

async function listFolder(folder) {
  const box = await client.mailboxOpen(folder, { readOnly: true })
  let uids
  if (range) {
    uids = box.exists ? await client.search({ since: range.since, before: range.before }, { uid: true }) : []
    console.log(`── ${folder}: ${uids.length} mail(s) in ${month}`)
  } else {
    const all = box.exists ? await client.search({ all: true }, { uid: true }) : []
    uids = all.slice(-last)
    console.log(`── ${folder}: ${box.exists} mail(s), showing the last ${uids.length}`)
  }
  if (!uids.length) return console.log('')

  const stats = { mails: 0, withPdf: 0, withImage: 0, withoutAttachment: 0 }
  const rows = []
  for await (const msg of client.fetch(uids, { envelope: true, bodyStructure: true, internalDate: true }, { uid: true })) {
    rows.push(msg)
  }
  rows.sort((a, b) => (a.internalDate ?? 0) - (b.internalDate ?? 0))
  for (const msg of rows) {
    const files = attachments(msg.bodyStructure)
    count(stats, files)
    count(total, files)
    const party = folder === 'Sent' || msg.envelope.from?.[0]?.address === IMAP_USER
      ? `→ ${msg.envelope.to?.[0]?.address ?? '?'}`
      : msg.envelope.from?.[0]?.address ?? '?'
    const date = (msg.envelope.date ?? msg.internalDate)?.toISOString().slice(0, 10) ?? '?'
    console.log(`${date}  ${party}\n            ${truncate(msg.envelope.subject ?? '', 80)}`)
    for (const f of files) console.log(`            📎 ${f.name} (${f.type}, ${Math.round(f.size / 1024)} KB)`)
  }
  console.log(`   ${summary(stats)}\n`)
}

// --- helpers ---------------------------------------------------------------

function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number)
  return { since: new Date(Date.UTC(y, m - 1, 1)), before: new Date(Date.UTC(y, m, 1)) }
}

function count(stats, files) {
  stats.mails++
  if (files.some((f) => f.type === 'application/pdf')) stats.withPdf++
  if (files.some((f) => f.type.startsWith('image/'))) stats.withImage++
  if (!files.length) stats.withoutAttachment++
}

function summary(s) {
  return `${s.mails} mails · ${s.withPdf} with PDF · ${s.withImage} with image · ${s.withoutAttachment} without attachment`
}

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
