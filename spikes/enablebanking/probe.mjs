// Phase 0 spike: read our own GLS and Revolut Business accounts through Enable Banking (PSD2).
//
//   node spikes/enablebanking/probe.mjs check                  # key works? which banks are offered?
//   node spikes/enablebanking/probe.mjs link GLS DE            # consent for one bank → prints a URL
//   node spikes/enablebanking/probe.mjs link Revolut LT
//   node spikes/enablebanking/probe.mjs fetch --days 90        # balances + transactions of all linked accounts
//
// Settings in .env (not secret): EB_APP_ID, EB_KEY_PATH (the .pem the Control Panel downloaded),
// EB_REDIRECT_URL (as registered for the application). The private key never leaves this
// machine: it only signs a short-lived JWT. Sessions (they grant read access until their
// consent expires) are kept in ~/.config/belege/enablebanking/sessions.json with mode 0600.
// Raw answers land in spikes/enablebanking/out/ (git-ignored); the console shows masked IBANs.

import { createSign, randomUUID } from 'node:crypto'
import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline/promises'

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {}
const { EB_APP_ID, EB_KEY_PATH, EB_REDIRECT_URL } = process.env
const API = 'https://api.enablebanking.com'
const CONFIG_DIR = `${homedir()}/.config/belege/enablebanking`
const SESSIONS = `${CONFIG_DIR}/sessions.json`
const [cmd, ...args] = process.argv.slice(2)

if (!EB_APP_ID || !EB_KEY_PATH) fail('Set EB_APP_ID and EB_KEY_PATH in .env (see .env.example).')
const privateKey = await readFile(EB_KEY_PATH.replace(/^~/, homedir()), 'utf8').catch(() =>
  fail(`Cannot read the key at ${EB_KEY_PATH}.`),
)

if (cmd === 'check') await check()
else if (cmd === 'link') await link(args[0], args[1] ?? 'DE')
else if (cmd === 'fetch') await fetchAll(Number(argValue('--days') ?? 90))
else fail('Commands: check · link <bank name> <country> · fetch [--days N]')

// --- commands ----------------------------------------------------------------

async function check() {
  const app = await api('GET', '/application')
  console.log(`✓ key accepted · application "${app.name}" · ${app.environment ?? ''} · active: ${app.active}`)
  if (app.redirect_urls) console.log(`  redirect URLs: ${app.redirect_urls.join(', ')}`)
  for (const [country, pattern] of [['DE', /gls/i], ['LT', /revolut/i]]) {
    const { aspsps } = await api('GET', `/aspsps?country=${country}`)
    const hits = aspsps.filter((a) => pattern.test(a.name))
    console.log(`\n${country}: ${aspsps.length} banks, matching ${pattern}:`)
    for (const a of hits) {
      const days = a.maximum_consent_validity ? Math.round(a.maximum_consent_validity / 86400) : '?'
      console.log(`  "${a.name}" · psu types: ${(a.psu_types ?? []).join('/')} · consent up to ${days} days`)
    }
    if (!hits.length) console.log('  none – try another country code, or search the full list in out/')
    await save(`aspsps-${country}`, aspsps)
  }
}

async function link(name, country) {
  if (!name) fail('link needs the bank name exactly as `check` printed it, and a country code.')
  if (!EB_REDIRECT_URL) fail('Set EB_REDIRECT_URL in .env to the redirect URL registered for the application.')
  const { aspsps } = await api('GET', `/aspsps?country=${country}`)
  const aspsp = aspsps.find((a) => a.name === name)
  if (!aspsp) fail(`No bank named "${name}" in ${country}. Run \`check\` for the exact names.`)
  const validity = Math.min(aspsp.maximum_consent_validity ?? 90 * 86400, 180 * 86400)
  const state = randomUUID()
  const { url } = await api('POST', '/auth', {
    access: { valid_until: new Date(Date.now() + validity * 1000).toISOString() },
    aspsp: { name, country },
    state,
    redirect_url: EB_REDIRECT_URL,
    psu_type: 'business',
  })
  console.log(`\n1. Open this link and confirm read access in your bank (consent for ${Math.round(validity / 86400)} days):\n\n   ${url}\n`)
  console.log('2. The bank sends you to the redirect URL. The page may not exist – that is fine.')
  console.log('   Copy the complete address from the browser bar and paste it here.\n')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const back = new URL((await rl.question('Address: ')).trim())
  rl.close()
  if (back.searchParams.get('state') !== state) fail('The state in the address does not match this request – start again.')
  const code = back.searchParams.get('code')
  if (!code) fail(`No code in the address (${back.searchParams.get('error') ?? 'no error given'}).`)
  const session = await api('POST', '/sessions', { code })
  const sessions = await loadSessions()
  sessions[session.session_id] = { bank: name, country, validUntil: session.access?.valid_until, accounts: session.accounts }
  await mkdir(CONFIG_DIR, { recursive: true, mode: 0o700 })
  await writeFile(SESSIONS, JSON.stringify(sessions, null, 2), { mode: 0o600 })
  await chmod(SESSIONS, 0o600)
  console.log(`\n✓ linked ${name}: ${session.accounts.length} account(s), consent until ${session.access?.valid_until}`)
  for (const a of session.accounts) console.log(`  ${maskIban(a.account_id?.iban)} · ${a.name ?? ''} · ${a.currency ?? ''}`)
}

