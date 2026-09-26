// Own wallets: from the bridge's entries to bookings, the accounts per
// asset, the euro values, the explorer links, and which bookings need no
// receipt. The bridge side runs for real against its fake chain nodes
// (@belege/bridge/testing/chains); every address, hash and amount is made up.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CHAINS, createWalletService } from '@belege/bridge/chains';
import {
	EVM,
	fakeHash,
	NYX,
	startFakeBlockscout,
	startFakeCosmos
} from '@belege/bridge/testing/chains';
import { memoryCollection } from '../bank/test-support.js';
import { buildMatchingContext } from '../matching/context.js';
import { classifyTransaction } from '../matching/classify.js';
import { classificationLine } from '../matching/explain.js';
import { describeEvent } from '../activity/view.js';
import {
	WALLET_CHAINS,
	isWalletSource,
	looksLikeAddress,
	normalizeAddress,
	safeExplorerUrl,
	walletAccountName
} from './chains.js';
import {
	addWallet,
	loadWallets,
	removeWallet,
	syncWallet,
	walletTransactions
} from './wallet-sync.js';

/** EUR per unit, made up. */
const RATES = /** @type {Record<string, string>} */ ({
	NYM: '0.05',
	NYX: '0.02',
	AKT: '1.5',
	ETH: '2000',
	USDC: '0.9'
});
/** @param {string} asset @param {string} date */
const rate = async (asset, date) => {
	if (!RATES[asset]) throw new Error(`no rate source for ${asset}`);
	return {
		asset,
		date,
		currency: /** @type {const} */ ('EUR'),
		rate: RATES[asset],
		usdRate: null,
		source: /** @type {const} */ ('coingecko'),
		at: `${date}T00:00:00Z`
	};
};

function store() {
	return {
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection,
		settings: memoryCollection('settings').collection,
		events: memoryCollection('events').collection
	};
}

/** A bridge client that is the bridge's own wallet service, pointed at fakes. */
function clientFor(/** @type {Record<string, Record<string, string>>} */ endpoints) {
	const service = createWalletService({ allowLoopback: true, sleep: async () => {} });
	/** @type {string[]} */ const rateCalls = [];
	const client = /** @type {any} */ ({
		walletHistory: (/** @type {string} */ chain, /** @type {any} */ body) =>
			service.sync({ chain, address: body.address, endpoints: endpoints[chain] }),
		rate: async (/** @type {string} */ asset, /** @type {string} */ date, /** @type {any} */ o) => {
			rateCalls.push(`${asset} ${date} ${o?.prefer ?? '-'}`);
			return rate(asset, date);
		}
	});
	return { client, rateCalls };
}

describe('the chain table', () => {
	it('agrees with the bridge’s', () => {
		expect(Object.keys(WALLET_CHAINS).sort()).toEqual(Object.keys(CHAINS).sort());
		for (const [id, c] of Object.entries(WALLET_CHAINS)) {
			const b = /** @type {any} */ (CHAINS)[id];
			expect([c.kind, c.name, c.shortName]).toEqual([b.kind, b.name, b.shortName]);
			const native = b.kind === 'cosmos' ? b.denoms[b.nativeDenom].symbol : b.native.symbol;
			expect(c.nativeSymbol).toBe(native);
			if (b.kind === 'cosmos') expect(c.bech32Prefix).toBe(b.bech32Prefix);
		}
	});

	it('names accounts, checks addresses roughly, keeps only https links', () => {
		expect(walletAccountName(WALLET_CHAINS.nyx, 'NYM', NYX.wallet)).toBe(
			`Wallet NYM ···${NYX.wallet.slice(-6)}`
		);
		expect(walletAccountName(WALLET_CHAINS.base, 'USDC', EVM.wallet)).toBe(
			`Wallet USDC (Base) ···${EVM.wallet.slice(-6)}`
		);
		expect(looksLikeAddress(WALLET_CHAINS.nyx, NYX.wallet)).toBe(true);
		expect(looksLikeAddress(WALLET_CHAINS.akash, NYX.wallet)).toBe(false);
		expect(looksLikeAddress(WALLET_CHAINS.ethereum, EVM.wallet)).toBe(true);
		expect(
			normalizeAddress(WALLET_CHAINS.ethereum, EVM.wallet.toUpperCase().replace('0X', '0x'))
		).toBe(EVM.wallet);
		expect(isWalletSource('nyx')).toBe(true);
		expect(isWalletSource('kraken')).toBe(false);
		expect(safeExplorerUrl('https://example.org/tx/1')).toBe('https://example.org/tx/1');
		expect(safeExplorerUrl('javascript:alert(1)')).toBe(null);
		expect(safeExplorerUrl('http://example.org/tx/1')).toBe(null);
	});
});

