# Security

Belege keeps a company's payment and receipt records: encrypted in the browser under a passkey, synced between own devices, with a local bridge next to bank, mail and keys. What it protects against, which risks it cannot answer (a compromised device or browser, browser extensions included), and what you can do: [docs/threat-model.md](docs/threat-model.md). What was checked, area by area, with the result and what is still open: [docs/security-audit.md](docs/security-audit.md).

Le Space never asks for your recovery words, your passkey, keys, tokens or passwords.

## Reporting a security issue

**Please report privately. Nothing public until it is fixed:** no issue, pull request, comment, discussion or social media post.

Two ways:

- E-mail to **[security@le-space.de](mailto:security@le-space.de)**
- GitHub's private reporting: [Report a vulnerability](https://github.com/Le-Space/belege/security/advisories/new)

The same addresses are in [`/.well-known/security.txt`](https://belege.le-space.de/.well-known/security.txt) (RFC 9116).

### What to include

- what you found, and what it lets someone do (the impact);
- the affected version: the release (`v0.…`) or the commit shown at the foot of the app;
- the steps to reproduce it, **with made-up data only**: a fresh test vault, made-up bookings, receipts and mails, sandbox banks, test networks.

Never send real bookings, receipts, mails, account numbers, keys, recovery words, passkeys or tokens, yours or anyone else's ([AGENTS.md](AGENTS.md) says the same for everything in this repository).

### What happens then (coordinated disclosure)

1. We confirm that the report arrived.
2. We assess it and tell you what we found, and ask if something is unclear.
3. The fix ships with the next release.
4. After it, we publish a security advisory on GitHub, naming and thanking you if you wish.

The usual time until publication is 90 days from the report, earlier once a fix is released. If a fix needs longer, we agree on it with you. We do not promise fixed response times.

### Good faith

We welcome research done in good faith within these rules, treat your report confidentially and work with you on it. This is how we intend to act; it is not a legal waiver, and it cannot speak for third parties such as Stripe, Aleph or Filecoin.

### Rules for research

- Use only your own vaults, devices and bridge, and test data.
- Do not look at, copy, change or delete anyone else's data, books or devices. If you come across it by accident, stop, do not keep it, and tell us.
- No denial of service, no spam, no social engineering or phishing against Le Space, its staff or its customers.
- No attacks on infrastructure that is not ours: banks and their interfaces, mail providers, relays run by others, Aleph nodes, LibertAI, GitHub.

## What is in scope

- the app (`app/`), as served from belege.le-space.de;
- the bridge (`bridge/`) and its image for confidential VMs;
- how Belege uses relays and the invoicing app link;
- CI and the release and deploy chain of belege.le-space.de (`.github/`).

**Out of scope**, please report there: the banks and their interfaces, mail providers, Aleph Cloud, LibertAI, and Le Space Credits and Paperless anywhere, which have their own policies. If the issue lies in how Belege uses one of them, it is in scope here.

The audit plan is in [#209](https://github.com/Le-Space/belege/issues/209); the rules for changes are in [AGENTS.md](AGENTS.md#security-what-must-stay-true).

## Bug bounty

There is no bug bounty at the moment. We name and thank you in the advisory, if you wish.

## Supported versions

The latest release, which is what belege.le-space.de serves.
