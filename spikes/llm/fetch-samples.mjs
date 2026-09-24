// Phase 0 spike, step 1: fetch a mixed set of real receipt PDFs for the extraction test.
//
//   pnpm spike:llm-samples
//
// Read-only IMAP. Only the PDF parts of the selected mails are downloaded, into
// spikes/llm/out/samples/ (git-ignored), with a manifest.json next to them.

import { ImapFlow } from 'imapflow'
import { mkdir, writeFile } from 'node:fs/promises'

process.loadEnvFile(new URL('../../.env', import.meta.url))
const { IMAP_HOST, IMAP_PORT = '993', IMAP_USER, IMAP_PASSWORD } = process.env

// One query per kind of document we want to see: invoices, a direct-debit notice, a reminder,
// card receipts, travel tickets. `max` caps how many mails each query contributes.
const since = new Date(Date.UTC(2026, 7, 1))
const QUERIES = [
  { label: 'sage', q: { from: 'sage.com' }, max: 2 },
  { label: 'easyname', q: { from: 'easyname.com' }, max: 1 },
  { label: 'hetzner', q: { from: 'hetzner.com' }, max: 1 },
  { label: 'anthropic', q: { from: 'invoice+statements@mail.anthropic.com' }, max: 1 },
  { label: 'cyberport', q: { from: 'cyberport.de' }, max: 1 },
  { label: 'flixbus', q: { from: 'fs.flixbus.com' }, max: 1 },
  { label: 'bahn', q: { from: 'deutschebahn.com' }, max: 1 },
  { label: 'advanzia', q: { from: 'advanzia.com' }, max: 1 },
]

const outDir = new URL('./out/samples/', import.meta.url)
await mkdir(outDir, { recursive: true })

const client = new ImapFlow({
  host: IMAP_HOST,
  port: Number(IMAP_PORT),
  secure: Number(IMAP_PORT) === 993,
  auth: { user: IMAP_USER, pass: IMAP_PASSWORD },
  logger: false,
})
await client.connect()
const manifest = []
try {
  await client.mailboxOpen('INBOX', { readOnly: true })
  for (const { label, q, max } of QUERIES) {
    const uids = await client.search({ since, ...q }, { uid: true })
    if (!Array.isArray(uids)) throw new Error(`search ${label} failed`)
    let taken = 0
    for (const uid of uids) {
      if (taken >= max) break
      const msg = await client.fetchOne(uid, { envelope: true, bodyStructure: true }, { uid: true })
      const parts = attachments(msg.bodyStructure)
      let saved = 0
      for (const p of parts) {
        const { content } = await client.download(uid, p.part, { uid: true })
        const buf = Buffer.concat(await Array.fromAsync(content))
        // Many PDFs arrive as application/octet-stream: trust the bytes, not the MIME type.
        if (buf.subarray(0, 5).toString() !== '%PDF-') continue
        const file = `${label}-${uid}-${saved + 1}.pdf`
        await writeFile(new URL(file, outDir), buf)
        manifest.push({ file, label, uid, date: msg.envelope.date, from: msg.envelope.from?.[0]?.address, subject: msg.envelope.subject, name: p.name, bytes: buf.length })
        saved++
      }
      if (saved) taken++
    }
    console.log(`${label}: ${taken} mail(s)`)
  }
} finally {
  await client.logout()
}
await writeFile(new URL('manifest.json', outDir), JSON.stringify(manifest, null, 2))
console.log(`${manifest.length} PDF(s) in ${outDir.pathname}`)

function attachments(node, out = []) {
  if (!node) return out
  const name = node.dispositionParameters?.filename ?? node.parameters?.name
  if (name && node.part) out.push({ part: node.part, name })
  for (const child of node.childNodes ?? []) attachments(child, out)
  return out
}