describe('walletTransactions', () => {
	/** @param {Partial<import('../bridge/client.js').WalletEntry>} e @returns {import('../bridge/client.js').WalletEntry} */
	const entry = (e) => ({
		id: 'H:0',
		hash: 'H',
		height: 1,
		time: '2026-09-02T10:00:00.000Z',
		date: '2026-09-02',
		type: 'sent',
		kind: 'transfer',
		asset: 'NYM',
		amount: '-12.5',
		decimals: 6,
		counterparty: NYX.friend,
		counterpartyLabel: '',
		memo: '',
		success: true,
		explorerUrl: 'https://explorer.example/tx/H',
		...e
	});

	it('values each entry at the day’s rate, the fee apart, with hash, address and link', async () => {
		const hash = fakeHash('spec-send');
		const { byAsset, unpriced } = await walletTransactions(
			[
				entry({
					id: `${hash}:fee`,
					hash,
					type: 'fee',
					kind: 'fee',
					amount: '-0.005',
					counterparty: ''
				}),
				entry({ id: `${hash}:0`, hash, memo: 'Rechnung Test 1' })
			],
			rate
		);
		expect(unpriced).toEqual([]);
		const [fee, sent] = /** @type {any[]} */ (byAsset.get('NYM'));
		expect(fee).toMatchObject({
			sourceId: `${hash}:fee`,
			movement: 'fee',
			amountCents: 0, // 0.005 NYM × 0.05 EUR rounds to 0 cents
			txRef: hash,
			counterpartyName: 'Netzwerkgebühr',
			crypto: { asset: 'NYM', quantity: '-5000', decimals: 6 }
		});
		expect(fee.counterpartyAddress).toBe('');
		expect(sent).toMatchObject({
			sourceId: `${hash}:0`,
			movement: 'transfer',
			amountCents: -63, // 12.5 × 0.05 = 0.625 → half away from zero
			currency: 'EUR',
			counterpartyName: NYX.friend,
			counterpartyAddress: NYX.friend,
			txRef: hash,
			explorerUrl: 'https://explorer.example/tx/H',
			bookingType: 'Gesendet',
			crypto: {
				asset: 'NYM',
				quantity: '-12500000',
				decimals: 6,
				valuation: { rate: '0.05', currency: 'EUR', source: 'coingecko' }
			}
		});
		expect(sent.purpose).toBe(
			`Gesendet · Memo: Rechnung Test 1 · Tx ${hash.slice(0, 8)}…${hash.slice(-4)}`
		);
	});

	it('rewards, staking and a failed transaction’s fee are told apart; no rate: left out and named', async () => {
		const { byAsset, unpriced } = await walletTransactions(
			[
				entry({
					id: 'A:0',
					type: 'received',
					kind: 'reward',
					amount: '1',
					counterpartyLabel: 'Staking-Belohnungen (distribution)'
				}),
				entry({ id: 'A:1', kind: 'stake', amount: '-100' }),
				entry({
					id: 'B:fee',
					type: 'fee',
					kind: 'fee',
					amount: '-0.003',
					success: false,
					counterparty: ''
				}),
				entry({ id: 'C:0', type: 'received', asset: 'ATOM', amount: '1' }),
				entry({ id: 'D:0', explorerUrl: 'javascript:alert(1)' })
			],
			rate
		);
		const list = /** @type {any[]} */ (byAsset.get('NYM'));
		expect(list.map((t) => [t.movement, t.bookingType])).toEqual([
			['reward', 'Staking-Ertrag'],
			['stake', 'Delegation (Staking)'],
			['fee', 'Netzwerkgebühr (fehlgeschlagene Transaktion)'],
			['transfer', 'Gesendet']
		]);
		expect(list[0].counterpartyName).toBe('Staking-Belohnungen (distribution)');
		expect(list[3].explorerUrl).toBe('');
		expect(unpriced).toEqual([
			{ id: 'C:0', date: '2026-09-02', asset: 'ATOM', reason: 'no rate source for ATOM' }
		]);
	});
});

