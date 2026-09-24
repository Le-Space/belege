// Phase 0 spike, step 2: extract receipt data from the fetched PDFs with two models and compare.
//
//   pnpm spike:llm-extract -- --dry-run                   # text + redaction only, nothing sent
//   pnpm spike:llm-extract                                # deepseek-flash and deepseek-v4-pro
//   pnpm spike:llm-extract -- --models deepseek-flash --only hetzner
//
// Only redacted text leaves the machine: IBANs (last four digits kept, they help matching),
// e-mail addresses of our own domain, street and postcode lines, and every term in
// REDACT_TERMS (semicolon-separated, e.g. our own name). The redacted text is written to
// out/redacted/ so it can be checked before and after a run.

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { extractText, getDocumentProxy } from 'unpdf'

process.loadEnvFile(new URL('../../.env', import.meta.url))
const { DEEPSEEK_API_KEY: key, DEEPSEEK_BASE_URL: base = 'https://api.deepseek.com', IMAP_USER = '', REDACT_TERMS = '' } = process.env
const dryRun = process.argv.includes('--dry-run')
const models = (argValue('--models') ?? 'deepseek-flash,deepseek-v4-pro').split(',')
const only = argValue('--only')
if (!dryRun && !key) fail('DEEPSEEK_API_KEY is not set in .env.')

const sampleDir = new URL('./out/samples/', import.meta.url)
const redactedDir = new URL('./out/redacted/', import.meta.url)
await mkdir(redactedDir, { recursive: true })
const manifest = JSON.parse(await readFile(new URL('manifest.json', sampleDir), 'utf8')).filter((m) => !only || m.label === only)

const SYSTEM = `You extract bookkeeping data from German or English receipts for a German company (UG).
Answer with one JSON object and nothing else, using exactly these keys (null when not present):
{
  "document_type": "invoice" | "receipt" | "direct_debit_notice" | "payment_reminder" | "credit_card_statement" | "ticket" | "other",
  "vendor": string,                 // the company that issued the document
  "vendor_vat_id": string | null,
  "invoice_number": string | null,
  "customer_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "due_or_debit_date": "YYYY-MM-DD" | null,
  "service_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" } | null,
  "currency": "EUR" | ...,
  "net": number | null,
  "vat": [ { "rate": number, "amount": number } ],
  "gross": number,                  // the amount that is or was paid; negative for credit notes
  "payment": "direct_debit" | "card" | "paypal" | "bank_transfer" | "paid" | "open" | null,
  "iban_last4": string | null,      // from a redacted IBAN like [IBAN …1234]
  "reverse_charge": boolean,        // no German VAT because the vendor is abroad (§13b UStG)
  "travel": { "from": string, "to": string, "departure": "YYYY-MM-DDTHH:MM" | null } | null,
  "summary": string                 // what was bought, max 12 words, German
}
Amounts are numbers with a dot as decimal separator. Never guess a value that is not in the text.`

const results = []
for (const m of manifest) {
  const pdf = await getDocumentProxy(new Uint8Array(await readFile(new URL(m.file, sampleDir))))
  const { totalPages, text } = await extractText(pdf, { mergePages: true })
  const redacted = redact(text)
  await writeFile(new URL(m.file.replace(/\.pdf$/, '.txt'), redactedDir), redacted.text)
  const row = { file: m.file, pages: totalPages, chars: text.length, redactions: redacted.count }
  if (text.trim().length < 50) {
    console.log(`${m.file}: no text layer (${text.trim().length} chars) – needs OCR or a vision model`)
    results.push({ ...row, error: 'no text layer' })
    continue
  }
  console.log(`${m.file}: ${totalPages} page(s), ${text.length} chars, ${redacted.count} redaction(s)`)
  if (dryRun) {
    results.push(row)
    continue
  }
  for (const model of models) {
    try {
      row[model] = await ask(model, redacted.text)
      const r = row[model]
      console.log(`  ${model.padEnd(16)} ${String(r.ms).padStart(6)} ms  ${String(r.tokens.out).padStart(5)} out  ${r.data.document_type} · ${r.data.vendor} · ${r.data.gross} ${r.data.currency} · ${r.data.invoice_date}`)
    } catch (e) {
      row[model] = { error: e.message }
      console.log(`  ${model.padEnd(16)} ✗ ${e.message}`)
    }
  }
  results.push(row)
}

