# Collaboration over the internet (remote E2E)

Two browsers that are really apart (#625): the **owner** in a local Chromium, the
**bookkeeping** in a second Chromium – on an Aleph VM in CI, or on this machine by
hand. Both open a deployed Belege (by default https://belege.le-space.de) and meet
through the public Le Space relays the app finds on Aleph.

A production build has no test hooks, so the agent (`agent.mjs`) drives the UI only:

| Step | How, without hooks |
| --- | --- |
| Passkey | Chrome's virtual authenticator with PRF over CDP (`WebAuthn.addVirtualAuthenticator`); "Weiter" clicked between the prompts |
| Device sync | switched on in the consent screen ("Netzwerk" → "Eigene Geräte") |
| A booking | a made-up CAMT.053 file (`statement.mjs`) chosen under Integrationen → Bank – the app has no form to type a payment in |
| Joining | Integrationen → Zusammenarbeit: the join code and the answer are read from one page and typed into the other; both fingerprints compared |
| Member books | reload, "Bücher von …" chosen on the unlock screen, `member-books` in the header |
| Replication | the other side's payment listed in Zahlungen, both directions timed |
| Diagnostics | the network menu (badge, relay light and the relays it names), Integrationen → Eigene Geräte (own peer id, the devices listed and how they are connected, the sync log's counts) |

Every name and amount is made up (_Wolkenfabrik Hosting GmbH_, _Stromwerk Test AG_,
_12,34 €_, IBANs `DE00 …`). The evidence – screenshots of both pages and `result.json` –
goes to `test-results/remote-collab`.

## By hand: two local browsers

```sh
pnpm install --dir e2e-remote --ignore-workspace
pnpm --dir e2e-remote exec playwright install chromium
REMOTE_APP_URL=https://belege.le-space.de pnpm --dir e2e-remote run local
```

`REMOTE_APP_URL` can be any build without `VITE_E2E`, e.g. `pnpm build && pnpm exec vite preview`
in `app/` (it then still uses the public relays). `REQUIRE_PUBLIC_RELAY=true` fails the run when
the network menu shows no public relay (builds before the relay light, #609, have none to show).
`REMOTE_OUTPUT_DIR` moves the evidence.

## In CI: owner on the runner, bookkeeping on an Aleph VM

`.github/workflows/remote-collaboration.yml` runs after each release (when `release.yml`, which
deploys through `deploy.yml`, finished) and by hand (`app_url`, `provider: aleph | local`,
`expect_release`). It first checks that the paying wallet holds Aleph credits for a day of the VM
(`credit-check.mjs`; without them Aleph refuses the VM with a bare "error 6"), waits until the
domain serves the new release (`wait-release.mjs`), then deploys a Playwright runner VM with relay-button's `aleph-vm-deploy` action (the RootFS
with Playwright 1.61.1, as in Le-Space/simple-todo), connects with `connectAlephChromium` from
`@le-space/playwright`, runs the scenario, and always erases and forgets the VM
(`playwright-runner-cleanup`). `aleph-playwright-janitor.yml` sweeps VMs of this repository that a
cancelled run left behind, every six hours.

This directory has its own lockfile and is not part of the pnpm workspace: none of it reaches the
app, and `app/playwright.config.js` does not see it.