describe('wallets in the settings', () => {
	it('adds once per chain and address, keeps own endpoints, removes', async () => {
		const s = store();
		const upper = EVM.wallet.toUpperCase().replace('0X', '0x');
		const a = await addWallet(s.settings, {
			chain: 'ethereum',
			address: upper,
			endpoints: { api: ' ' }
		});
		const b = await addWallet(s.settings, { chain: 'ethereum', address: EVM.wallet });
		expect(b.id).toBe(a.id);
		expect(a).toMatchObject({ chain: 'ethereum', address: EVM.wallet, endpoints: {} });
		await addWallet(s.settings, {
			chain: 'nyx',
			address: NYX.wallet,
			endpoints: { rpc: 'https://rpc.example.org' }
		});
		expect((await loadWallets(s.settings)).map((w) => [w.chain, w.endpoints])).toEqual([
			['ethereum', {}],
			['nyx', { rpc: 'https://rpc.example.org' }]
		]);
		await removeWallet(s.settings, a.id);
		expect((await loadWallets(s.settings)).map((w) => w.chain)).toEqual(['nyx']);
		await expect(addWallet(s.settings, { chain: 'dogecoin', address: 'x' })).rejects.toThrow();
	});
});

describe('syncWallet against the fake chains', () => {
	/** @type {Awaited<ReturnType<typeof startFakeCosmos>>} */ let nyxNode;
	/** @type {Awaited<ReturnType<typeof startFakeBlockscout>>} */ let scout;
	beforeAll(async () => {
		nyxNode = await startFakeCosmos();
		scout = await startFakeBlockscout();
	});
	afterAll(async () => {
		await nyxNode?.close();
		await scout?.close();
	});

	it('a Nyx wallet: an account per asset, balances, bookings with links; a second sync adds nothing', async () => {
		const s = store();
		const { client, rateCalls } = clientFor({ nyx: nyxNode.endpoints });
		const wallet = await addWallet(s.settings, { chain: 'nyx', address: NYX.wallet });
		const now = new Date('2026-09-26T08:00:00Z');
		const first = await syncWallet({ client, store: s, wallet, now });

		const accounts = (await s.accounts.list()).sort((a, b) => (a.name < b.name ? -1 : 1));
		expect(
			accounts.map((a) => [a.name, a.source, a.kind, a.asset, a.balance, a.balanceOn])
		).toEqual([
			[`Wallet NYM ···${NYX.wallet.slice(-6)}`, 'nyx', 'wallet', 'NYM', '137', '2026-09-26'],
			[`Wallet NYX ···${NYX.wallet.slice(-6)}`, 'nyx', 'wallet', 'NYX', '2', '2026-09-26']
		]);
		expect(accounts.every((a) => a.walletAddress === NYX.wallet && a.ibanLast4 === '')).toBe(true);
		expect(accounts[0].addressUrl).toBe(`https://nym.explorers.guru/account/${NYX.wallet}`);
		expect(first.totals).toEqual({ new: 125, updated: 0, skipped: 0 });
		expect(first.unpriced).toEqual([]);
		expect(first.unknownAssets).toBe(1);
		// No `prefer`: a wallet is no exchange booking.
		expect(rateCalls.every((c) => c.endsWith(' -'))).toBe(true);

		const txs = await s.transactions.list();
		const withdrawal = txs.find((t) => t.sourceId === `${fakeHash('withdrawal')}:m0:e3.0:NYM`);
		expect(withdrawal).toMatchObject({
			source: 'nyx',
			bookedOn: '2026-09-01',
			amountCents: 1250, // 250 NYM × 0.05
			quantity: '250000000',
			asset: 'NYM',
			txRef: fakeHash('withdrawal'),
			counterpartyAddress: NYX.exchange,
			explorerUrl: `https://nym.explorers.guru/transaction/${fakeHash('withdrawal')}`
		});
		expect(withdrawal?.purpose).toContain('Memo: Test-Memo Auszahlung');
		const failedFee = txs.find((t) => t.sourceId === `${fakeHash('failed')}:fee`);
		expect(failedFee).toMatchObject({ movement: 'fee', quantity: '-3000' });
		expect(txs.some((t) => t.sourceId.startsWith(`${fakeHash('failed')}:m`))).toBe(false);

		const again = await syncWallet({ client, store: s, wallet, now });
		expect(again.totals).toEqual({ new: 0, updated: 0, skipped: 125 });
		const [saved] = await loadWallets(s.settings);
		expect(saved.lastSyncedAt).toBe(now.toISOString());

		const event = (await s.events.list()).find((e) => e.new === 125);
		expect(event).toMatchObject({ kind: 'bank-sync', source: 'nyx', accounts: 2 });
		expect(describeEvent(/** @type {any} */ (event)).text).toContain('Wallet (Nym/Nyx)');
	});

	it('an Ethereum wallet: ETH and listed USDC, gas as fees, no account for tokens never touched', async () => {
		const s = store();
		const { client } = clientFor({ ethereum: scout.endpoints });
		const wallet = await addWallet(s.settings, { chain: 'ethereum', address: EVM.wallet });
		const result = await syncWallet({ client, store: s, wallet });
		const accounts = (await s.accounts.list()).sort((a, b) => (a.name < b.name ? -1 : 1));
		expect(accounts.map((a) => [a.name, a.balance])).toEqual([
			[`Wallet ETH (Ethereum) ···${EVM.wallet.slice(-6)}`, '0.31'],
			[`Wallet USDC (Ethereum) ···${EVM.wallet.slice(-6)}`, '450']
		]);
		expect(result.totals.new).toBe(8);
		const txs = await s.transactions.list();
		const usdcOut = txs.find((t) => t.asset === 'USDC' && t.amountCents < 0);
		expect(usdcOut).toMatchObject({
			amountCents: -27000, // 300 USDC × 0.90
			txRef: fakeHash('usdc-out', true),
			counterpartyAddress: EVM.exchange,
			explorerUrl: `https://etherscan.io/tx/${fakeHash('usdc-out', true)}`
		});
		expect(txs.filter((t) => t.movement === 'fee').map((t) => t.sourceId)).toContain(
			`${fakeHash('usdc-out', true)}:fee`
		);
	});
});

