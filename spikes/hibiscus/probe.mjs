// Phase 0 spike: can we read accounts and transactions from a local Hibiscus over XML-RPC?
//
// Usage:
//   read -s HIBISCUS_PASSWORD && export HIBISCUS_PASSWORD
//   pnpm spike:hibiscus                    # first run: prints the certificate fingerprint and stops
//   export HIBISCUS_CERT_SHA256=AB:CD:...  # after comparing it with the one Jameica shows
//   pnpm spike:hibiscus -- --days 90
//   pnpm spike:hibiscus -- --iban-suffix 1400   # only the account whose IBAN ends in 1400
//
// With --iban-suffix (or HIBISCUS_IBAN_SUFFIX, comma-separated) every other account is
// skipped before anything about it is printed or its transactions are fetched: private
// accounts in the same Hibiscus stay out.
//
// The raw answers land in spikes/hibiscus/out/ (git-ignored). The console only shows masked IBANs.

import tls from 'node:tls'
import https from 'node:https'
import { mkdir, writeFile } from 'node:fs/promises'
import { XMLParser } from 'fast-xml-parser'

// .env first: the constants below must see its values.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {}

const HOST = process.env.HIBISCUS_HOST ?? '127.0.0.1'
const PORT = Number(process.env.HIBISCUS_PORT ?? 8080)
const PASSWORD = process.env.HIBISCUS_PASSWORD
const PINNED = process.env.HIBISCUS_CERT_SHA256?.toUpperCase()
const days = Number(argValue('--days') ?? 90)
const suffixes = (argValue('--iban-suffix') ?? process.env.HIBISCUS_IBAN_SUFFIX ?? '').split(',').map((x) => x.trim()).filter(Boolean)

if (!PASSWORD) fail('HIBISCUS_PASSWORD is not set (the Jameica master password).')

// 1. Jameica serves a self-signed certificate. Pin it instead of switching verification off,
//    and check it before the master password is ever sent.
const cert = await peerCertificate()
if (!PINNED) {
  console.log(`Certificate fingerprint (SHA-256) of ${HOST}:${PORT}:\n  ${cert.fingerprint256}`)
  console.log('Compare it with the certificate Jameica shows, then set HIBISCUS_CERT_SHA256 and run again.')
  process.exit(2)
}
if (cert.fingerprint256 !== PINNED) fail(`Certificate fingerprint mismatch: got ${cert.fingerprint256}`)
const ca = `-----BEGIN CERTIFICATE-----\n${cert.raw.toString('base64').match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`

// 2. Accounts
const all = await call('hibiscus.xmlrpc.konto.find')
const konten = suffixes.length ? all.filter((k) => suffixes.some((x) => String(k.iban ?? '').replace(/\s/g, '').endsWith(x))) : all
if (!suffixes.length) console.log('No --iban-suffix given: reading every account in Hibiscus.')
console.log(`\n${konten.length} account(s)${all.length > konten.length ? `, ${all.length - konten.length} other(s) skipped` : ''}:`)
for (const k of konten) {
  console.log(`  [${k.id}] ${k.bezeichnung || k.name} · ${maskIban(k.iban)} · ${k.waehrung} · balance ${k.saldo} (${k.saldo_datum})`)
}

// 3. Transactions per account for the last N days
const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
const out = { fetchedAt: new Date().toISOString(), since, konten, umsaetze: {} } // skipped accounts are not stored
for (const k of konten) {
  const umsaetze = await call('hibiscus.xmlrpc.umsatz.list', { konto_id: String(k.id), 'datum:min': since })
  out.umsaetze[k.id] = umsaetze
  console.log(`\n[${k.id}] ${umsaetze.length} transaction(s) since ${since}`)
  const perMonth = {}
  for (const u of umsaetze) perMonth[String(u.datum).slice(0, 7)] = (perMonth[String(u.datum).slice(0, 7)] ?? 0) + 1
  for (const [month, n] of Object.entries(perMonth).sort()) console.log(`  ${month}: ${n}`)
  // Which fields are actually filled? That decides what the matcher can rely on.
  const fields = ['empfaenger_name', 'empfaenger_konto', 'zweck', 'zweck_raw', 'customer_ref', 'primanota', 'art', 'valuta']
  const filled = fields.map((f) => `${f} ${umsaetze.filter((u) => String(u[f] ?? '').trim()).length}/${umsaetze.length}`)
  console.log(`  filled: ${filled.join(' · ')}`)
}

