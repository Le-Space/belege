import { describe, expect, it } from 'vitest';

import { asksForStart, cleanSetup, setupSteps, withStart } from './steps.js';
import { diagnoseBridge } from './diagnose.js';

/** @param {Partial<import('./steps.js').SetupFacts>} over @returns {import('./steps.js').SetupFacts} */
const facts = (over = {}) => ({
	bridge: { paired: false, online: false, viaDevice: false, llm: false },
	devices: 0,
	deviceSync: false,
	invoiceApp: false,
	accounts: [],
	transactions: [],
	receipts: [],
	events: [],
	datev: null,
	later: [],
	...over
});

/** @param {ReturnType<typeof setupSteps>} r */
const states = (r) => Object.fromEntries(r.steps.map((s) => [s.id, s.state]));

describe('the setup checklist (#200)', () => {
	it('starts with everything open, the bridge first after the passkey', () => {
		const r = setupSteps(facts());
		expect(r.steps.map((s) => s.id)).toEqual([
			'passkey',
			'bridge',
			'payments',
			'receipts',
			'ai',
			'books',
			'export',
			'more'
		]);
		expect(r.steps.every((s) => s.state === 'open')).toBe(true);
		expect(r.next?.id).toBe('passkey');
		expect([r.done, r.total, r.finished]).toEqual([0, 5, false]);
	});

	it('knows what is done from the books and the bridge, never from a tick', () => {
		const r = setupSteps(
			facts({
				bridge: { paired: true, online: true, viaDevice: false, llm: true },
				devices: 1,
				accounts: [{ id: 'a1', ledgerAccount: '1200' }],
				transactions: [{ id: 't1', accountId: 'a1' }],
				receipts: [{ id: 'r1' }],
				datev: { legalForm: 'sole' },
				events: [{ kind: 'export' }]
			})
		);
		expect(states(r)).toMatchObject({
			passkey: 'done',
			bridge: 'done',
			payments: 'done',
			receipts: 'done',
			ai: 'done',
			books: 'done',
			export: 'done',
			more: 'open'
		});
		expect([r.done, r.total]).toEqual([5, 5]);
	});

	it('a paired bridge that does not answer is not done; a phone on the Mac’s bridge is', () => {
		const off = { paired: true, online: false, viaDevice: false, llm: false };
		expect(states(setupSteps(facts({ bridge: off }))).bridge).toBe('open');
		const phone = { paired: false, online: true, viaDevice: true, llm: false };
		expect(states(setupSteps(facts({ bridge: phone }))).bridge).toBe('done');
	});

	it('the books need the legal form and a ledger account for every account with bookings', () => {
		const base = {
			accounts: [{ id: 'a1', ledgerAccount: '1200' }, { id: 'a2' }, { id: 'a3', deleted: true }],
			transactions: [{ id: 't1', accountId: 'a1' }],
			datev: { legalForm: 'corporation' }
		};
		expect(states(setupSteps(facts(base))).books).toBe('done');
		const used = { ...base, transactions: [...base.transactions, { id: 't2', accountId: 'a2' }] };
		expect(states(setupSteps(facts(used))).books).toBe('open');
		expect(states(setupSteps(facts({ ...base, datev: { legalForm: '' } }))).books).toBe('open');
		expect(states(setupSteps(facts({ ...base, datev: null }))).books).toBe('open');
	});

	it('"later" puts a step off; the list is finished when nothing is open', () => {
		const r = setupSteps(facts({ later: ['passkey', 'bridge'] }));
		expect(states(r)).toMatchObject({ passkey: 'later', bridge: 'later', payments: 'open' });
		expect(r.next?.id).toBe('payments');
		const all = setupSteps(
			facts({
				later: ['passkey', 'bridge', 'payments', 'receipts', 'ai', 'books', 'export', 'more']
			})
		);
		expect(all.finished).toBe(true);
		expect(all.next).toBeNull();
	});

	it('a stored setup keeps only known steps and ways in', () => {
		expect(cleanSetup({ later: ['bridge', 'nope', 'ai'], start: 'file' })).toEqual({
			later: ['bridge', 'ai'],
			start: 'file'
		});
		expect(cleanSetup({ start: 'nope' })).toEqual({ later: [], start: null });
		expect(cleanSetup(null)).toEqual({ later: [], start: null });
	});
});