describe('which wallet bookings need no receipt', () => {
	const A = NYX.wallet;
	const B = NYX.friend;
	const hash = fakeHash('between own wallets');
	/** @param {Record<string, any>} t */
	const booking = (t) => ({
		id: t.id,
		accountId: t.accountId,
		source: 'nyx',
		bookedOn: '2026-09-05',
		currency: 'EUR',
		movement: 'transfer',
		asset: 'NYM',
		decimals: 6,
		purpose: 'Gesendet · Tx …',
		...t
	});
	const accounts = [
		{
			id: 'acc-a',
			source: 'nyx',
			name: `Wallet NYM ···${A.slice(-6)}`,
			walletAddress: A,
			asset: 'NYM'
		},
		{
			id: 'acc-b',
			source: 'nyx',
			name: `Wallet NYM ···${B.slice(-6)}`,
			walletAddress: B,
			asset: 'NYM'
		},
		{ id: 'acc-k', source: 'kraken', name: 'Kraken NYM', asset: 'NYM' }
	];
	const out = booking({
		id: 't-out',
		accountId: 'acc-a',
		amountCents: -500,
		quantity: '-100000000',
		counterparty: B,
		counterpartyAddress: B,
		txRef: hash
	});
	const into = booking({
		id: 't-in',
		accountId: 'acc-b',
		amountCents: 500,
		quantity: '100000000',
		counterparty: A,
		counterpartyAddress: A,
		txRef: hash
	});

	/** @param {Record<string, any>[]} transactions @param {Record<string, any>[]} [accs] */
	const context = (transactions, accs = accounts) =>
		buildMatchingContext({ accounts: accs, transactions, settings: null });

	it('between two own wallets: both legs, by the shared hash', async () => {
		const ctx = await context([out, into]);
		expect(classifyTransaction(out, ctx)).toMatchObject({
			kind: 'own-transfer',
			account: '1360',
			via: 'reference',
			counterBookingId: 't-in'
		});
		expect(classifyTransaction(into, ctx)).toMatchObject({
			via: 'reference',
			counterBookingId: 't-out'
		});
	});

	it('to an own wallet whose side is not synced yet: by the address', async () => {
		const ctx = await context([out]);
		const c = classifyTransaction(out, ctx);
		expect(c).toMatchObject({
			kind: 'own-transfer',
			via: 'own-address',
			address: B,
			counterAccountId: 'acc-b'
		});
		expect(classificationLine(c, { accounts })).toBe(
			`Eigene Übertragung: Die Gegenadresse ${B.slice(0, 8)}…${B.slice(-6)} ist deine Wallet Wallet NYM ···${B.slice(-6)}. Kein Beleg nötig (Konto 1360).`
		);
	});

	it('to a foreign address, or to an exchange: a receipt is needed (the exchange pairs by hash later)', async () => {
		const foreign = booking({
			id: 't-f',
			accountId: 'acc-a',
			amountCents: -500,
			quantity: '-100000000',
			counterpartyAddress: NYX.exchange,
			txRef: fakeHash('x')
		});
		// A Kraken withdrawal of the same quantity on the same day is not paired here.
		const kraken = {
			id: 'k1',
			accountId: 'acc-k',
			source: 'kraken',
			bookedOn: '2026-09-05',
			amountCents: 510,
			currency: 'EUR',
			movement: 'transfer',
			asset: 'NYM',
			quantity: '10000000000',
			txRef: 'R-WD'
		};
		const ctx = await context([foreign, kraken]);
		expect(classifyTransaction(foreign, ctx)).toBe(null);
		// Another chain's address that looks like ours does not count: only our own list.
		const ctxOther = await context([out], [accounts[0]]);
		expect(classifyTransaction(out, ctxOther)).toBe(null);
	});

	it('a Kraken withdrawal naming the hash pairs with the wallet that received it (#56)', async () => {
		const received = booking({
			id: 't-rx',
			accountId: 'acc-a',
			amountCents: 510,
			quantity: '100000000',
			counterpartyAddress: NYX.exchange,
			txRef: hash
		});
		const withdrawal = {
			id: 'k-wd',
			accountId: 'acc-k',
			source: 'kraken',
			bookedOn: '2026-09-04',
			amountCents: -495,
			currency: 'EUR',
			movement: 'transfer',
			asset: 'NYM',
			quantity: '-1000000000000',
			txRef: 'R-WD',
			chainTxRef: hash.toLowerCase()
		};
		const ctx = await context([received, withdrawal]);
		expect(classifyTransaction(received, ctx)).toMatchObject({
			via: 'reference',
			counterBookingId: 'k-wd'
		});
		expect(classifyTransaction(withdrawal, ctx)).toMatchObject({
			via: 'reference',
			counterBookingId: 't-rx'
		});
	});

	it('an address that is ours on one EVM chain is not ours on another', async () => {
		const addr = '0x' + 'ab'.repeat(20);
		const evmAccounts = [
			{
				id: 'acc-base',
				source: 'base',
				name: 'Wallet USDC (Base)',
				walletAddress: addr,
				asset: 'USDC'
			},
			{
				id: 'acc-eth',
				source: 'ethereum',
				name: 'Wallet USDC (Ethereum)',
				walletAddress: '0x' + 'cd'.repeat(20),
				asset: 'USDC'
			}
		];
		const onEthereum = {
			id: 'e1',
			accountId: 'acc-eth',
			source: 'ethereum',
			bookedOn: '2026-09-05',
			currency: 'EUR',
			movement: 'transfer',
			asset: 'USDC',
			amountCents: -900,
			counterpartyAddress: addr.toUpperCase().replace('0X', '0x'),
			txRef: fakeHash('evm send', true)
		};
		const ctx = await context([onEthereum], evmAccounts);
		expect(classifyTransaction(onEthereum, ctx)).toBe(null);
		const onBase = { ...onEthereum, id: 'b1', source: 'base', accountId: 'acc-other' };
		expect(classifyTransaction(onBase, ctx)).toMatchObject({
			via: 'own-address',
			counterAccountId: 'acc-base'
		});
	});

	it('to an own wallet: the counter account is the one of the same asset', async () => {
		const addr = '0x' + 'ef'.repeat(20);
		const evmAccounts = [
			{
				id: 'acc-own-eth',
				source: 'ethereum',
				name: 'Wallet ETH',
				walletAddress: addr,
				asset: 'ETH'
			},
			{
				id: 'acc-own-usdc',
				source: 'ethereum',
				name: 'Wallet USDC',
				walletAddress: addr,
				asset: 'USDC'
			},
			{
				id: 'acc-mine',
				source: 'ethereum',
				name: 'Wallet USDC (other)',
				walletAddress: '0x' + '12'.repeat(20),
				asset: 'USDC'
			}
		];
		const send = {
			id: 'u1',
			accountId: 'acc-mine',
			source: 'ethereum',
			bookedOn: '2026-09-05',
			currency: 'EUR',
			movement: 'transfer',
			asset: 'USDC',
			amountCents: -900,
			counterpartyAddress: addr,
			txRef: fakeHash('usdc to own', true)
		};
		const ctx = await context([send], evmAccounts);
		expect(classifyTransaction(send, ctx)).toMatchObject({
			via: 'own-address',
			counterAccountId: 'acc-own-usdc'
		});
		// An asset the other wallet has no account of yet: its first account.
		const dai = { ...send, id: 'd1', asset: 'DAI' };
		expect(classifyTransaction(dai, ctx)).toMatchObject({ counterAccountId: 'acc-own-eth' });
	});

	it('network fees, staking rewards and delegations', async () => {
		const ctx = await context([]);
		const fee = booking({ id: 'f', accountId: 'acc-a', movement: 'fee', amountCents: -1 });
		expect(classifyTransaction(fee, ctx)).toEqual({ kind: 'bank-fee', via: 'network-fee' });
		expect(classificationLine({ kind: 'bank-fee', via: 'network-fee' })).toContain(
			'Block-Explorer'
		);
		expect(
			classifyTransaction(
				booking({ id: 'r', accountId: 'acc-a', movement: 'reward', amountCents: 5 }),
				ctx
			)
		).toEqual({ kind: 'crypto-reward' });
		const stake = classifyTransaction(
			booking({ id: 's', accountId: 'acc-a', movement: 'stake', amountCents: -500 }),
			ctx
		);
		// Not on 1360: the tokens come back without a transaction, a transit account never balances.
		expect(stake).toEqual({ kind: 'crypto-stake' });
		expect(classificationLine(stake)).toContain('Nicht auf 1360');
		// A Kraken fee stays an exchange fee.
		expect(classifyTransaction({ ...fee, source: 'kraken' }, ctx)).toEqual({
			kind: 'bank-fee',
			via: 'exchange-fee'
		});
	});
});
