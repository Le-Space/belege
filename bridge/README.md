# @belege/bridge

A small local service on `127.0.0.1` that does what the browser app cannot: read accounts and
transactions from a local [Hibiscus](https://github.com/willuhn/hibiscus) over XML-RPC, read receipt
mails over IMAP, and ask an LLM to read a receipt. The app calls it with a bearer token it got by
pairing; the bridge hands out only accounts whose IBAN ends in a suffix you allowed, only mails
addressed to the accounting alias, and sends only redacted text to the LLM.

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
6. **Mail** (optional): `pnpm setup:mail` asks for IMAP host, port and user, the accounting
   address (default `buchhaltung@le-space.de`) and the password or Mailu auth token (hidden prompt,
   into the keychain). `IMAP_*` from the repo's `.env` are offered as defaults, `IMAP_PASSWORD`
   once instead of the prompt. It offers one test login that only counts folders.
7. **LLM** (optional): `pnpm setup:llm` asks for the provider's base URL (default
   `https://api.deepseek.com`, https only), the model and the retry model (default `deepseek-flash`,
   `deepseek-v4-pro`), the terms to black out (your name, family names; `;`-separated) and the API
   key (hidden prompt, into the keychain). `DEEPSEEK_*` and `REDACT_TERMS` from `.env` are offered.
8. **Restart the bridge** after either setup: `pnpm bridge`. `/health` says what is set up.
9. **Unpair**: "Kopplung lösen" in the app makes the bridge forget that token too. For a device
   that cannot do it itself (lost, wiped, or the bridge was off): stop the bridge, then
   `pnpm bridge -- --list-pairings`, `pnpm bridge -- --revoke <n>` or `pnpm bridge -- --revoke-all`.

## Where things are kept

| What | Where |
|---|---|
| Hibiscus master password | macOS keychain, service `belege-bridge`, account `hibiscus` |
| IMAP password or auth token | macOS keychain, service `belege-bridge`, account `imap` |
| LLM API key | macOS keychain, service `belege-bridge`, account `llm` |
| Host, port, pinned SHA-256, IBAN suffixes, app origins, hashes of paired tokens; IMAP host/port/user, accounting address; LLM URL, models, terms to black out | `~/.config/belege/bridge.json` (0600; `BELEGE_BRIDGE_CONFIG` overrides) |
| The bearer token | the app's encrypted store (`settings`), never on the bridge's disk |

## API

All JSON, `127.0.0.1:8765` by default. Everything except `/health` and `/pair` needs
`Authorization: Bearer <token>`.

| | |
|---|---|
| `GET /health` | `{ ok, paired, pairingOpen, hibiscus: { configured }, mail: { configured, accountingAddress }, llm: { configured, models } }` |
| `POST /pair` `{ code }` | `{ token }`, once per code |
| `POST /unpair` | forgets the calling token; `{ ok: true }` |
| `GET /hibiscus/accounts` | allowed accounts: `id, ibanMasked, ibanLast4, name, currency, balanceCents, balanceDate` |
| `GET /hibiscus/transactions?account=<id>&since=YYYY-MM-DD` | `date, valueDate, amountCents, currency, counterpartyName, counterpartyIban, purpose, endToEndId, bookingType, sourceId, fingerprint` |
| `GET /mail/messages?since=YYYY-MM-DD[&until=YYYY-MM-DD]&scope=accounting` | mails to the accounting address received in [since, until): `id, folder, uid, date, receivedAt, from { address, name }, subject, auth { verdict, dkim, spf, dmarc, domain }, outgoing, attachments [{ part, name, type, size, kind, isPdf, mime }], excerpt, addressedBy` |
| `GET /mail/attachment?id=<id>&part=<n>` | the bytes of one attachment: PDFs and images only (by their bytes), at most 15 MB |
| `GET /mail/search?text=&amount=&around=YYYY-MM-DD&days=14` | the targeted search in the whole mailbox (Junk included, Trash and Drafts not): the same shape plus `matched` (`"text"`, or which amount spelling) |
| `POST /extract` `{ text, hints: { subject, from, fileName, receivedAt }, source: { mailId }, confirmedByUser }` | `{ extraction, model, usage { prompt, completion, reasoning }, attempts [{ model, ok, reason }], redactions }`; 403 `SENDER_UNVERIFIED` for a mail whose sender did not pass, 502 `EXTRACT_FAILED` with the attempts when no model gave a usable answer |

