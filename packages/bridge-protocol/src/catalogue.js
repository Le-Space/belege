// SPDX-License-Identifier: AGPL-3.0-or-later
// The bridge's commands as both sides know them (Le-Space/belege#577,
// milestone M2.1 of #567): one entry per command, with
//
// - `name`: what a device calls it by (`bank.transactions`), the UCEP
//   command of the extension `belege-bridge` from protocol version 2 on;
// - `version`: the command's own, raised when its arguments or answer change
//   in a way an older caller would misread;
// - `scope`: the grant a device needs for it (the bridge's grants.js), ''
//   for none;
// - `method` and `path`: how HTTP carries it, a `{name}` in the path taken
//   from the arguments (http.js maps both ways);
// - `args`: where HTTP puts the arguments: the query, a JSON body, the raw
//   bytes, or none;
// - `answer`: JSON, bytes (a mail attachment, a Paperless original) or text;
// - `via`: both transports, HTTP only (pairing, shares) or the stream only;
// - `request`: the arguments' schema (schema.js), checked by the caller
//   before sending and by the bridge before the command runs;
// - `response`: the JSON answer's schema, its outer shape.
//
// The bridge's own checks stay where they are (bridge/src/commands.js): a
// schema says what a call looks like, the command what it may do. Values in
// the query are strings over HTTP; here they have their type (`days: 14`),
// and http.js writes them as text.

/** @typedef {import('./schema.js').Schema} Schema */

/**
 * @typedef {object} CommandSpec
 * @property {string} name
 * @property {number} version
 * @property {string} scope
 * @property {'GET' | 'POST' | 'DELETE'} method
 * @property {string} path
 * @property {'none' | 'query' | 'json' | 'bytes'} args
 * @property {'json' | 'bytes' | 'text'} answer
 * @property {'both' | 'http' | 'stream'} via
 * @property {Schema} request
 * @property {Schema} [response]
 * @property {string} description
 */

/** The protocol's version: the extension `belege-bridge` speaks named commands from 2 on. */
export const PROTOCOL_VERSION = 2;

const DAY = '^\\d{4}-\\d{2}-\\d{2}$';
const MAIL_ID = '^[A-Za-z0-9_-]{8,700}$';
const AMOUNT = '^-?[\\d.,]{1,15}$';
const ACCOUNT_NUMBER = '^\\d{4,8}$';

/** @param {number} max @returns {Schema} */
const text = (max) => ({ type: 'string', maxLength: max });
/** @param {number} max @returns {Schema} */
const optText = (max) => ({ type: ['string', 'null'], maxLength: max });
/** @type {Schema} */
const day = { type: 'string', pattern: DAY };
/** @type {Schema} */
const none = { type: 'object', additionalProperties: false };
/** The company names the app adds to every model call (the bridge's redact.js). @type {Schema} */
const redactTerms = { type: 'array', maxItems: 20, items: text(200) };

/**
 * @param {Record<string, Schema>} properties
 * @param {string[]} [required]
 * @param {boolean} [closed] no other key
 * @returns {Schema}
 */
const object = (properties, required = [], closed = true) => ({
	type: 'object',
	properties,
	required,
	...(closed ? { additionalProperties: false } : {})
});

/** @param {string[]} keys @returns {Schema} the outer shape of an answer */
const answerWith = (keys) => ({ type: 'object', required: keys });

