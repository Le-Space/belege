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

```bash
pnpm --filter @le-space/bridge-protocol test   # Node, and a scenario in Chromium
```

AGPL-3.0-or-later.