### Mail

- Every folder is opened read-only (EXAMINE). The listing skips Trash, Junk and Drafts (by
  SPECIAL-USE, else by the usual names) and keeps Sent. `X-Original-To` and `Delivered-To` are empty
  on this server, so the server is asked for `To:` or `Received: … for <alias>`, and every hit is
  checked again against its parsed `To:`/`Cc:`/`Received:` headers before it leaves.
- Of a mail, only headers, the MIME structure, the first KB of each attachment that may be a
  receipt (to tell a PDF by `%PDF-`, since about half arrive as `application/octet-stream` or
  `.PDF`) and the first 16 KB of its text part (for a 2 KB excerpt, HTML stripped) are fetched.
  Inline images (logos) are not receipts; images count only as attachments.
- The sender verdict comes from `Authentication-Results`: only the topmost header counts (our
  server's; a sender can add its own further down), or only headers of `mail.authServId` when
  that is set in `bridge.json`. `pass` needs DKIM or SPF passing for the From: domain (or a
  subdomain) or DMARC passing; a pass for another domain only is `none`; an explicit fail is
  `fail`. Mails in Sent are marked `outgoing`.
- A window that reaches into the future leaves its end open (imapflow turns SINCE/BEFORE into
  YOUNGER/OLDER, and Dovecot rejects `OLDER 0`).
- `/mail/search` is for one missing receipt (step 4 uses it): vendor text and every spelling of
  an amount (`52,59`, `52.59`, `1.190,00`, `1,190.00`) within ± days; only the hits are read.

### LLM

- The bridge redacts, not the browser: every `/extract` goes through `src/llm/redact.js` (the
  phase-0 rules: the terms from `bridge.json`, IBANs with the last four characters kept, SEPA
  creditor ids kept, e-mail addresses of our own domains – from the IMAP user and the accounting
  address –, postcode + town, street + number, and suffix-less streets by position above a
  postcode line). The hints (subject, sender, file name) are redacted too.
- The prompt and schema are the spike's. `max_tokens` 6000 (both models reason first), JSON mode,
  and anything but `finish_reason: stop` is a failure. An answer must check out – gross present,
  ISO currency, dates that are dates, net + VAT = gross within one cent when both are there –
  or the retry model is asked. A 401 is not retried.
- Before a mail's text goes out, the bridge looks up that mail's sender verdict itself (from the
  last listing, else from its headers); unless it passed or the mail is our own (Sent), the
  request must carry `confirmedByUser: true`.
- Neither the text nor the answer is logged; the log says which model answered.

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
- **What leaves this machine**:
  - to the mail server: the IMAP login (from the keychain) and read-only commands over TLS
    (`tls: none` is refused for anything but a server on this machine);
  - to the LLM provider (DeepSeek: servers in China): per "Auslesen", the redacted text layer of
    one PDF (up to 30 000 characters) or a mail's text excerpt, with the redacted subject, sender
    address and file name, and the API key. Never the file itself, never a mail that was not
    asked for. Redaction is pattern-based: a name not in the terms list, or an address in an
    unusual layout, can get through. The provider sees the vendor, amounts, invoice numbers.
- **Look-alike phishing and malicious PDFs**: mails whose sender did not pass DKIM/SPF are neither
  sent to the LLM (the bridge refuses) nor previewed in the app (pdf.js, with eval off) until you
  confirm them. The bridge hands out only PDFs and images, by their bytes.
- **Not covered**: other processes running as your user can read the config and ask the keychain
  (macOS may prompt); a stolen app token works until you remove its hash from `bridge.json`.

## Development

```bash
pnpm test:bridge            # node:test: a fake HTTPS Hibiscus, a fake IMAP server (hoodiecrow)
                            # with a synthetic mailbox, a fake OpenAI-compatible API
pnpm --filter @belege/bridge lint
```

`--test-mode` (used by the app's E2E suite) takes the secrets from `BELEGE_BRIDGE_TEST_PASSWORD`,
`BELEGE_BRIDGE_TEST_IMAP_PASSWORD` and `BELEGE_BRIDGE_TEST_LLM_KEY` instead of the keychain and
refuses the real config file. No test talks to a real mail server, Hibiscus or LLM.
