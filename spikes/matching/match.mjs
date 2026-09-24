// Phase 0 spike: match extracted receipts (spikes/llm) against bank transactions (spikes/hibiscus).
//
//   pnpm spike:match
//
// Reads the newest out/extract-*.json and out/hibiscus-*.json. Scores every receipt against
// every transaction and prints the best candidates with the reasons. Nothing is sent anywhere.
// Bookings that never get a receipt (own transfers, bank fees) are classified separately.

import { readdir, readFile } from 'node:fs/promises'

const receipts = await newest('../llm/out/', 'extract-')
const bank = await newest('../hibiscus/out/', 'hibiscus-')
const OWN = /\ble\s*space\b/i // own company as counterparty: a transfer between own accounts

const tx = Object.values(bank.umsaetze).flat().map((u) => ({
  id: u.id,
  date: u.datum,
  amount: parseAmount(u.betrag),
  name: u.empfaenger_name ?? '',
  art: u.art ?? '',
  text: `${u.zweck_raw ?? ''} ${u.endtoendid ?? ''}`,
}))

// Receipts: the flash answer, or v4-pro where flash failed
const docs = receipts
  .map((r) => ({ file: r.file, d: r['deepseek-flash']?.data ?? r['deepseek-v4-pro']?.data }))
  .filter((r) => r.d)

console.log(`${docs.length} receipts × ${tx.length} bank transactions\n`)
const used = new Set()
for (const { file, d } of docs) {
  const ranked = tx
    .map((t) => ({ t, ...score(d, t) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
  const best = ranked[0]
  const second = ranked[1]
  const head = `${file.padEnd(24)} ${d.document_type.padEnd(19)} ${String(d.gross).padStart(8)} ${d.currency} ${d.vendor}`
  if (!best || best.score < 50) {
    console.log(`${head}\n   ✗ no match${best ? ` (best ${best.score}: ${best.t.date} ${best.t.amount} ${best.t.name})` : ''}`)
    continue
  }
  const clear = !second || best.score - second.score >= 30
  if (d.document_type !== 'payment_reminder') used.add(best.t.id)
  console.log(`${head}\n   ${clear ? '✓' : '?'} ${best.score} → ${best.t.date} ${best.t.amount.toFixed(2)} ${best.t.name} [${best.why.join(', ')}]`)
  if (!clear) console.log(`     runner-up ${second.score} → ${second.t.date} ${second.t.amount.toFixed(2)} ${second.t.name} [${second.why.join(', ')}]`)
}

console.log('\nTransactions without a receipt:')
for (const t of tx.filter((t) => !used.has(t.id))) {
  console.log(`  ${t.date} ${t.amount.toFixed(2).padStart(9)}  ${t.name.slice(0, 30).padEnd(30)} → ${classify(t)}`)
}

// --- scoring ---------------------------------------------------------------

function score(d, t) {
  const why = []
  let s = 0
  const text = norm(t.text)
  const gross = Math.abs(Number(d.gross))
  if (Math.abs(Math.abs(t.amount) - gross) < 0.005) (s += 40), why.push('amount')
  if (d.invoice_number && norm(d.invoice_number).length >= 5 && text.includes(norm(d.invoice_number))) (s += 50), why.push('invoice no.')
  if (d.customer_number && norm(d.customer_number).length >= 5 && text.includes(norm(d.customer_number))) (s += 20), why.push('customer no.')
  const iban = t.text.match(/IBAN:\s*([A-Z]{2}\d{2}[A-Z0-9]{10,30})/)?.[1]
  if (d.iban_last4 && iban?.endsWith(d.iban_last4)) (s += 15), why.push('vendor IBAN')
  if (sameVendor(d.vendor, t.name)) (s += 20), why.push('vendor')
  // date: bookings come after the invoice, usually before or shortly after the due date
  const from = d.invoice_date ? days(d.invoice_date) - 5 : null
  const to = days(d.due_or_debit_date ?? d.invoice_date ?? t.date) + 10
  if (from != null && days(t.date) >= from && days(t.date) <= to) (s += 10), why.push('date')
  else if (from != null && Math.abs(days(t.date) - from) > 60) s -= 30
  // money went out for an invoice; incoming money needs an outgoing invoice
  if (t.amount > 0 && d.document_type !== 'other') s -= 40
  return { score: s, why }
}

function classify(t) {
  if (/abschluss|mehrwertsteuerbelast|entgelt/i.test(t.art)) return 'bank fee – the account statement is the receipt'
  if (OWN.test(t.name)) return 'own transfer (neutral account 1360) – no receipt'
  if (/darlehen/i.test(t.text)) return 'loan – the contract is the receipt'
  if (t.amount > 0) return 'incoming – look for our outgoing invoice (Sent folder)'
  return 'missing receipt – search accounting mail, then the private mailbox'
}

function sameVendor(a = '', b = '') {
  const stop = new Set(['gmbh', 'ag', 'se', 'sa', 'inc', 'ltd', 'pbc', 'online', 'germany', 'europe', 'und', 'co', 'kg'])
  const words = (s) => norm(s, ' ').split(' ').filter((w) => w.length > 2 && !stop.has(w))
  const wb = new Set(words(b))
  return words(a).some((w) => wb.has(w))
}

function norm(s, keep = '') {
  return String(s)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(keep ? /[^a-z0-9]+/g : /[^a-z0-9]/g, keep)
    .trim()
}

function days(iso) {
  return Date.parse(`${iso}T00:00:00Z`) / 864e5
}

function parseAmount(v) {
  return typeof v === 'number' ? v : Number(String(v).replace(/\./g, '').replace(',', '.'))
}

async function newest(dir, prefix) {
  const url = new URL(dir, import.meta.url)
  const files = (await readdir(url)).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort()
  if (!files.length) throw new Error(`no ${prefix}*.json in ${url.pathname} – run the other spikes first`)
  return JSON.parse(await readFile(new URL(files.at(-1), url), 'utf8'))
}