/** @type {CommandSpec[]} */
export const COMMANDS = [
	{
		name: 'bridge.health',
		version: 1,
		scope: '',
		method: 'GET',
		path: '/health',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['ok', 'service', 'version', 'paired']),
		description: 'Whether the bridge runs, and which integrations are set up'
	},
	{
		name: 'session.pair',
		version: 1,
		scope: '',
		method: 'POST',
		path: '/pair',
		args: 'json',
		answer: 'json',
		via: 'http',
		request: object({ code: text(64) }, ['code']),
		response: answerWith(['token']),
		description: 'Pair with the code the bridge printed; answers the token'
	},
	{
		name: 'session.unpair',
		version: 1,
		scope: '',
		method: 'POST',
		path: '/unpair',
		args: 'none',
		answer: 'json',
		via: 'http',
		request: none,
		response: answerWith(['ok']),
		description: 'Forget the token this call came with'
	},
	{
		name: 'share.read',
		version: 1,
		scope: '',
		method: 'GET',
		path: '/share/{id}',
		args: 'none',
		answer: 'text',
		via: 'http',
		request: object({ id: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } }, ['id']),
		description: 'A share by its id, for an assistant: no token, no origin'
	},
	{
		name: 'share.create',
		version: 1,
		scope: 'bridge:share',
		method: 'POST',
		path: '/share',
		args: 'json',
		answer: 'json',
		via: 'http',
		request: object(
			{
				scope: text(200),
				redacted: { type: 'boolean' },
				minutes: { type: 'number', minimum: 1 },
				data: {}
			},
			['scope', 'redacted', 'minutes', 'data']
		),
		response: { type: 'object' },
		description: 'Share data for a while under a link an assistant can read'
	},
	{
		name: 'share.list',
		version: 1,
		scope: 'bridge:share',
		method: 'GET',
		path: '/share',
		args: 'none',
		answer: 'json',
		via: 'http',
		request: none,
		response: answerWith(['shares']),
		description: 'The open shares, without their data'
	},
	{
		name: 'share.revoke',
		version: 1,
		scope: 'bridge:share',
		method: 'DELETE',
		path: '/share/{id}',
		args: 'none',
		answer: 'json',
		via: 'http',
		request: object({ id: { type: 'string', pattern: '^[A-Za-z0-9_-]{22}$' } }, ['id']),
		response: answerWith(['ok']),
		description: 'End a share before its time'
	},
	{
		name: 'bank.accounts',
		version: 1,
		scope: 'bridge:bank:read',
		method: 'GET',
		path: '/hibiscus/accounts',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['accounts']),
		description: 'The bank accounts Hibiscus has, those the bridge allows'
	},
	{
		name: 'bank.transactions',
		version: 1,
		scope: 'bridge:bank:read',
		method: 'GET',
		path: '/hibiscus/transactions',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ account: { type: 'string', minLength: 1, maxLength: 64 }, since: day }, [
			'account',
			'since'
		]),
		response: answerWith(['account', 'since', 'transactions']),
		description: 'An account’s transactions since a day'
	},
	{
		name: 'mail.messages',
		version: 1,
		scope: 'bridge:mail:read',
		method: 'GET',
		path: '/mail/messages',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object(
			{
				since: day,
				until: { type: ['string', 'null'], pattern: DAY },
				scope: { const: 'accounting' }
			},
			['since']
		),
		response: answerWith(['messages']),
		description: 'Mails to the accounting address between two days'
	},
	{
		name: 'mail.attachment',
		version: 1,
		scope: 'bridge:mail:read',
		method: 'GET',
		path: '/mail/attachment',
		args: 'query',
		answer: 'bytes',
		via: 'both',
		request: object(
			{
				id: { type: 'string', pattern: MAIL_ID },
				part: { type: 'string', pattern: '^\\d{1,3}(\\.\\d{1,3}){0,6}$' }
			},
			['id', 'part']
		),
		description: 'One part of a mail, as bytes'
	},
	{
		name: 'mail.raw',
		version: 1,
		scope: 'bridge:mail:read',
		method: 'GET',
		path: '/mail/raw',
		args: 'query',
		answer: 'bytes',
		via: 'both',
		request: object({ id: { type: 'string', pattern: MAIL_ID } }, ['id']),
		description: 'A whole mail, as the server keeps it'
	},
	{
		name: 'mail.trash',
		version: 1,
		scope: 'bridge:mail:write',
		method: 'POST',
		path: '/mail/trash',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object({ id: { type: 'string', pattern: MAIL_ID } }, ['id']),
		response: answerWith(['trashed']),
		description: 'Move a mail to the trash'
	},
	{
		name: 'mail.search',
		version: 1,
		scope: 'bridge:mail:read',
		method: 'GET',
		path: '/mail/search',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({
			text: optText(100),
			amount: { type: ['string', 'null'], pattern: AMOUNT },
			from: {
				...optText(310),
				description: 'up to three mail domains, comma-separated'
			},
			term: { type: 'array', maxItems: 6, items: text(100) },
			around: { type: ['string', 'null'], pattern: DAY },
			days: { type: 'integer', minimum: 0, maximum: 60 }
		}),
		response: answerWith(['messages']),
		description: 'Search all folders by text, amount, sender domain or terms'
	},
	{
		name: 'llm.status',
		version: 1,
		scope: 'bridge:llm',
		method: 'GET',
		path: '/llm/status',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: { type: 'object' },
		description: 'The model’s host and names, and whether a key is there'
	},
	{
		name: 'llm.extract',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/extract',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				text: { type: 'string', minLength: 1, maxLength: 250_000 },
				hints: { type: 'object' },
				source: object({ mailId: { type: 'string', pattern: MAIL_ID } }, [], false),
				confirmedByUser: { type: 'boolean' },
				redactTerms
			},
			['text'],
			false
		),
		response: answerWith(['extraction']),
		description: 'Read a receipt’s text into fields'
	},
	{
		name: 'llm.mail',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/mail/assist',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				counterparty: { type: 'string', minLength: 2, maxLength: 200 },
				purpose: text(1000),
				amount: { type: ['string', 'null'], pattern: '^(-?[\\d.,]{1,15})?$' },
				around: { type: ['string', 'null'], pattern: DAY },
				days: { type: 'integer', minimum: 0, maximum: 60 },
				knownDomains: { type: 'array', maxItems: 3, items: text(100) },
				redactTerms
			},
			['counterparty'],
			false
		),
		response: answerWith(['terms', 'domains', 'messages']),
		description: 'The model finds the mail with a payment’s receipt'
	},
	{
		name: 'llm.match',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/match/assist',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				booking: object(
					{
						counterparty: text(200),
						purpose: text(1000),
						amount: text(200),
						day: text(200)
					},
					[],
					false
				),
				candidates: {
					type: 'array',
					minItems: 1,
					maxItems: 25,
					items: object(
						{
							id: text(64),
							vendor: optText(200),
							amount: optText(200),
							currency: optText(200),
							date: optText(200),
							number: optText(200),
							summary: optText(200)
						},
						['id'],
						false
					)
				},
				redactTerms
			},
			['booking', 'candidates'],
			false
		),
		response: { type: 'object' },
		description: 'The model picks a payment’s receipt among candidates'
	},
	{
		name: 'llm.transfer',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/transfer/assist',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				booking: { type: 'object' },
				candidates: {
					type: 'array',
					minItems: 1,
					maxItems: 8,
					items: { type: 'object' }
				},
				redactTerms
			},
			['booking', 'candidates'],
			false
		),
		response: { type: 'object' },
		description: 'The model picks the other side of a transfer'
	},
	{
		name: 'llm.vendor',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/vendor/assist',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				vendor: text(200),
				rows: {
					type: 'array',
					minItems: 1,
					maxItems: 120,
					items: { type: 'object' }
				},
				findings: { type: 'array', items: text(300) },
				redactTerms
			},
			['vendor', 'rows', 'findings'],
			false
		),
		response: answerWith(['notes']),
		description: 'The model explains a vendor’s timeline'
	},
	{
		name: 'llm.travel',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/travel/assist',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				lang: { enum: ['de', 'en'] },
				trip: { type: 'object' },
				legs: { type: 'array', maxItems: 60, items: { type: 'object' } },
				receipts: { type: 'array', maxItems: 60, items: { type: 'object' } },
				questions: { type: 'array', maxItems: 20, items: text(300) }
			},
			['lang', 'trip', 'legs', 'receipts', 'questions']
		),
		response: answerWith(['notes']),
		description: 'The model checks a trip’s legs against its receipts'
	},
	{
		name: 'llm.booking',
		version: 1,
		scope: 'bridge:llm',
		method: 'POST',
		path: '/booking/assist',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				booking: object(
					{
						direction: { enum: ['in', 'out'] },
						amount: text(30),
						day: text(10),
						account: optText(200),
						counterparty: optText(200),
						purpose: optText(1000)
					},
					['direction', 'amount', 'day'],
					false
				),
				receipt: { type: ['object', 'null'] },
				learned: {
					type: 'array',
					maxItems: 200,
					items: object(
						{
							vendor: text(200),
							account: { type: 'string', pattern: ACCOUNT_NUMBER }
						},
						['vendor', 'account'],
						false
					)
				},
				accounts: {
					type: 'array',
					minItems: 1,
					maxItems: 600,
					items: object(
						{
							number: { type: 'string', pattern: ACCOUNT_NUMBER },
							name: text(120)
						},
						['number', 'name'],
						false
					)
				},
				redactTerms
			},
			['booking', 'accounts'],
			false
		),
		response: answerWith(['picks']),
		description: 'The model suggests a payment’s contra account from the chart'
	},
	{
		name: 'aleph.accounts',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'POST',
		path: '/aleph/accounts',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object(
			{
				addresses: { type: 'array', maxItems: 200, items: text(100) },
				api: optText(300)
			},
			['addresses']
		),
		response: answerWith(['accounts']),
		description: 'Aleph credits and history of addresses'
	},
	{
		name: 'aleph.statement',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/aleph/statement',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ address: text(100), month: text(7), api: optText(300) }, [
			'address',
			'month'
		]),
		response: { type: 'object' },
		description: 'An Aleph address’s month: credits in, usage, balance'
	},
	{
		name: 'backup.status',
		version: 1,
		scope: 'bridge:backup',
		method: 'GET',
		path: '/backup/status',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['aleph']),
		description: 'Whether the Aleph backup is set up, its address and credits'
	},
	{
		name: 'backup.list',
		version: 1,
		scope: 'bridge:backup',
		method: 'GET',
		path: '/backup/aleph/list',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['backups']),
		description: 'The backups Aleph keeps for this address'
	},
	{
		name: 'backup.keep',
		version: 1,
		scope: 'bridge:backup',
		method: 'POST',
		path: '/backup/aleph/pin',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: object({ cid: text(200), ref: text(200), size: { type: 'integer', minimum: 0 } }, [
			'cid'
		]),
		response: { type: 'object' },
		description: 'Keep a backup already uploaded on Aleph'
	},
	{
		name: 'backup.put',
		version: 1,
		scope: 'bridge:backup',
		method: 'POST',
		path: '/backup/aleph',
		args: 'bytes',
		answer: 'json',
		via: 'http',
		request: object({
			name: { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$' },
			ref: text(200)
		}),
		response: { type: 'object' },
		description: 'Upload a sealed backup to Aleph (bytes: over HTTP until #578)'
	},
	{
		name: 'rates.rate',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/rates',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object(
			{
				asset: { type: 'string', pattern: '^[A-Z0-9]{2,10}$' },
				date: day,
				prefer: { const: 'kraken' },
				contract: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
				chain: text(30),
				block: { type: 'integer', minimum: 1 },
				decimals: { type: 'integer', minimum: 0, maximum: 99 }
			},
			['asset', 'date']
		),
		response: answerWith(['rate']),
		description: 'The euro rate of an asset on a day, with its source'
	},
	{
		name: 'kraken.balances',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/kraken/balances',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['balances']),
		description: 'Kraken balances, spot and earn'
	},
	{
		name: 'kraken.ledgers',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/kraken/ledgers',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ since: day }, ['since']),
		response: answerWith(['since', 'entries']),
		description: 'Kraken ledger entries since a day'
	},
	{
		name: 'paperless.documents',
		version: 1,
		scope: 'bridge:paperless:read',
		method: 'GET',
		path: '/paperless/documents',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ since: text(40) }),
		response: answerWith(['documents']),
		description: 'Paperless documents, those added since a time'
	},
	{
		name: 'paperless.search',
		version: 1,
		scope: 'bridge:paperless:read',
		method: 'GET',
		path: '/paperless/search',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ query: text(500) }, ['query']),
		response: answerWith(['documents']),
		description: 'Search Paperless'
	},
	{
		name: 'paperless.document',
		version: 1,
		scope: 'bridge:paperless:read',
		method: 'GET',
		path: '/paperless/document',
		args: 'query',
		answer: 'bytes',
		via: 'both',
		request: object({ id: { type: 'integer', minimum: 1 } }, ['id']),
		description: 'A Paperless document’s file'
	},
	{
		name: 'enablebanking.banks',
		version: 1,
		scope: 'bridge:bank:read',
		method: 'GET',
		path: '/enablebanking/banks',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ country: { type: 'string', minLength: 2, maxLength: 10 } }, ['country']),
		response: answerWith(['banks']),
		description: 'The banks Enable Banking reaches in a country'
	},
	{
		name: 'enablebanking.link',
		version: 1,
		scope: 'bridge:bank:link',
		method: 'POST',
		path: '/enablebanking/link',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: { type: 'object' },
		response: { type: 'object' },
		description: 'Start linking a bank: answers where the bank asks for consent'
	},
	{
		name: 'enablebanking.finish',
		version: 1,
		scope: 'bridge:bank:link',
		method: 'POST',
		path: '/enablebanking/finish',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: { type: 'object' },
		response: answerWith(['link']),
		description: 'Finish linking a bank with what the bank sent back'
	},
	{
		name: 'enablebanking.accounts',
		version: 1,
		scope: 'bridge:bank:read',
		method: 'GET',
		path: '/enablebanking/accounts',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['accounts']),
		description: 'The accounts of the linked banks'
	},
	{
		name: 'enablebanking.transactions',
		version: 1,
		scope: 'bridge:bank:read',
		method: 'GET',
		path: '/enablebanking/transactions',
		args: 'query',
		answer: 'json',
		via: 'both',
		request: object({ account: text(100), since: day }, ['account', 'since']),
		response: { type: 'object' },
		description: 'A linked account’s transactions since a day'
	},
	{
		name: 'enablebanking.links',
		version: 1,
		scope: 'bridge:bank:read',
		method: 'GET',
		path: '/enablebanking/links',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['links']),
		description: 'The linked banks and how long their consent holds'
	},
	{
		name: 'enablebanking.unlink',
		version: 1,
		scope: 'bridge:bank:link',
		method: 'DELETE',
		path: '/enablebanking/links/{id}',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: object(
			{
				id: {
					type: 'string',
					pattern: '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
				}
			},
			['id']
		),
		response: answerWith(['ok']),
		description: 'Forget a linked bank'
	},
	{
		name: 'chains.list',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/chains',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['chains']),
		description: 'The chains the bridge reads'
	},
	{
		name: 'chains.bitcoinKey',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/bitcoin/key',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: answerWith(['configured']),
		description: 'Whether a Bitcoin key is set up, by its fingerprint'
	},
	{
		name: 'chains.akashDeployments',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'POST',
		path: '/akash/deployments',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: { type: 'object' },
		response: answerWith(['deployments']),
		description: 'An Akash address’s deployments and what they cost'
	},
	{
		name: 'chains.wallet',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'POST',
		path: '/{chain}/wallet',
		args: 'json',
		answer: 'json',
		via: 'both',
		request: {
			type: 'object',
			properties: { chain: { type: 'string', pattern: '^[a-z0-9-]{2,30}$' } },
			required: ['chain']
		},
		response: answerWith(['chain', 'entries', 'balances']),
		description: 'An own wallet’s history on a chain'
	},
	{
		name: 'lanRelay.status',
		version: 1,
		scope: 'bridge:chains:read',
		method: 'GET',
		path: '/lan-relay',
		args: 'none',
		answer: 'json',
		via: 'both',
		request: none,
		response: { type: 'object' },
		description: 'The relay for this network, where it listens'
	},
	{
		name: 'settings.export',
		version: 1,
		scope: 'bridge:settings:export',
		method: 'GET',
		path: '/settings/export',
		args: 'none',
		answer: 'json',
		via: 'stream',
		request: none,
		response: answerWith(['config', 'secrets']),
		description: 'What a hosted bridge may take over: settings and secrets (#728)'
	}
];

/** @type {Map<string, CommandSpec>} */
const byName = new Map(COMMANDS.map((c) => [c.name, c]));

/** The command of that name, or undefined. @param {string} name */
export const command = (name) => byName.get(name);
