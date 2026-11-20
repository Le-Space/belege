# Deploy: https://belege.le-space.de on Aleph

The app is a static build (`app/build`) published to Aleph IPFS and served under
`belege.le-space.de`. `.github/workflows/deploy.yml` does it for every published
GitHub release (and by hand from a release tag, optionally without moving the domain).
It runs the CI gates first.

**The domain stays, the host may change.** Passkeys and the browser's stored books belong
to the origin `https://belege.le-space.de`. Moving the app to another domain would leave
both behind; moving the domain to another host (Aleph today) does not.

## By CID, from a subdomain gateway

Each release's CID is on its GitHub release. The build opens from the domain and from
an IPFS gateway that gives every CID a subdomain of its own
(`https://<cid>.ipfs.inbrowser.link/`): the start page (`index.html`) is prerendered,
so SvelteKit writes its asset paths relative (`./_app/…`) and the page computes its
base from its own address; the manifest and the service worker follow the page. Only
the SPA fallback (`200.html`, the page a deeper route such as `/zahlungen` reloads
into) has absolute paths – SvelteKit cannot know the depth it is served at – and the
domain's catch-all serves it. A gateway has no catch-all: by CID, start at the root
and navigate within the app. Passkeys and the books stay with the origin, so what was
set up on `belege.le-space.de` is not seen on a gateway, and the other way round.

**Not from a path-style gateway** (`https://<gateway>/ipfs/<cid>/`): there the origin
is the gateway's, shared by every CID it serves – storage, caches and passkeys
included. Under `/ipfs/` or `/ipns/` the app shows where to open it instead, asks for
no passkey, opens no books and removes its service worker
(`app/src/lib/shared-origin.js`).

## Who can change what the domain serves

Whoever can change what `belege.le-space.de` serves can read the books a browser decrypts there. So the way from a commit to the domain is short, and each link of it is pinned, locked or gated:

| Link                           | What holds it                                                                                                                                                                                                                        |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is built                  | Only a release tag `vX.Y.Z` that is on `main` – for a release, and for a run by hand (choose the tag under "Use workflow from"; a branch is refused). The first job of `deploy.yml` checks it.                                       |
| That it was tested             | `deploy.yml` runs every test workflow before it publishes; the built site is read for test hooks (`scripts/check-production-build.mjs`).                                                                                             |
| The actions the workflows run  | Each is named by a commit, with its version beside it. `scripts/workflow-pins.test.mjs` fails on a tag or a branch; Dependabot proposes new pins once a week (`.github/dependabot.yml`).                                             |
| The app's dependencies         | `pnpm install --frozen-lockfile` from `pnpm-lock.yaml`, exact versions.                                                                                                                                                              |
| The tool that publishes        | `@le-space/node`, from a lockfile of its own (`deploy/`), installed frozen and without install scripts. The same test fails on an install outside a lockfile in the site's workflows.                                                |
| The key that signs the publish | The repository secret `ALEPH_PRIVATE_KEY`, read by two jobs only (`publish`, `link-domain`), both in the environment `production`.                                                                                                   |
| Who may start it               | Whoever may publish a release or run a workflow in Le-Space/belege, that is: people with write access. With a required reviewer on the environment `production` (a repository setting, below), a second person approves each deploy. |
| The domain                     | The DNS records below, in the Cloudflare zone of `le-space.de`; the `_control` record names the one account whose publish the domain follows.                                                                                        |

**Settings that are not files.** These live in the repository's settings on GitHub and are part of the chain; check them with `gh api`:

- the environment `production` with a required reviewer (`gh api repos/Le-Space/belege/environments/production`) – without one, the environment is a name and nothing waits;
- branch protection on `main`: a pull request and the test checks required (`gh api repos/Le-Space/belege/branches/main/protection`);
- secret scanning with push protection, and Dependabot security updates (`gh api repos/Le-Space/belege --jq .security_and_analysis`).

**Compare what is served with a release.** Each release names its CID on its release page ("On IPFS"). What the domain serves is in its DNSLink record:

```bash
dig +short TXT _dnslink.belege.le-space.de   # "dnslink=/ipfs/<cid>"
```

The two are the same CID for the release that is live. A CID is the hash of the published files, so the same CID is the same site, wherever it is fetched from. Building a tag again does not yet give the same CID byte for byte; a reproducible build is its own piece of work.

## DNS (Cloudflare, once)

| Type  | Name              | Value                                                | Proxy    |
| ----- | ----------------- | ---------------------------------------------------- | -------- |
| CNAME | `belege`          | `ipfs.public.aleph.sh`                               | DNS only |
| CNAME | `_dnslink.belege` | `_dnslink.belege.le-space.de.static.public.aleph.sh` | DNS only |
| TXT   | `_control.belege` | `0xD139E44669fD96C714F888B6b04Fe5D02D02B4fD`         | –        |

Or through the Cloudflare API with a token that may edit DNS of the zone (asked for hidden):

```bash
bash scripts/cloudflare-dns.sh
```

`le-space.de` has a wildcard A record; the explicit CNAME overrides it. The `_control`
address is the account that signs the publish (the same as for the other le-space.de
sites); it must match the secret below. Check:

```bash
dig +short CNAME belege.le-space.de            # ipfs.public.aleph.sh.
dig +short CNAME _dnslink.belege.le-space.de   # _dnslink.belege.le-space.de.static.public.aleph.sh.
dig +short TXT _control.belege.le-space.de     # "0xD139E44669fD96C714F888B6b04Fe5D02D02B4fD"
```

## Secret (once)

Repository secret `ALEPH_PRIVATE_KEY` in Le-Space/belege: the key of that account.

## The bridge

`https://belege.le-space.de` is in the bridge's default app origins. An existing
`~/.config/belege/bridge.json` keeps its own list: add it with `pnpm setup:hibiscus`
(question "App origins"). The bridge answers Chrome's Private Network Access preflight,
which a public HTTPS page needs to reach `http://127.0.0.1`.

## Version numbers

`gh workflow run release.yml -R Le-Space/belege` without a version counts up from the highest `vX.Y.Z` tag: the next patch (`0.2.0 → 0.2.1`), or `-f bump=minor` / `-f bump=major`; `-f version=1.0.0` sets one exactly. The workflow writes it into `package.json` and `app/package.json`, the CHANGELOG, the tag and the GitHub release.

The footer shows the release next to the build stamp and links to its GitHub release: `v0.2.1` for a build of the tag (what `belege.le-space.de` serves), `v0.2.1+3` for a build three commits after it (local development, previews).
