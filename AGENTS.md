# Working on this repository (for AI agents and people)

This repository is **public**. Belege handles a company's bookkeeping, so the people who use it show real data while developing: screenshots of bookings, receipts, mails, bank statements.

## Never put real data into the repository or onto GitHub

Not in issues, pull requests, comments, commit messages, code, tests, fixtures, docs or screenshots:

- amounts and dates of real bookings or receipts,
- account numbers, IBANs or their last digits, card numbers,
- the names of the banks and accounts of the person using it (which bank holds which account),
- customer, contract, invoice and reference numbers,
- names of companies and people from bookings, receipts or mails (vendors, customers, the user's own company and name), addresses, e-mail addresses, phone numbers,
- subjects or texts of real mails, text from real receipts, purposes of real bookings,
- logs or network traces that contain any of the above.

**Use made-up examples instead**, as the tests do: _Wolkenfabrik Hosting GmbH_, _Stromwerk Test AG_, _Konto A → Konto B_, _−12,34 €_, _DE00 0000 …_, _example.com_. Describe the **pattern**, not the case:

- ✗ "Bank X ···1234 received 12,34 from Muster GmbH on 01.02. with purpose _Beispielzweck_" (made up here; the real case would name the real bank, digits, amount, company and purpose)
- ✓ "A transfer between two of our accounts whose purpose gives the reason instead of _Umbuchung_"

This holds when a person pastes a screenshot or a log into a chat with an agent: the chat may quote it, the repository may not. If something slipped through, say so, and fix the issue or PR text right away.

## Other rules

- Issues, pull requests and commit messages in English. The app's UI is German and English: every text a person reads comes from `app/src/lib/i18n` (`de.js` and `en.js`, same keys); the lint rule `belege/no-german` fails on German elsewhere.
- Stage files by path (`git add <path>`), never `git add -A` / `git add .`: a stray copy of `.env` once nearly went public.
- Never print or commit secrets: `.env`, tokens, keys, `~/.config/belege/*`, keychain entries.
- A pull request always against `main`, never stacked on another branch; check that a PR is still open before pushing to its branch.

## Security: what must stay true

Belege decrypts a company's books in the browser and runs a bridge next to bank, mail and keys. These hold for every change; the audit plan is in [#209](https://github.com/Le-Space/belege/issues/209).

**Findings stay private until fixed.** A weakness that could be exploited does not go into an issue, a PR, a comment or a commit message. Tell the maintainer, or open a private security advisory ([SECURITY.md](SECURITY.md)). Public text says what was hardened, not how to attack what is not.

**Keys**

- No key and no secret on disk in the browser: keys are derived from the passkey's PRF answer at unlock and live in memory only. Nothing secret goes into localStorage, sessionStorage, IndexedDB or a cache. The storage scan in `app/e2e/passkey-books.spec.js` must keep passing.
- Tokens and grants (the bridge token, UCEP grants) are kept in the sealed `settings` collection, never in localStorage.
- On the bridge, secrets go into the macOS keychain through a hidden prompt; never into `bridge.json`, a log, a URL in a log, an error message or an HTTP response.

**Sealing**

- Every record and every receipt file is sealed before it is written. A collection is opened only through `app/src/lib/store/repository.js`; a new OrbitDB database anywhere else is a plaintext database.
- What syncs is what is stored: sealed. Do not rely on the transport's encryption for content.

**Network**

- Off until the person switches it on; the pause and the network mode are respected by everything that dials.
- In the sync node, a new libp2p service or protocol handler is reachable only after the device proof (`sync/device-gate.js`). No DHT, no discovery, no pinning or provide calls.
- A new host the app or the bridge contacts is named in the consent screen (`consent.*` in the catalogue, with a version bump) before it ships.

**Bridge**

- It listens on 127.0.0.1 only. Every route needs the token, passes the Host and Origin checks, and has a body limit; the exceptions are listed in `bridge/README.md` and stay few.
- A URL, host, path, folder or id from the caller is validated before it is used: no private addresses, no redirects followed blindly, no path outside its directory.
- Text for the language model is redacted first; what the model answers is data, never an instruction, and never links or books by itself.

**Web app**

- No `{@html}` with anything a third party can influence (mail, PDF text, file names, bank purposes, QR payloads, URL parameters, synced records). No `eval`, no remote scripts, fonts or trackers.
- Test hooks (`window.__belegeE2E`, the PRF override, key export) exist only behind `VITE_E2E`; a production build has none.

**Claims**

- What the consent screen, the READMEs and the docs say about security is true in the code. Change the text in the same PR as the behaviour.

**Deploy**

- belege.le-space.de changes only through a release (`release.yml` → `deploy.yml`) after all tests. Do not add a path around it.
