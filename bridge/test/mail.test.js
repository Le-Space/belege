// The mail endpoints end to end in-process: a fake IMAP server (hoodiecrow)
// with a synthetic mailbox, the real mail client, server and pairing.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

import { createBridgeServer } from '../src/server.js';
import { createPairing } from '../src/pairing.js';
import { defaultConfig } from '../src/config.js';
import { createMailClient } from '../src/mail/imap.js';
import { encodeMailId } from '../src/mail/mime.js';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	RECEIPTS,
	isoDay,
	sampleMailbox,
	startFakeImap
} from './support/fake-imap.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
// Fixed dates, so the windows are exact: the receipts lie 1–5 days before the base.
const BASE = new Date('2026-08-20T09:00:00Z');
const SINCE = '2026-08-01';
const UNTIL = '2026-09-01';

describe('mail endpoints', () => {
	/** @type {Awaited<ReturnType<typeof startFakeImap>>} */ let imap;
	/** @type {ReturnType<typeof createBridgeServer>} */ let bridge;
	/** @type {number} */ let port;
	/** @type {string} */ let token;
	let passwordReads = 0;
	/** @type {string[]} */ const logged = [];

	before(async () => {
		imap = await startFakeImap({ storage: sampleMailbox({ base: BASE }) });
		const config = {
			...defaultConfig(),
			appOrigins: [APP],
			mail: {
				...defaultConfig().mail,
				host: imap.host,
				port: imap.port,
				user: imap.user,
				tls: /** @type {const} */ ('none')
			}
		};
		/** @type {{ hash: string, createdAt: string }[]} */
		let hashes = [];
		const pairing = createPairing({
			getHashes: () => hashes,
			saveHashes: async (h) => {
				hashes = h;
			}
		});
		const mail = createMailClient({
			config: config.mail,
			getPassword: async () => {
				passwordReads++;
				return FAKE_IMAP_PASSWORD;
			}
		});
		bridge = createBridgeServer({
			config,
			pairing,
			hibiscus: null,
			mail,
			log: (l) => logged.push(l)
		});
		port = (await bridge.listen({ port: 0 })).port;
		const code = pairing.issueCode();
		token = (await request(port, '/pair', { method: 'POST', body: { code } })).json.token;
	});

	after(async () => {
		await bridge?.close();
		await imap?.close();
	});

	const get = (/** @type {string} */ path) =>
		request(port, path, { headers: { origin: APP, authorization: `Bearer ${token}` } });

	/** @type {any[]} */ let listed = [];

	test('needs a token, and asks nothing of the keychain or the server without one', async () => {
		const res = await request(port, `/mail/messages?since=${SINCE}`, { headers: { origin: APP } });
		assert.equal(res.status, 401);
		assert.equal(passwordReads, 0);
	});

	test('bad parameters are refused before the server is asked', async () => {
		for (const path of [
			'/mail/messages',
			'/mail/messages?since=01.08.2026',
			`/mail/messages?since=${SINCE}&until=2026-07-01`,
			`/mail/messages?since=${SINCE}&scope=all`,
			'/mail/attachment?id=nope&part=2',
			`/mail/attachment?id=${encodeMailId({ folder: 'INBOX', uidValidity: 1, uid: 1 })}&part=../1`,
			'/mail/search',
			'/mail/search?text=ab',
			'/mail/search?amount=12;DROP',
			'/mail/search?text=Stromwerk&days=365'
		]) {
			assert.equal((await get(path)).status, 400, path);
		}
		assert.equal(passwordReads, 0);
	});

	test('the accounting scope: To: or Received-for the alias, all folders but Trash/Junk/Drafts', async () => {
		const res = await get(`/mail/messages?since=${SINCE}&until=${UNTIL}&scope=accounting`);
		assert.equal(res.status, 200);
		assert.equal(res.json.accountingAddress, ACCOUNTING);
		listed = res.json.messages;
		const subjects = listed.map((m) => m.subject).sort();
		assert.deepEqual(subjects, [
			'Fwd: Beleg Buerobedarf',
			'Ihre Bestellung 2026-555',
			'Ihre Rechnung WF-2026-0815',
			'Ihre Taxiquittung',
			'Rechnung zu Ihrem Vertrag',
			'Zahlung fehlgeschlagen – Zahlungsmethode aktualisieren'
		]);
		// Private mail, the newsletter, Trash, Junk and the mail from before the window are not there.
		for (const secret of [
			'Privatgeheimnis',
			'Geloescht',
			'Junkordner',
			'Alte Rechnung',
			'Energie-News',
			'freunde.example'
		]) {
			assert.equal(res.text.includes(secret), false, secret);
		}
		assert.equal(passwordReads > 0, true, 'the password came from the (fake) keychain');
		assert.equal(res.text.includes(FAKE_IMAP_PASSWORD), false);
	});

	test('how each mail reached the alias, and who sent it', () => {
		const by = (/** @type {string} */ s) => listed.find((m) => m.subject.startsWith(s));
		assert.equal(by('Ihre Rechnung').addressedBy, 'to');
		assert.equal(
			by('Rechnung zu Ihrem Vertrag').addressedBy,
			'received',
			'Bcc: only Received says so'
		);
		assert.equal(by('Ihre Rechnung').from.address, 'rechnung@wolkenfabrik.example');
		assert.equal(by('Ihre Rechnung').folder, 'INBOX');
		assert.equal(by('Fwd:').folder, 'Sent');
		assert.equal(by('Fwd:').outgoing, true);
		assert.equal(by('Ihre Rechnung').outgoing, false);
		assert.equal(
			by('Ihre Rechnung').date,
			new Date(BASE.getTime() - 864e5).toISOString().replace(/\.\d+Z$/, '.000Z')
		);
	});

	test('DKIM/SPF: pass, fail for the look-alike, none for our own forward', () => {
		const by = (/** @type {string} */ s) => listed.find((m) => m.subject.startsWith(s));
		assert.deepEqual(by('Ihre Rechnung').auth, {
			verdict: 'pass',
			dkim: 'pass',
			spf: 'pass',
			dmarc: 'pass',
			domain: 'wolkenfabrik.example'
		});
		assert.equal(by('Zahlung fehlgeschlagen').auth.verdict, 'fail');
		assert.equal(by('Zahlung fehlgeschlagen').auth.dkim, 'fail');
		assert.equal(by('Fwd:').auth.verdict, 'none');
	});

	test('attachments: PDFs by their bytes (octet-stream, .PDF), images only as attachments', () => {
		const by = (/** @type {string} */ s) => listed.find((m) => m.subject.startsWith(s));
		assert.deepEqual(
			by('Ihre Rechnung').attachments.map((/** @type {any} */ a) => [
				a.name,
				a.type,
				a.kind,
				a.isPdf
			]),
			[['Rechnung-WF-2026-0815.pdf', 'application/pdf', 'pdf', true]]
		);
		assert.deepEqual(
			by('Rechnung zu Ihrem Vertrag').attachments.map((/** @type {any} */ a) => [
				a.name,
				a.type,
				a.kind
			]),
			[['RECHNUNG.PDF', 'application/octet-stream', 'pdf']]
		);
		const taxi = by('Ihre Taxiquittung').attachments;
		assert.deepEqual(
			taxi.map((/** @type {any} */ a) => [a.name, a.kind, a.mime]),
			[
				['logo.png', 'other', null],
				['quittung.jpg', 'image', 'image/jpeg']
			],
			'the inline logo is not sniffed as a receipt'
		);
		assert.deepEqual(by('Ihre Bestellung').attachments, []);
		assert.ok(by('Ihre Rechnung').attachments[0].size > 0);
	});

	test('an excerpt of the text, HTML stripped, for mails without an attachment', () => {
		const order = listed.find((m) => m.subject.startsWith('Ihre Bestellung'));
		assert.match(order.excerpt, /Danke für Ihre Bestellung bei Papierladen Test KG/);
		assert.match(order.excerpt, /Summe: 23,80 EUR/);
		assert.equal(/<|alert|color:red/.test(order.excerpt), false);
		const invoice = listed.find((m) => m.subject.startsWith('Ihre Rechnung'));
		assert.match(invoice.excerpt, /im Anhang finden Sie Ihre Rechnung/);
		assert.ok(listed.every((m) => m.excerpt.length <= 2000));
	});

	test('a window with an open end, and one that ends before the receipts', async () => {
		const open = await get(`/mail/messages?since=${SINCE}`);
		assert.equal(open.status, 200);
		assert.equal(open.json.messages.length, 6);
		const early = await get('/mail/messages?since=2026-06-01&until=2026-06-20');
		assert.deepEqual(
			early.json.messages.map((/** @type {any} */ m) => m.subject),
			['Alte Rechnung'],
			'only the old one lies in June'
		);
	});

	test('attachment: the bytes of a PDF, with its type by the bytes', async () => {
		const m = listed.find((x) => x.subject === 'Rechnung zu Ihrem Vertrag');
		const res = await get(`/mail/attachment?id=${m.id}&part=${m.attachments[0].part}`);
		assert.equal(res.status, 200);
		assert.equal(res.headers['content-type'], 'application/pdf');
		assert.match(String(res.headers['content-security-policy']), /sandbox/);
		assert.ok(res.text.startsWith('%PDF-'));
		assert.ok(res.text.includes(RECEIPTS.stromwerk.marker));
	});

	test('attachment: an image is handed out, a text part is not', async () => {
		const taxi = listed.find((x) => x.subject === 'Ihre Taxiquittung');
		const jpg = taxi.attachments.find((/** @type {any} */ a) => a.name === 'quittung.jpg');
		const res = await get(`/mail/attachment?id=${taxi.id}&part=${jpg.part}`);
		assert.equal(res.status, 200);
		assert.equal(res.headers['content-type'], 'image/jpeg');
		// Part 1 is the HTML body: not an attachment, not handed out.
		const body = await get(`/mail/attachment?id=${taxi.id}&part=1`);
		assert.equal(body.status, 404);
	});

	test('attachment: unknown mail, wrong UIDVALIDITY, unknown part', async () => {
		const m = listed.find((x) => x.subject.startsWith('Ihre Rechnung'));
		const wrongValidity = encodeMailId({ folder: 'INBOX', uidValidity: 999, uid: m.uid });
		assert.equal((await get(`/mail/attachment?id=${wrongValidity}&part=2`)).status, 404);
		const nofolder = encodeMailId({ folder: 'Nirgendwo', uidValidity: 1, uid: 1 });
		assert.equal((await get(`/mail/attachment?id=${nofolder}&part=2`)).status, 404);
		assert.equal((await get(`/mail/attachment?id=${m.id}&part=9`)).status, 404);
	});

	test('search: text and every amount spelling, ± days, Junk included, Trash not; says what matched', async () => {
		const around = isoDay(new Date(BASE.getTime() - 2 * 864e5));
		const res = await get(`/mail/search?text=Stromwerk&amount=52,59&around=${around}&days=7`);
		assert.equal(res.status, 200);
		/** @type {Record<string, string[]>} */
		const hits = Object.fromEntries(
			res.json.messages.map((/** @type {any} */ m) => [m.subject, [...m.matched].sort()])
		);
		assert.deepEqual(hits, {
			'Rechnung zu Ihrem Vertrag': ['"Stromwerk"', '52,59'],
			'Neues von Stromwerk und anderen': ['"Stromwerk"'],
			'Urlaub Privatgeheimnis': ['52,59'],
			'Spamrechnung Junkordner 52,59': ['52,59']
		});
		// Hits carry the same shape as the listing.
		const strom = res.json.messages.find(
			(/** @type {any} */ m) => m.subject === 'Rechnung zu Ihrem Vertrag'
		);
		assert.equal(strom.attachments[0].isPdf, true);
		assert.equal(strom.auth.verdict, 'pass');
	});

	test('search: the other spellings of an amount (1.190,00 → 1,190.00 …) and the window', async () => {
		const around = isoDay(BASE);
		const res = await get(`/mail/search?amount=52.59&around=${around}&days=2`);
		assert.equal(res.status, 200);
		assert.deepEqual(
			res.json.messages.map((/** @type {any} */ m) => m.subject).sort(),
			['Rechnung zu Ihrem Vertrag', 'Spamrechnung Junkordner 52,59', 'Urlaub Privatgeheimnis'],
			'52.59 finds 52,59'
		);
		const far = await get(`/mail/search?text=Stromwerk&around=2026-01-15&days=3`);
		assert.deepEqual(far.json.messages, []);
	});

	test('nothing about a mail is logged', () => {
		const text = logged.join('\n');
		for (const s of ['Rechnung', 'wolkenfabrik', 'Stromwerk', 'Privat', ACCOUNTING]) {
			assert.equal(text.includes(s), false, s);
		}
	});

	test('mail not set up: 503 with the setup command', async () => {
		/** @type {{ hash: string, createdAt: string }[]} */
		let hashes = [];
		const pairing = createPairing({
			getHashes: () => hashes,
			saveHashes: async (h) => {
				hashes = h;
			}
		});
		const other = createBridgeServer({
			config: { ...defaultConfig(), appOrigins: [APP] },
			pairing,
			hibiscus: null,
			mail: null
		});
		const p = (await other.listen({ port: 0 })).port;
		const t = await pairing.pair(pairing.issueCode());
		const res = await request(p, `/mail/messages?since=${SINCE}`, {
			headers: { origin: APP, authorization: `Bearer ${t}` }
		});
		assert.equal(res.status, 503);
		assert.match(res.json.error, /setup:mail/);
		const health = await request(p, '/health');
		assert.deepEqual(health.json.mail, { configured: false, accountingAddress: null });
		await other.close();
	});
});

test('the mail client refuses plain IMAP to another machine', () => {
	assert.throws(
		() =>
			createMailClient({
				config: { ...defaultConfig().mail, host: 'mail.example', user: 'u', tls: 'none' },
				getPassword: async () => 'x'
			}),
		/only allowed to a server on this machine/
	);
	assert.throws(
		() => createMailClient({ config: defaultConfig().mail, getPassword: async () => 'x' }),
		/setup:mail/
	);
});
