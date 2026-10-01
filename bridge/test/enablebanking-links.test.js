// Enable Banking, step 2 (issue #224): linking a bank and unlinking it,
// against the fake – its bank page sends the "browser" back like a real one.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { createEnableBankingClient, enableBankingSecrets } from '../src/enablebanking.js';
import { createEnableBankingLinks } from '../src/enablebanking-links.js';
import { ibanKey, normalizeEnableBankingTransaction } from '../src/enablebanking-normalize.js';
import { runEnableBankingAccounts } from '../src/setup-enablebanking.js';
import { memoryKeychain } from '../src/keychain.js';
import { startBridge } from '../src/index.js';
import {
	FAKE_EB_APP_ID,
	FAKE_EB_PRIVATE_KEY,
	sampleEnableBankingTransactions,
	startFakeEnableBanking
} from './support/fake-enablebanking.js';
import { request } from './support/http.js';

const APP = 'http://localhost:5173';
const REDIRECT = 'https://belege.le-space.de/integrationen/bank/verbunden';

/** @type {Awaited<ReturnType<typeof startFakeEnableBanking>>} */ let eb;
/** @type {string} */ let dir;
let n = 0;

before(async () => {
	eb = await startFakeEnableBanking();
	dir = await mkdtemp(join(tmpdir(), 'belege-eb-links-'));
});
after(async () => {
	await eb?.close();
	await rm(dir, { recursive: true, force: true });
});

/** A linking module on a fresh sealed file. @param {{ now?: () => number }} [over] */
async function setup(over = {}) {
	const keychain = memoryKeychain(null, 'enablebanking');
	const secrets = enableBankingSecrets({
		configPath: join(dir, `c${n++}`, 'bridge.json'),
		keychain
	});
	await secrets.write({ privateKey: FAKE_EB_PRIVATE_KEY, sessions: {} });
	/** @type {string[]} */ const logged = [];
	const client = createEnableBankingClient({
		appId: FAKE_EB_APP_ID,
		baseUrl: eb.url,
		getPrivateKey: async () => FAKE_EB_PRIVATE_KEY
	});
	const links = createEnableBankingLinks({
		client,
		secrets,
		redirectUrl: REDIRECT,
		log: (l) => logged.push(l),
		...over
	});
	return { links, secrets, logged };
}

/** What the browser does at the bank: follow the link once, read where it is sent back to. @param {string} url */
async function atTheBank(url) {
	const res = await fetch(url, { redirect: 'manual' });
	assert.equal(res.status, 302);
	const back = new URL(/** @type {string} */ (res.headers.get('location')));
	assert.equal(`${back.origin}${back.pathname}`, REDIRECT);
	return back.searchParams;
}

test('the banks of a country, sorted, with the kinds of account each offers', async () => {
	const { links } = await setup();
	assert.deepEqual(await links.banks('DE'), [
		{
			name: 'Beispielbank',
			country: 'DE',
			psuTypes: ['personal', 'business'],
			maxConsentDays: 180,
			beta: false
		},
		{
			name: 'Musterbank Privat',
			country: 'DE',
			psuTypes: ['personal'],
			maxConsentDays: 90,
			beta: false
		}
	]);
	await assert.rejects(links.banks('de'), /two-letter/);
});

test('a link: the bank sends the code back, the bridge turns it into a session and keeps it sealed', async () => {
	const { links, secrets, logged } = await setup();
	const started = await links.start({ bank: 'Beispielbank', country: 'DE' });
	const back = await atTheBank(started.url);
	assert.equal(back.get('state'), started.state);

	const link = await links.finish({ code: back.get('code'), state: back.get('state') });
	assert.equal(link.bank, 'Beispielbank');
	assert.equal(link.psuType, 'business', 'business, where the bank offers it');
	assert.deepEqual(
		link.accounts.map((a) => [a.uid, a.ibanLast4, a.name, a.currency]),
		[
			['acc-0001', '1234', 'Geschäftskonto', 'EUR'],
			['acc-0002', '5678', 'Tagesgeld', 'EUR']
		]
	);
	assert.doesNotMatch(JSON.stringify(link), /DE00/, 'no full IBAN for the app');
	assert.deepEqual(await links.list(), [link]);
	const sealed = /** @type {any} */ (await secrets.read());
	assert.equal(sealed.sessions[link.id].accounts[0].iban, 'DE00000000000000001234');
	assert.equal(sealed.privateKey, FAKE_EB_PRIVATE_KEY, 'the key is kept beside the sessions');
	// About 180 days of consent; the log has no bank name and no code.
	const days = (Date.parse(/** @type {string} */ (link.validUntil)) - Date.now()) / 86_400_000;
	assert.ok(days > 179 && days <= 180, String(days));
	assert.ok(
		logged.every((l) => !/Beispielbank|DE00/.test(l) && !l.includes(String(back.get('code'))))
	);
});