async function fetchAll(days) {
  const sessions = await loadSessions()
  if (!Object.keys(sessions).length) fail('No linked bank yet. Run `link` first.')
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10)
  for (const [id, s] of Object.entries(sessions)) {
    console.log(`\n── ${s.bank} (consent until ${s.validUntil})`)
    for (const a of s.accounts) {
      const { balances } = await api('GET', `/accounts/${a.uid}/balances`)
      const b = balances?.[0]
      console.log(`  ${maskIban(a.account_id?.iban)} · balance ${b?.balance_amount?.amount ?? '?'} ${b?.balance_amount?.currency ?? ''} (${b?.reference_date ?? b?.balance_type ?? ''})`)
      const txs = []
      let key
      do {
        const q = new URLSearchParams({ date_from: since, ...(key ? { continuation_key: key } : {}) })
        const page = await api('GET', `/accounts/${a.uid}/transactions?${q}`)
        txs.push(...(page.transactions ?? []))
        key = page.continuation_key
      } while (key)
      const perMonth = {}
      for (const t of txs) {
        const m = String(t.booking_date ?? t.value_date ?? '?').slice(0, 7)
        perMonth[m] = (perMonth[m] ?? 0) + 1
      }
      console.log(`  ${txs.length} transaction(s) since ${since}: ${Object.entries(perMonth).sort().map(([m, n]) => `${m} ${n}`).join(' · ')}`)
      const filled = (f) => txs.filter((t) => f(t)).length
      console.log(
        `  filled: counterparty name ${filled((t) => (t.credit_debit_indicator === 'DBIT' ? t.creditor : t.debtor)?.name)}/${txs.length}` +
          ` · counterparty IBAN ${filled((t) => (t.credit_debit_indicator === 'DBIT' ? t.creditor_account : t.debtor_account)?.iban)}/${txs.length}` +
          ` · remittance ${filled((t) => t.remittance_information?.length)}/${txs.length}` +
          ` · entry_reference ${filled((t) => t.entry_reference)}/${txs.length}`,
      )
      await save(`transactions-${id.slice(0, 8)}-${a.uid.slice(0, 8)}`, { account: a, balances, transactions: txs })
    }
  }
}

// --- helpers -----------------------------------------------------------------

// Enable Banking authenticates the application with a JWT signed by its private key (RS256).
function jwt() {
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const head = b64({ typ: 'JWT', alg: 'RS256', kid: EB_APP_ID })
  const body = b64({ iss: 'enablebanking.com', aud: 'api.enablebanking.com', iat: now, exp: now + 600 })
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(privateKey).toString('base64url')
  return `${head}.${body}.${sig}`
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${jwt()}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  })
  const text = await res.text()
  if (!res.ok) fail(`${method} ${path.split('?')[0]}: HTTP ${res.status} ${text.slice(0, 300)}`)
  return text ? JSON.parse(text) : {}
}

async function loadSessions() {
  try {
    return JSON.parse(await readFile(SESSIONS, 'utf8'))
  } catch {
    return {}
  }
}

async function save(name, data) {
  await mkdir(new URL('./out/', import.meta.url), { recursive: true })
  await writeFile(new URL(`./out/${name}.json`, import.meta.url), JSON.stringify(data, null, 2))
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