await mkdir(new URL('./out/', import.meta.url), { recursive: true })
const file = new URL(`./out/hibiscus-${Date.now()}.json`, import.meta.url)
await writeFile(file, JSON.stringify(out, null, 2))
console.log(`\nRaw answers written to ${file.pathname}`)

// --- helpers ---------------------------------------------------------------

function peerCertificate() {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: HOST, port: PORT, rejectUnauthorized: false }, () => {
      const c = socket.getPeerCertificate(false)
      socket.end()
      resolve(c)
    })
    socket.on('error', (e) => reject(new Error(`Cannot reach Hibiscus at ${HOST}:${PORT} (${e.code ?? e.message}). Is Jameica running with XML-RPC enabled?`)))
  })
}

function call(method, ...params) {
  const body = `<?xml version="1.0"?><methodCall><methodName>${method}</methodName><params>${params.map((p) => `<param>${encode(p)}</param>`).join('')}</params></methodCall>`
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        host: HOST,
        port: PORT,
        path: '/xmlrpc/',
        method: 'POST',
        ca,
        // The certificate is pinned above; its name may not be 127.0.0.1.
        checkServerIdentity: (_host, c) => (c.fingerprint256 === PINNED ? undefined : new Error('fingerprint mismatch')),
        auth: `admin:${PASSWORD}`,
        headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        let xml = ''
        res.setEncoding('utf8')
        res.on('data', (d) => (xml += d))
        res.on('end', () => {
          if (res.statusCode === 401) return reject(new Error('401: wrong master password'))
          if (res.statusCode !== 200) return reject(new Error(`${method}: HTTP ${res.statusCode}`))
          try {
            resolve(decodeResponse(method, xml))
          } catch (e) {
            reject(e)
          }
        })
      },
    )
    req.on('error', reject)
    req.end(body)
  })
}

function encode(v) {
  if (Array.isArray(v)) return `<value><array><data>${v.map(encode).join('')}</data></array></value>`
  if (v && typeof v === 'object') {
    return `<value><struct>${Object.entries(v).map(([k, x]) => `<member><name>${esc(k)}</name>${encode(x)}</member>`).join('')}</struct></value>`
  }
  if (typeof v === 'number') return Number.isInteger(v) ? `<value><int>${v}</int></value>` : `<value><double>${v}</double></value>`
  if (typeof v === 'boolean') return `<value><boolean>${v ? 1 : 0}</boolean></value>`
  return `<value><string>${esc(String(v))}</string></value>`
}

function decodeResponse(method, xml) {
  const parser = new XMLParser({
    parseTagValue: false,
    trimValues: false,
    isArray: (name, jpath) => name === 'member' || jpath.endsWith('data.value'),
  })
  const doc = parser.parse(xml).methodResponse
  if (doc.fault) {
    const f = decode(doc.fault.value)
    throw new Error(`${method}: fault ${f.faultCode}: ${f.faultString}`)
  }
  return decode(doc.params.param.value)
}

function decode(value) {
  if (value === undefined || value === null || typeof value !== 'object') return value ?? ''
  if ('string' in value) return value.string === '' ? '' : String(value.string)
  if ('int' in value || 'i4' in value) return Number(value.int ?? value.i4)
  if ('double' in value) return Number(value.double)
  if ('boolean' in value) return value.boolean === '1'
  if ('dateTime.iso8601' in value) return value['dateTime.iso8601']
  if ('nil' in value) return null
  if ('array' in value) return (value.array.data?.value ?? []).map(decode)
  if ('struct' in value) return Object.fromEntries((value.struct.member ?? []).map((m) => [m.name, decode(m.value)]))
  return ''
}

function esc(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function maskIban(iban) {
  const s = String(iban ?? '').replace(/\s/g, '')
  return s.length > 8 ? `${s.slice(0, 4)} **** ${s.slice(-4)}` : s || '(no IBAN)'
}

function argValue(name) {
  const i = process.argv.indexOf(name)
  return i > -1 ? process.argv[i + 1] : undefined
}

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