test('an answer is used once, and only for a link started here, within 30 minutes', async () => {
	let clock = Date.now();
	const { links } = await setup({ now: () => clock });
	const started = await links.start({ bank: 'Beispielbank', country: 'DE' });
	const back = await atTheBank(started.url);
	await links.finish({ code: back.get('code'), state: back.get('state') });
	await assert.rejects(
		links.finish({ code: back.get('code'), state: back.get('state') }),
		(/** @type {any} */ e) => {
			assert.equal(e.code, 'EB_STATE');
			assert.equal(e.status, 409);
			return true;
		}
	);

	// Someone else's link, with its own state: no such state here.
	const other = await setup();
	const theirs = await other.links.start({ bank: 'Beispielbank', country: 'DE' });
	const theirBack = await atTheBank(theirs.url);
	await assert.rejects(
		links.finish({ code: theirBack.get('code'), state: theirBack.get('state') }),
		/belongs to no link started here/
	);

	const late = await links.start({ bank: 'Beispielbank', country: 'DE' });
	const lateBack = await atTheBank(late.url);
	clock += 31 * 60_000;
	await assert.rejects(
		links.finish({ code: lateBack.get('code'), state: lateBack.get('state') }),
		/older than 30 minutes/
	);
	await assert.rejects(links.finish({ code: 'x', state: 'y' }), /code and state are required/);
});

test('a bank or a kind of account it does not offer is refused before Enable Banking is asked', async () => {
	const { links } = await setup();
	await assert.rejects(links.start({ bank: 'Erfundene Bank', country: 'DE' }), /no such bank/);
	await assert.rejects(
		links.start({ bank: 'Musterbank Privat', country: 'DE', psuType: 'business' }),
		/does not offer that kind/
	);
	const personal = await links.start({ bank: 'Musterbank Privat', country: 'DE' });
	const back = await atTheBank(personal.url);
	const link = await links.finish({ code: back.get('code'), state: back.get('state') });
	assert.equal(link.psuType, 'personal');
	const days = (Date.parse(/** @type {string} */ (link.validUntil)) - Date.now()) / 86_400_000;
	assert.ok(days > 89 && days <= 90, 'no longer than the bank allows');
});

test('unlink: closed at Enable Banking and forgotten; already closed there is forgotten too', async () => {
	const { links } = await setup();
	const make = async () => {
		const s = await links.start({ bank: 'Beispielbank', country: 'DE' });
		const back = await atTheBank(s.url);
		return links.finish({ code: back.get('code'), state: back.get('state') });
	};
	const a = await make();
	const b = await make();
	await links.unlink(a.id);
	assert.equal(eb.state.sessions.get(a.id)?.open, false);
	assert.deepEqual(
		(await links.list()).map((l) => l.id),
		[b.id]
	);
	await assert.rejects(links.unlink(a.id), /no such link/);

	/** @type {any} */ (eb.state.sessions.get(b.id)).open = false;
	await links.unlink(b.id);
	assert.deepEqual(await links.list(), []);
});

