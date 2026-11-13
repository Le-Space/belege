// SPDX-License-Identifier: AGPL-3.0-or-later
// The catalogue in a browser: a call checked, a bad one named, the HTTP
// path written and read back. browser.test.js runs it in Node and in
// Chromium and compares. Made-up data only.
import { COMMANDS, checkArgs, commandInput, httpRequest } from '../../src/index.js';

export default async function scenario() {
	const args = { text: 'Rechnung', term: ['Abo', 'Übung'], days: 14 };
	return {
		commands: COMMANDS.length,
		good: checkArgs('mail.search', args),
		bad: checkArgs('kraken.ledgers', { since: '13.10.2026', extra: true }),
		path: httpRequest('mail.search', args).path,
		query: commandInput('mail.search', args).query.getAll('term')[1]
	};
}
