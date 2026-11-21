# @le-space/bridge-protocol

The commands of the [Belege](https://github.com/Le-Space/belege) bridge, one definition for the bridge and every client ([#577](https://github.com/Le-Space/belege/issues/577), milestone M2.1 of [#567](https://github.com/Le-Space/belege/issues/567)):

- **a name per command** (`bank.transactions`, `mail.search`, `llm.extract`): the UCEP command of the extension `belege-bridge` from protocol version 2 on, with its own version;
- **its scope**, the grant a paired device needs for it;
- **how HTTP carries it**: method, path (a `{name}` filled from the arguments), and whether the arguments go in the query, a JSON body or none;
- **a schema for its arguments** and for the outer shape of its JSON answer, checked by a small validator without code generation (no `eval`, so a strict Content-Security-Policy holds).

A schema says what a call looks like; the bridge's command still says what it may do (`bridge/src/commands.js`), and its tests keep the bridge's table and this catalogue the same.

```js
import { checkArgs, httpRequest, commandInput } from '@le-space/bridge-protocol';

checkArgs('bank.transactions', { account: 'a1', since: '2026-10-01' }); // [] – fits
checkArgs('bank.transactions', { account: 'a1' }); // ['since: required']

// Over HTTP:
httpRequest('mail.search', { text: 'Rechnung', term: ['Abo'], days: 14 });
// → { method: 'GET', path: '/mail/search?text=Rechnung&term=Abo&days=14', body: null }

// On the bridge, a command that came by name, read as HTTP would have given it:
commandInput('chains.wallet', { chain: 'akash', address: 'akash1…' });
// → { query, params: { chain: 'akash' }, body: { address: 'akash1…' } }
```

A problem names the field, never the value: problems may end up in a log.

## Big answers as blocks (#578)

An answer of bytes too big for one stream answer goes as sealed blocks:

- `@le-space/bridge-protocol/blocks`: `sealBlocks(bytes)` seals with AES-256-GCM under a key made for this answer and cuts the sealed bytes into raw blocks of at most 1 MiB with a dag-cbor root; `openBlocks(get, root, key, { size })` fetches, checks every block against its CID, and opens.
- `@le-space/bridge-protocol/exchange`: `createBlockExchange({ libp2p })` runs Bitswap on `/le-space/bridge-blocks/1.0.0`, a protocol of its own beside the books' `/ipfs/bitswap/`, with a store in memory and no routing. The bridge `offer`s an answer's bytes and `drop`s them when the device has them (or after ten minutes); the device `fetch`es and keeps nothing.

Who may speak the protocol is the node's device gate's business (`@belege/device-gate`, `reach`).

## Calls sealed above the connection

A device of the books and their bridge hold a key in common from before any connection: the bridge's own key, which the device proves at the gate. `@le-space/bridge-protocol/seal` seals what a call carries with it, a second time above the connection's own encryption:

- `sealCall(secret, { consumer, provider, command }, args)` gives `{ sent, open }`: the arguments as `{ "$sealed": … }`, and `open(answer)` for the answer to this call. `openCall(secret, context, sent)` gives `{ args, seal }` on the answering side.
- The key of a call is HKDF-SHA-256 over the secret with a nonce made for the call; the two peers, the command and the direction are the context, and the additional data of AES-256-GCM. A sealed call opens for these peers and this command only, an answer only for the call it answers.
- A peer says `seal: 1` in `help` when it seals. A device seals for such a peer and then takes only a sealed answer; a peer from before is called as before.
- `handoverSecret(invitationSecret)`: the key the handover is sealed with, the one call that brings the bridge its key.
- `sealedSize(n)`: what `n` bytes of JSON take once sealed. An answer grows by a third; JSON that no longer fits a stream answer goes as blocks to a device that takes them.

WebCrypto only: the same bytes in a browser and in Node (`test/seal.test.js`).

```bash
pnpm --filter @le-space/bridge-protocol test   # Node, and a scenario in Chromium
```

AGPL-3.0-or-later.