test('the routes: behind the token, 503 until set up, and a whole link through the bridge', async () => {
	/** @param {any} enablebanking */
	const run = async (
		enablebanking,
		/** @type {(port: number, auth: any) => Promise<void>} */ check
	) => {
		const configPath = join(dir, `bridge${n++}`, 'bridge.json');
		await saveConfig({ ...defaultConfig(), appOrigins: [APP], enablebanking }, configPath);
		const keychain = memoryKeychain(null, 'enablebanking');
		if (enablebanking.configured) {
			await enableBankingSecrets({ configPath, keychain }).write({
				privateKey: FAKE_EB_PRIVATE_KEY,
				sessions: {}
			});
		}
		/** @type {string[]} */ const printed = [];
		const bridge = await startBridge({
			configPath,
			enablebankingKeychain: keychain,
			keychain: memoryKeychain(),
			coingeckoKeychain: memoryKeychain(null, 'coingecko'),
			port: 0,
			print: (l) => printed.push(l),
			log: () => {}
		});
		try {
			const port = bridge.address.port;
			const code = printed.join('\n').match(/\b([A-Z2-9]{4}[- ]?[A-Z2-9]{4})\b/)?.[1];
			const paired = await request(port, '/pair', {
				method: 'POST',
				headers: { origin: APP },
				body: { code }
			});
			await check(port, { origin: APP, authorization: `Bearer ${paired.json.token}` });
		} finally {
			await bridge.close();
		}
	};

	await run({ configured: false }, async (port, auth) => {
		const res = await request(port, '/enablebanking/banks?country=DE', { headers: auth });
		assert.equal(res.status, 503);
		assert.equal(res.json.code, 'EB_NOT_SET_UP');
	});

	await run(
		{ configured: true, appId: FAKE_EB_APP_ID, baseUrl: eb.url, redirectUrl: REDIRECT },
		async (port, auth) => {
			assert.equal(
				(await request(port, '/enablebanking/banks?country=DE', { headers: { origin: APP } }))
					.status,
				401
			);
			const banks = await request(port, '/enablebanking/banks?country=DE', { headers: auth });
			assert.equal(banks.json.banks.length, 2);
			const started = await request(port, '/enablebanking/link', {
				method: 'POST',
				headers: auth,
				body: { bank: 'Beispielbank', country: 'DE' }
			});
			assert.equal(started.status, 200);
			const back = await atTheBank(started.json.url);
			const finished = await request(port, '/enablebanking/finish', {
				method: 'POST',
				headers: auth,
				body: { code: back.get('code'), state: back.get('state') }
			});
			assert.equal(finished.status, 200);
			// No suffix set up: the account is listed as staying, and nothing of it leaves.
			const accounts = await request(port, '/enablebanking/accounts', { headers: auth });
			assert.deepEqual(
				accounts.json.accounts.map((/** @type {any} */ a) => [a.allowed, a.ibanKey]),
				[
					[false, null],
					[false, null]
				]
			);
			const refused = await request(
				port,
				'/enablebanking/transactions?account=acc-0001&since=2026-01-01',
				{ headers: auth }
			);
			assert.equal(refused.status, 404);
			const listed = await request(port, '/enablebanking/links', { headers: auth });
			assert.deepEqual(listed.json.links, [finished.json.link]);
			const again = await request(port, '/enablebanking/finish', {
				method: 'POST',
				headers: auth,
				body: { code: back.get('code'), state: back.get('state') }
			});
			assert.equal(again.status, 409);
			const gone = await request(port, `/enablebanking/links/${finished.json.link.id}`, {
				method: 'DELETE',
				headers: auth
			});
			assert.equal(gone.status, 200);
			assert.deepEqual(
				(await request(port, '/enablebanking/links', { headers: auth })).json.links,
				[]
			);
		}
	);
});

// Step 3: accounts that may leave, and their transactions.

test('a transaction in the app’s shape: sign from the indicator, the other side, the purpose lines', () => {
	const [pending, fee, debit, credit] = sampleEnableBankingTransactions().map((t) =>
		normalizeEnableBankingTransaction(t, { currency: 'EUR' })
	);
	assert.equal(pending, null, 'a pending entry is not imported');
	assert.equal(fee?.amountCents, -490);
	assert.equal(fee?.counterpartyName, '');
	assert.equal(fee?.bookingType, 'Abschluss');
	assert.deepEqual(
		[
			debit?.sourceId,
			debit?.amountCents,
			debit?.counterpartyName,
			debit?.counterpartyIban,
			debit?.purpose
		],
		[
			'EB-REF-0002',
			-11900,
			'Wolkenfabrik Hosting GmbH',
			'DE00000000000000002222',
			'RE-1001 Kundennummer 4711'
		]
	);
	assert.equal(credit?.amountCents, 238000);
	assert.equal(credit?.counterpartyName, 'Kundin Beispiel AG');
	assert.notEqual(credit?.valueDate, credit?.date);
	const odd = normalizeEnableBankingTransaction(
		{ transaction_id: 'T-9', transaction_amount: { amount: 'viel', currency: 'EUR' } },
		{ currency: 'EUR' }
	);
	assert.equal(odd?.sourceId, 'T-9');
	assert.ok(Number.isNaN(odd?.amountCents), 'an unreadable amount is left for the app to skip');
});

test('the IBAN key is the app’s (pinned on both sides)', () => {
	assert.equal(
		ibanKey('DE00 0000 0000 0000 0012 34'),
		'iban-sha256:f132c600c5d086b136ebb1fafa4cb6787f25da72c95ce14a47144d1c04c4c1bb'
	);
});

