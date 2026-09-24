# @belege/bridge

A small local service on `127.0.0.1` that does what the browser app cannot: read accounts and
transactions from a local [Hibiscus](https://github.com/willuhn/hibiscus) over XML-RPC. The app
calls it with a bearer token it got by pairing; the bridge hands out only accounts whose IBAN ends
in a suffix you allowed.

## Setup (macOS)

1. **Jameica plugins**: install `jameica.webadmin`, `jameica.xmlrpc` and `hibiscus.xmlrpc` from
   the repository "Plattform-Erweiterungen" (not the default one), restart Jameica.
2. **Loopback only**: Jameica's web server listens on all interfaces (`*:8080`) by default. Set
   `listener.http.address=127.0.0.1` in the webadmin plugin's properties file under
   `~/Library/jameica/cfg/` (with Jameica stopped), start Jameica, and check with
   `lsof -nP -iTCP:8080 -sTCP:LISTEN` that it shows `127.0.0.1:8080`, not `*:8080`.
3. **Set up the bridge** (from the repo root):
   ```bash
   pnpm install
   pnpm setup:hibiscus
   ```
   It asks for host and port, shows the certificate fingerprint for you to compare with the one
   Jameica shows, pins it on "yes", asks for the IBAN suffixes that may leave the bridge and the app
   origins, then the Jameica master password in a hidden prompt (stored in the keychain), and
   offers one test call.
4. **Start it**: `pnpm bridge`. Until a browser is paired it prints a one-time pairing code (10
   minutes, one use). `pnpm bridge -- --pair` prints a new one to pair another browser.
5. **Pair**: in the app, Integrationen → Bridge → enter the code → Koppeln.
6. **Unpair**: "Kopplung lösen" in the app makes the bridge forget that token too. For a device
   that cannot do it itself (lost, wiped, or the bridge was off): stop the bridge, then
   `pnpm bridge -- --list-pairings`, `pnpm bridge -- --revoke <n>` or `pnpm bridge -- --revoke-all`.

## Where things are kept

| What | Where |
|---|---|
| Hibiscus master password | macOS keychain, service `belege-bridge`, account `hibiscus` |
| Host, port, pinned SHA-256, IBAN suffixes, app origins, hashes of paired tokens | `~/.config/belege/bridge.json` (0600; `BELEGE_BRIDGE_CONFIG` overrides) |
| The bearer token | the app's encrypted store (`settings`), never on the bridge's disk |

## API

All JSON, `127.0.0.1:8765` by default. Everything except `/health` and `/pair` needs
`Authorization: Bearer <token>`.

| | |
|---|---|
| `GET /health` | `{ ok, paired, pairingOpen, hibiscus: { configured } }` |
| `POST /pair` `{ code }` | `{ token }`, once per code |
| `POST /unpair` | forgets the calling token; `{ ok: true }` |
| `GET /hibiscus/accounts` | allowed accounts: `id, ibanMasked, ibanLast4, name, currency, balanceCents, balanceDate` |
| `GET /hibiscus/transactions?account=<id>&since=YYYY-MM-DD` | `date, valueDate, amountCents, currency, counterpartyName, counterpartyIban, purpose, endToEndId, bookingType, sourceId, fingerprint` |

## Threat model

- **Other machines**: the bridge binds `127.0.0.1` only and refuses to start on anything else;
  Jameica should listen on loopback too (step 2).
- **Other websites in your browser**: CORS lets only the configured app origins read answers, the
  `Host` header must be `127.0.0.1`/`localhost` (no DNS rebinding), and without a token nothing but
  `/health` answers.
- **A fake Jameica**: the certificate is pinned; every call checks it on its own connection before
  the keychain is asked, so a mismatch never sends the password.
- **Private accounts in the same Hibiscus**: filtered by IBAN suffix straight after `konto.find`;
  other accounts and their transactions are never requested or returned.
- **Not covered**: other processes running as your user can read the config and ask the keychain
  (macOS may prompt); a stolen app token works until you remove its hash from `bridge.json`.

## Development

```bash
pnpm test:bridge            # node:test, against a fake HTTPS Hibiscus
pnpm --filter @belege/bridge lint
```

`--test-mode` (used by the app's E2E suite) takes the password from `BELEGE_BRIDGE_TEST_PASSWORD`
instead of the keychain and refuses the real config file.