describe('how to start (#200, step 2)', () => {
	it('asks only while the books are new: no booking, no receipt, no paired bridge, nothing chosen', () => {
		expect(asksForStart(facts())).toBe(true);
		expect(asksForStart(facts({ start: 'look' }))).toBe(false);
		expect(asksForStart(facts({ transactions: [{ id: 't' }] }))).toBe(false);
		expect(asksForStart(facts({ receipts: [{ id: 'r' }] }))).toBe(false);
		expect(asksForStart(facts({ transactions: [{ id: 't', deleted: true }] }))).toBe(true);
		const paired = { paired: true, online: false, viaDevice: false, llm: false };
		expect(asksForStart(facts({ bridge: paired }))).toBe(false);
	});

	it('the way in decides which step comes first', () => {
		expect(setupSteps(facts({ start: 'look' })).next?.id).toBe('passkey');
		expect(setupSteps(facts({ start: 'bridge' })).next?.id).toBe('bridge');
		const file = setupSteps(facts(withStart({ later: [] }, 'file')));
		expect(file.next?.id).toBe('payments');
		expect(states(file).bridge).toBe('later');
		// Payments in: receipts next, before the optional steps.
		const further = setupSteps(
			facts({ ...withStart({ later: [] }, 'file'), transactions: [{ id: 't', accountId: 'a' }] })
		);
		expect(further.next?.id).toBe('receipts');
	});

	it('choosing the bridge after all takes it up again; asking again keeps what was put off', () => {
		const file = withStart({ later: ['ai'] }, 'file');
		expect(file).toEqual({ later: ['bridge', 'ai'], start: 'file' });
		expect(withStart(file, null)).toEqual({ later: ['bridge', 'ai'], start: null });
		expect(withStart(file, 'bridge')).toEqual({ later: ['ai'], start: 'bridge' });
	});
});

describe('why the bridge does not answer (#200)', () => {
	/** @param {(init: RequestInit) => 'ok' | 'throw'} how @returns {typeof fetch} */
	const net = (how) =>
		/** @type {any} */ (
			async (/** @type {string} */ _url, /** @type {RequestInit} */ init) => {
				if (how(init) === 'throw') throw new TypeError('Failed to fetch');
				return new Response('{}', { status: 200 });
			}
		);
	const env = { pageOrigin: 'https://belege.le-space.de' };

	it('online when it answers this page', async () => {
		expect(await diagnoseBridge('http://127.0.0.1:8765', { ...env, fetch: net(() => 'ok') })).toBe(
			'online'
		);
	});

	it('runs but refuses this page: only a request without CORS gets through', async () => {
		const fetch = net((init) => (init.mode === 'cors' ? 'throw' : 'ok'));
		expect(await diagnoseBridge('http://127.0.0.1:8765', { ...env, fetch })).toBe('origin');
	});

	it('nothing answers', async () => {
		const fetch = net(() => 'throw');
		expect(await diagnoseBridge('http://127.0.0.1:8765', { ...env, fetch })).toBe('unreachable');
	});

	it('an https page and a plain-http address other than this computer; a bad address', async () => {
		const fetch = net(() => 'ok');
		expect(await diagnoseBridge('http://192.168.1.20:8765', { ...env, fetch })).toBe('mixed');
		expect(
			await diagnoseBridge('http://192.168.1.20:8765', {
				pageOrigin: 'http://localhost:5173',
				fetch
			})
		).toBe('online');
		expect(await diagnoseBridge('127.0.0.1:8765', { ...env, fetch })).toBe('bad-url');
	});
});
