# Deploy: https://belege.le-space.de on Aleph

The app is a static build (`app/build`) published to Aleph IPFS and served under
`belege.le-space.de`. `.github/workflows/deploy.yml` does it for every published
GitHub release (and by hand, optionally without moving the domain). It runs the
CI gates first.

**The domain stays, the host may change.** Passkeys and the browser's stored books belong
to the origin `https://belege.le-space.de`. Moving the app to another domain would leave
both behind; moving the domain to another host (Aleph today) does not.

## DNS (Cloudflare, once)

| Type | Name | Value | Proxy |
| --- | --- | --- | --- |
| CNAME | `belege` | `ipfs.public.aleph.sh` | DNS only |
| CNAME | `_dnslink.belege` | `_dnslink.belege.le-space.de.static.public.aleph.sh` | DNS only |
| TXT | `_control.belege` | `0xD139E44669fD96C714F888B6b04Fe5D02D02B4fD` | – |

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
