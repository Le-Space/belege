# Security

Belege keeps a company's payment and receipt records: encrypted in the browser under a passkey, synced between own devices, with a local bridge next to bank, mail and keys.

## Reporting a weakness

Please do **not** open a public issue or pull request for something that could be exploited.

- Use GitHub's private reporting: [Report a vulnerability](https://github.com/Le-Space/belege/security/advisories/new).
- Say what you found, how to reproduce it with made-up data, and what it lets someone do. Never include real bookings, receipts, mails or keys.

You get an answer as soon as the maintainer has looked; a fix is published with the next release, and the advisory after it.

## What is in scope

The app (`app/`), the bridge (`bridge/`), how Belege uses relays and the invoicing app link, and the build and deploy chain of belege.le-space.de. The audit plan is in [#209](https://github.com/Le-Space/belege/issues/209); the rules for changes are in [AGENTS.md](AGENTS.md#security-what-must-stay-true).

## Supported versions

The latest release, which is what belege.le-space.de serves.