const outFile = new URL(`./out/extract-${Date.now()}.json`, import.meta.url)
await writeFile(outFile, JSON.stringify(results, null, 2))
if (!dryRun) printComparison(results)
console.log(`\nResults: ${outFile.pathname}`)

// --- helpers ---------------------------------------------------------------

async function ask(model, text) {
  const t0 = Date.now()
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      max_tokens: 6000,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text.slice(0, 30000) },
      ],
    }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 200)}`)
  const c = await res.json()
  const choice = c.choices[0]
  if (choice.finish_reason !== 'stop') throw new Error(`stopped early: ${choice.finish_reason}`)
  return {
    ms: Date.now() - t0,
    tokens: { in: c.usage.prompt_tokens, out: c.usage.completion_tokens, reasoning: c.usage.completion_tokens_details?.reasoning_tokens ?? 0 },
    data: JSON.parse(choice.message.content),
  }
}

function redact(input) {
  let count = 0
  const sub = (s, re, rep) => s.replace(re, (...m) => (count++, typeof rep === 'function' ? rep(...m) : rep))
  let t = input
  for (const term of REDACT_TERMS.split(';').map((x) => x.trim()).filter(Boolean)) {
    t = sub(t, new RegExp(term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'), 'gi'), '[NAME]')
  }
  // IBAN, with or without spaces (also "DE 73 6808 …"); keep the last four characters.
  // SEPA creditor ids (DE98ZZZ…) look alike but are the vendor's, and not secret.
  t = sub(t, /\b[A-Z]{2} ?\d{2}(?: ?[A-Z0-9]{4}){3,7}(?: ?[A-Z0-9]{1,3})?\b/g, (m) =>
    /ZZZ/.test(m) ? (count--, m) : `[IBAN …${m.replace(/\s/g, '').slice(-4)}]`)
  // e-mail addresses of our own domain
  const domain = IMAP_USER.split('@')[1]
  if (domain) t = sub(t, new RegExp(`[\\w.+-]+@${domain.replace(/\./g, '\\.')}`, 'gi'), '[EMAIL]')
  // postcode + town, street + house number (vendors' addresses too – the VAT id identifies them)
  t = sub(t, /\b\d{5}\s+[A-ZÄÖÜ][\wäöüß.\-]+(?:\s+[A-ZÄÖÜ(][\wäöüß.\-)]*){0,3}/g, '[PLZ ORT]')
  t = sub(t, /\b[A-ZÄÖÜ][\wäöüß.\-]*(?:straße|strasse|str\.|weg|platz|allee|gasse|ring|damm|ufer|chaussee)\s+\d+[a-z]?\b/gi, '[STRASSE]')
  // Streets without such a suffix ("Lichtenberg 44") are recognised by position: the line
  // right above a postcode line in an address block.
  t = sub(t, /^[A-ZÄÖÜ][\wäöüß.\- ]{1,40}? \d{1,4}[a-z]?(?=\s*\n(?:D-)?\[PLZ ORT\])/gim, '[STRASSE]')
  return { text: t, count }
}

function printComparison(rows) {
  const [a, b] = models
  if (!b) return
  const keys = ['document_type', 'vendor', 'invoice_number', 'invoice_date', 'due_or_debit_date', 'gross', 'net', 'currency', 'payment', 'reverse_charge']
  console.log(`\nWhere ${a} and ${b} disagree:`)
  let total = { [a]: { ms: 0, out: 0 }, [b]: { ms: 0, out: 0 } }
  for (const r of rows) {
    if (!r[a]?.data || !r[b]?.data) continue
    for (const k of keys) {
      const x = JSON.stringify(r[a].data[k])
      const y = JSON.stringify(r[b].data[k])
      if (x !== y) console.log(`  ${r.file} · ${k}: ${x}  vs  ${y}`)
    }
    for (const m of [a, b]) {
      total[m].ms += r[m].ms
      total[m].out += r[m].tokens.out
    }
  }
  for (const m of [a, b]) console.log(`${m}: ${(total[m].ms / 1000).toFixed(1)} s total, ${total[m].out} output tokens`)
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
