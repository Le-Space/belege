// Phase 0 spike: does the DeepSeek key work, what does it cost us, and can a browser call the API?
//
//   pnpm spike:llm-key
//
// Prints status, balance and models – never the key. The one test prompt contains no personal data.

try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  fail('No .env in the repo root. Copy .env.example to .env and fill in DEEPSEEK_API_KEY.')
}

const { DEEPSEEK_API_KEY: key, DEEPSEEK_BASE_URL: base = 'https://api.deepseek.com', DEEPSEEK_MODEL: model = 'deepseek-chat' } = process.env
if (!key) fail('DEEPSEEK_API_KEY is not set in .env.')
console.log(`Key: ${key.length} characters`)

const auth = { Authorization: `Bearer ${key}` }

// 1. Models – free, proves the key is accepted
const models = await fetch(`${base}/models`, { headers: auth })
if (models.status === 401) fail('401: the key is not accepted (wrong, revoked, or copied with extra characters).')
if (!models.ok) fail(`/models: HTTP ${models.status} ${await models.text()}`)
console.log(`✓ key accepted · models: ${(await models.json()).data.map((m) => m.id).join(', ')}`)

// 2. Balance – a key with no credit passes step 1 but fails every real call (HTTP 402)
const balance = await fetch(`${base}/user/balance`, { headers: auth })
if (balance.ok) {
  const b = await balance.json()
  const info = b.balance_infos?.map((i) => `${i.total_balance} ${i.currency}`).join(', ') || 'none'
  console.log(`${b.is_available ? '✓' : '✗'} balance: ${info}${b.is_available ? '' : ' – top up before using the API'}`)
} else {
  console.log(`? balance: HTTP ${balance.status}`)
}

// 3. One tiny completion in JSON mode – the way extraction will call it
const t0 = Date.now()
const chat = await fetch(`${base}/chat/completions`, {
  method: 'POST',
  headers: { ...auth, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    model,
    max_tokens: 60,
    response_format: { type: 'json_object' },
    messages: [
      { role: 'system', content: 'Extract invoice data. Answer as JSON with keys vendor, amount, currency, date (YYYY-MM-DD).' },
      { role: 'user', content: 'Beispiel GmbH – Rechnung vom 3. August 2026 – Gesamtbetrag 119,00 EUR' },
    ],
  }),
})
if (chat.status === 402) fail('402: no balance left – the key works, but the account needs credit.')
if (!chat.ok) fail(`/chat/completions: HTTP ${chat.status} ${await chat.text()}`)
const c = await chat.json()
console.log(`✓ ${model} answered in ${Date.now() - t0} ms: ${c.choices[0].message.content.replace(/\s+/g, ' ')}`)
console.log(`  tokens: ${c.usage.prompt_tokens} in, ${c.usage.completion_tokens} out`)

// 4. Could the browser call the API directly? (CORS preflight, no key sent)
const pre = await fetch(`${base}/chat/completions`, {
  method: 'OPTIONS',
  headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type' },
})
const allow = pre.headers.get('access-control-allow-origin')
console.log(`${allow ? '✓' : '✗'} browser (CORS): ${allow ? `allowed (${allow})` : `not allowed (HTTP ${pre.status}) – calls go through the local bridge`}`)

function fail(msg) {
  console.error(msg)
  process.exit(1)
}