/** A linked Beispielbank, with these suffixes allowed. @param {string[]} suffixes */
async function linkedWith(suffixes) {
	const { links: plain, secrets } = await setup();
	const started = await plain.start({ bank: 'Beispielbank', country: 'DE' });
	const back = await atTheBank(started.url);
	await plain.finish({ code: back.get('code'), state: back.get('state') });
	/** @type {string[]} */ const logged = [];
	const links = createEnableBankingLinks({
		client: createEnableBankingClient({
			appId: FAKE_EB_APP_ID,
			baseUrl: eb.url,
			getPrivateKey: async () => FAKE_EB_PRIVATE_KEY
		}),
		secrets,
		redirectUrl: REDIRECT,
		allowedSuffixes: () => suffixes,
		log: (l) => logged.push(l)
	});
	return { links, logged };
}

test('only an allowed account leaves: its key goes along, the others say only that they stay', async () => {
	const { links } = await linkedWith(['1234']);
	const accounts = await links.accounts();
	assert.deepEqual(
		accounts.map((a) => [a.ibanLast4, a.allowed, a.ibanKey?.slice(0, 12) ?? null]),
		[
			['1234', true, 'iban-sha256:'],
			['5678', false, null]
		]
	);
	await assert.rejects(links.transactions('acc-0002', '2026-01-01'), (/** @type {any} */ e) => {
		assert.equal(e.status, 404);
		return true;
	});
	await assert.rejects(links.transactions('acc-9999', '2026-01-01'), /no such account/);
	await assert.rejects(links.transactions('acc-0001', '1.1.2026'), /YYYY-MM-DD/);
});

test('the transactions of an allowed account, all pages, booked only, from the day asked', async () => {
	const { links, logged } = await linkedWith(['1234']);
	const before = eb.state.transactionPages;
	const all = await links.transactions('acc-0001', '2000-01-01');
	assert.equal(eb.state.transactionPages - before, 2, 'two pages of two');
	assert.deepEqual(
		all.transactions.map((t) => t.sourceId),
		['EB-REF-0003', 'EB-REF-0002', 'EB-REF-0001']
	);
	assert.equal(all.pending, 1);
	assert.equal(all.complete, true);
	const recent = await links.transactions(
		'acc-0001',
		new Date(Date.now() - 5 * 86_400_000).toISOString().slice(0, 10)
	);
	assert.deepEqual(
		recent.transactions.map((t) => t.sourceId),
		['EB-REF-0003']
	);
	assert.ok(
		logged.every((l) => !/Wolkenfabrik|Kundin|119|2380/.test(l)),
		'counts only in the log'
	);
});

test('setup --accounts lists the linked accounts and saves the suffixes', async () => {
	const configPath = join(dir, `acc${n++}`, 'bridge.json');
	await saveConfig(
		{
			...defaultConfig(),
			enablebanking: {
				configured: true,
				appId: FAKE_EB_APP_ID,
				baseUrl: eb.url,
				redirectUrl: REDIRECT
			}
		},
		configPath
	);
	const keychain = memoryKeychain(null, 'enablebanking');
	await enableBankingSecrets({ configPath, keychain }).write({
		privateKey: FAKE_EB_PRIVATE_KEY,
		sessions: {
			'00000000-0000-4000-8000-000000000001': {
				bank: 'Beispielbank',
				accounts: [
					{
						uid: 'acc-0001',
						iban: 'DE00000000000000001234',
						name: 'Geschäftskonto',
						currency: 'EUR'
					},
					{ uid: 'acc-0002', iban: 'DE00000000000000005678', name: 'Tagesgeld', currency: 'EUR' }
				]
			}
		}
	});
	/** @type {string[]} */ const out = [];
	const answers = ['1234'];
	const io = {
		ask: async () => answers.shift() ?? '',
		print: (/** @type {string} */ l) => out.push(l)
	};
	assert.equal(await runEnableBankingAccounts({ io, keychain, configPath }), true);
	assert.deepEqual((await loadConfig(configPath)).enablebanking.ibanSuffixes, ['1234']);
	assert.ok(out.some((l) => l.includes('[ ] Beispielbank · Geschäftskonto · ····1234 · EUR')));
	assert.ok(out.some((l) => /1 of 2 account\(s\) may leave/.test(l)));
	assert.ok(!out.join('\n').includes('DE00'), 'never the whole IBAN');

	const bad = { ask: async () => '12', print: () => {} };
	assert.equal(await runEnableBankingAccounts({ io: bad, keychain, configPath }), false);
	const none = { ask: async () => '-', print: () => {} };
	assert.equal(await runEnableBankingAccounts({ io: none, keychain, configPath }), true);
	assert.deepEqual((await loadConfig(configPath)).enablebanking.ibanSuffixes, []);
});
