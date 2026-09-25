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

- ✗ "Revolut ···5281 received 200,00 from LE SPACE UG on 18.09. with purpose _Claude Code (KI)_"
- ✓ "A transfer between two of our accounts whose purpose gives the reason instead of _Umbuchung_"

This holds when a person pastes a screenshot or a log into a chat with an agent: the chat may quote it, the repository may not. If something slipped through, say so, and fix the issue or PR text right away.

## Other rules

- Issues, pull requests and commit messages in English; the app's UI in German.
- Stage files by path (`git add <path>`), never `git add -A` / `git add .`: a stray copy of `.env` once nearly went public.
- Never print or commit secrets: `.env`, tokens, keys, `~/.config/belege/*`, keychain entries.
- A pull request always against `main`, never stacked on another branch; check that a PR is still open before pushing to its branch.
