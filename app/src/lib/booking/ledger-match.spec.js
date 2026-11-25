// Ledger accounts read off the person's chart by name, and the number a new
// wallet is offered. Made-up charts and accounts.
import { describe, expect, it } from 'vitest';

import {
	bankWord,
	chartCandidates,
	ledgerConflicts,
	ledgersFromChart,
	nameWords,
	suggestAssetLedger,
	suggestWalletLedger,
	walletLedgerCandidates
} from './ledger-match.js';

const chart = {
	accounts: [
		{ number: '1200', name: 'Bank A Kontokorrent 4321' },
		{ number: '1210', name: 'Bank B Tagesgeld' },
		{ number: '1310', name: 'Kraken BTC' },
		{ number: '1311', name: 'Kraken ETH' },
		{ number: '1312', name: 'Kraken EUR Guthaben' },
		{ number: '1320', name: 'Wallet Projekt Nord' },
		{ number: '1321', name: 'Wallet NEAR' },
		{ number: '4930', name: 'Bürobedarf' },
		// A personal account, one digit longer: never a bank's ledger account.
		{ number: '70001', name: 'Kraken Payward Ltd' }
	]
};

describe('ledger accounts from the chart', () => {
	it('compares names by their words', () => {
		expect(nameWords('Kraken · BTC (Börse)')).toEqual(['kraken', 'btc', 'boerse']);
	});

	it('takes the chart account that names an account, by its words or the IBAN’s last digits', () => {
		const found = ledgersFromChart(
			[
				{ id: 'a', name: 'Kraken BTC' },
				{ id: 'b', name: 'Kraken EUR' },
				{ id: 'c', name: 'Kontokorrent', ibanLast4: '4321' },
				{ id: 'd', name: 'Sparkonto', ibanLast4: '9999' }
			],
			chart
		);
		expect(Object.fromEntries([...found].map(([id, c]) => [id, c.number]))).toEqual({
			a: '1310',
			b: '1312',
			c: '1200'
		});
	});

	it('reads an asset’s ticker and its name as one word', () => {
		const named = {
			accounts: [
				{ number: '1110', name: 'Kraken EURO' },
				{ number: '1120', name: 'Kraken Bitcoin' },
				{ number: '1130', name: 'Kraken Filecoin' },
				{ number: '1185', name: 'Hardware-Wallet Bitcoin - BTC' }
			]
		};
		const found = ledgersFromChart(
			[
				{ id: 'a', name: 'Kraken BTC' },
				{ id: 'b', name: 'Kraken EUR' },
				{ id: 'c', name: 'Kraken FIL' }
			],
			named
		);
		expect(Object.fromEntries([...found].map(([id, c]) => [id, c.number]))).toEqual({
			a: '1120',
			b: '1110',
			c: '1130'
		});
		expect(nameWords('Kraken XBT')).toEqual(['kraken', 'btc']);
	});

	it('takes nothing that is ambiguous, in use or already set', () => {
		// "Kraken" alone fits three chart accounts.
		expect(ledgersFromChart([{ id: 'a', name: 'Kraken' }], chart).size).toBe(0);
		// Two accounts of the same name fit the same chart account: neither gets it.
		expect(
			ledgersFromChart(
				[
					{ id: 'a', name: 'Kraken ETH' },
					{ id: 'b', name: 'Kraken ETH' }
				],
				chart
			).size
		).toBe(0);
		// The chart account is another account's already.
		expect(
			ledgersFromChart(
				[
					{ id: 'a', name: 'Kraken BTC' },
					{ id: 'b', name: 'Altes Konto', ledgerAccount: '1310' }
				],
				chart
			).size
		).toBe(0);
		// An account that has a number keeps it; a deleted one is not looked at.
		expect(
			ledgersFromChart(
				[
					{ id: 'a', name: 'Kraken BTC', ledgerAccount: '1399' },
					{ id: 'b', name: 'Kraken ETH', deleted: true }
				],
				chart
			).size
		).toBe(0);
		expect(ledgersFromChart([{ id: 'a', name: 'Kraken BTC' }], null).size).toBe(0);
	});
});

describe('an account whose name says nothing of its bank', () => {
	const banks = {
		accounts: [
			{ number: '1100', name: 'Beispielbank Nord' },
			{ number: '1140', name: 'Zahlfix Business' },
			{ number: '1220', name: 'Kartenguthaben Geldweg Europa' },
			{ number: '1730', name: 'Geldweg Kartenabrechnung' },
			{ number: '1186', name: 'Tresor - ETH (Ethereum)' },
			{ number: '1192', name: 'relay-test - ETH (Ethereum)' },
			{ number: '1197', name: 'Tresor - ALEPH (Ethereum)' }
		]
	};

	it('is named by its bank, where the source says which', () => {
		expect(bankWord('Zahlfix Bank UAB')).toBe('zahlfix');
		expect(bankWord('')).toBe('');
		const found = ledgersFromChart(
			[
				{ id: 'a', name: 'Main', ibanLast4: '5281', bank: 'Zahlfix Bank UAB' },
				// Two chart accounts name this bank: not taken.
				{ id: 'b', name: 'Main', ibanLast4: '7777', bank: 'Geldweg Europe SA' },
				// No bank known: nothing to go by.
				{ id: 'c', name: 'Kontokorrent', ibanLast4: '1400' }
			],
			banks
		);
		expect(Object.fromEntries([...found].map(([id, c]) => [id, c.number]))).toEqual({ a: '1140' });
	});

	it('is offered the free chart accounts that share most with it', () => {
		const accounts = [
			{ id: 'w', name: 'Firma Ethereum · ETH (Ethereum)' },
			{ id: 'x', name: 'Anderes', ledgerAccount: '1192' },
			{ id: 'b', name: 'Main', bank: 'Geldweg Europe SA' },
			{ id: 'c', name: 'Kontokorrent' }
		];
		// ETH and Ethereum are one word; 1192 is another account's already.
		expect(chartCandidates(accounts[0], accounts, banks).map((c) => c.number)).toEqual([
			'1186',
			'1197'
		]);
		expect(chartCandidates(accounts[2], accounts, banks).map((c) => c.number)).toEqual([
			'1220',
			'1730'
		]);
		expect(chartCandidates(accounts[3], accounts, banks)).toEqual([]);
		expect(chartCandidates(accounts[0], accounts, null)).toEqual([]);
	});
});

describe('a wallet the chart calls by another name', () => {
	// The books call the wallet "Firma Ethereum", the chart "Tresor".
	const plan = {
		accounts: [
			{ number: '1110', name: 'Kraken EURO' },
			{ number: '1186', name: 'Tresor - ETH (Ethereum)' },
			{ number: '1187', name: 'Tresor - USDC (Ethereum)' },
			{ number: '1191', name: 'Testknoten - USDC (Ethereum)' },
			{ number: '1193', name: 'Testknoten - ETH (Ethereum)' },
			{ number: '1196', name: 'Akash - AKT' },
			{ number: '1197', name: 'Tresor - ALEPH (Ethereum)' },
			{ number: '1198', name: 'Tresor - BSO (Ethereum)' },
			{ number: '1201', name: 'Base Firma - ETH (Base)' },
			{ number: '1410', name: 'Forderungen ohne Kontokorrent' },
			{ number: '1610', name: 'Verbindlichkeiten ohne Kontokorrent' }
		]
	};
	const wallet = (
		/** @type {string} */ id,
		/** @type {string} */ asset,
		chain = ' (Ethereum)'
	) => ({
		id,
		kind: 'wallet',
		asset,
		name: `Firma Ethereum · ${asset}${chain}`
	});

	it('is found by the assets only it holds, and then by the name the chart gives it', () => {
		const found = ledgersFromChart(
			[
				wallet('aleph', 'ALEPH'),
				wallet('bso', 'BSO'),
				wallet('eth', 'ETH'),
				wallet('usdc', 'USDC'),
				{ id: 'akt', kind: 'wallet', asset: 'AKT', name: 'Wallet AKT ···7zzsw8' },
				{ id: 'k', kind: 'exchange', asset: 'EUR', name: 'Kraken EUR' }
			],
			plan
		);
		expect(Object.fromEntries([...found].map(([id, c]) => [id, c.number]))).toEqual({
			// One chart account holds ALEPH, one BSO, one AKT …
			aleph: '1197',
			bso: '1198',
			akt: '1196',
			k: '1110',
			// … both are "Tresor": so ETH and USDC are Tresor's, not the test node's.
			eth: '1186',
			usdc: '1187'
		});
	});

	it('is not guessed while the chart has two accounts of that asset and nothing tells them apart', () => {
		const found = ledgersFromChart([wallet('eth', 'ETH'), wallet('usdc', 'USDC')], plan);
		expect(found.size).toBe(0);
		// An exchange's account is never looked up by its asset alone.
		expect(
			ledgersFromChart([{ id: 'k', kind: 'exchange', asset: 'AKT', name: 'Kraken AKT' }], plan).size
		).toBe(0);
	});

	it('is offered accounts of its asset only, that of its chain first, and none far from the others', () => {
		const accounts = [
			wallet('eth', 'ETH'),
			{ id: 'a', name: 'x', ledgerAccount: '1110' },
			{ id: 'b', name: 'y', ledgerAccount: '1197' },
			{ id: 'bank', name: 'Kontokorrent', ibanLast4: '1400' }
		];
		expect(chartCandidates(accounts[0], accounts, plan).map((c) => c.number)).toEqual([
			'1186',
			'1193',
			'1201'
		]);
		// "Kontokorrent" names a product, not a bank: no receivables are offered for it.
		expect(chartCandidates(accounts[3], accounts, plan)).toEqual([]);
		expect(ledgersFromChart([accounts[3]], plan).size).toBe(0);
	});
});

describe('a ledger account for a new wallet', () => {
	const near = { name: 'NEAR', shortName: 'NEAR', nativeSymbol: 'NEAR' };

	it('is the chart account that names the wallet or its chain', () => {
		expect(suggestWalletLedger({ chain: near, wallets: [], accounts: [], chart })).toEqual({
			number: '1321',
			name: 'Wallet NEAR',
			source: 'chart',
			inChart: true
		});
		expect(
			suggestWalletLedger({ name: 'Projekt Nord', chain: near, wallets: [], accounts: [], chart })
				?.number
		).toBe('1320');
	});

	it('is the next free number beside the other wallets when the chart names none', () => {
		const wallets = [{ ledgerAccount: '1320' }, { ledgerAccount: '1322' }, {}];
		// 1321 is the NEAR wallet's in the chart and in use: not offered to another chain.
		const s = suggestWalletLedger({
			chain: { name: 'Akash', nativeSymbol: 'AKT' },
			wallets,
			accounts: [{ ledgerAccount: '1321' }],
			chart
		});
		expect(s).toEqual({ number: '1323', name: '', source: 'next', inChart: false });
		// Numbers the chart gives to something else are skipped.
		expect(
			suggestWalletLedger({
				chain: { name: 'Akash' },
				wallets: [{ ledgerAccount: '1309' }],
				accounts: [],
				chart
			})?.number
		).toBe('1313');
	});

	it('finds the chart account that names the wallet by its address', () => {
		const named = {
			accounts: [
				{ number: '1330', name: 'NEAR Wallet beispiel.near' },
				{ number: '1331', name: 'NEAR Wallet tresor.near' }
			]
		};
		const near = { name: 'NEAR', nativeSymbol: 'NEAR' };
		const ask = { address: 'beispiel.near', chain: near, wallets: [], accounts: [], chart: named };
		expect(suggestWalletLedger(ask)?.number).toBe('1330');
		expect(walletLedgerCandidates(ask)).toEqual([]);
	});

	it('offers the free chart accounts when several fit, and picks none', () => {
		const several = {
			accounts: [
				{ number: '1330', name: 'NEAR Wallet A' },
				{ number: '1331', name: 'NEAR Wallet B' },
				{ number: '1332', name: 'NEAR Wallet C' },
				{ number: '1340', name: 'Akash Wallet' }
			]
		};
		const ask = {
			address: 'beispiel.near',
			chain: { name: 'NEAR', nativeSymbol: 'NEAR' },
			wallets: [],
			accounts: [{ ledgerAccount: '1331' }],
			chart: several
		};
		expect(suggestWalletLedger(ask)).toBeNull();
		expect(walletLedgerCandidates(ask).map((c) => c.number)).toEqual(['1330', '1332']);
	});

	it('follows the numbers the wallets’ accounts have, when the wallets carry none', () => {
		const s = suggestWalletLedger({
			chain: { name: 'Akash', nativeSymbol: 'AKT' },
			wallets: [{}],
			accounts: [
				{ kind: 'wallet', ledgerAccount: '1322' },
				{ kind: 'bank', ledgerAccount: '1800' }
			],
			chart
		});
		expect(s).toEqual({ number: '1323', name: '', source: 'next', inChart: false });
	});

	it('is nothing when there is nothing to go by', () => {
		expect(
			suggestWalletLedger({ chain: { name: 'Akash' }, wallets: [{}], accounts: [], chart: null })
		).toBeNull();
	});
});

describe('a ledger account per asset', () => {
	const near = { name: 'NEAR', shortName: 'NEAR', nativeSymbol: 'NEAR' };
	const perAsset = {
		accounts: [
			{ number: '1400', name: 'Wallet Projekt Ost NEAR' },
			{ number: '1401', name: 'Wallet Projekt Ost USDC' },
			{ number: '1410', name: 'Kraken Bitcoin' },
			{ number: '1411', name: 'Kraken Ether' }
		]
	};

	it('is the chart account that names the wallet with the asset', () => {
		const s = suggestAssetLedger({
			account: { kind: 'wallet', asset: 'USDC', source: 'near' },
			wallet: { name: 'Projekt Ost', address: 'ost.near' },
			chain: near,
			wallets: [{ ledgerAccounts: { NEAR: '1400' } }],
			accounts: [{ kind: 'wallet', asset: 'NEAR', ledgerAccount: '1400' }],
			chart: perAsset
		});
		expect(s).toEqual({
			number: '1401',
			name: 'Wallet Projekt Ost USDC',
			source: 'chart',
			inChart: true
		});
	});

	it('names an exchange’s asset by the exchange and the asset, a ticker as its name', () => {
		expect(
			suggestAssetLedger({
				account: { kind: 'exchange', asset: 'ETH', source: 'kraken' },
				wallets: [],
				accounts: [{ kind: 'exchange', asset: 'BTC', ledgerAccount: '1410' }],
				chart: perAsset
			})?.number
		).toBe('1411');
	});

	it('is else the next free number, never one another asset or another offer uses', () => {
		const ask = {
			account: { kind: 'wallet', asset: 'AURORA', source: 'near' },
			wallet: { name: 'Projekt West', address: 'west.near' },
			chain: near,
			wallets: [{ ledgerAccount: '1500' }, { ledgerAccounts: { NEAR: '1501', USDC: '1502' } }],
			accounts: [{ kind: 'wallet', asset: 'NEAR', ledgerAccount: '1503' }],
			chart: null
		};
		expect(suggestAssetLedger(ask)).toEqual({
			number: '1504',
			name: '',
			source: 'next',
			inChart: false
		});
		expect(suggestAssetLedger({ ...ask, reserved: ['1504'] })?.number).toBe('1505');
		// A chart account that names the wallet without the asset is the other asset's: not offered.
		expect(
			suggestAssetLedger({
				...ask,
				wallet: { name: 'Projekt Ost', address: 'ost.near' },
				wallets: [],
				accounts: [{ kind: 'wallet', asset: 'NEAR', ledgerAccount: '1400' }],
				chart: perAsset
			})?.number
		).toBe('1402');
	});

	it('flags two assets on one ledger account, and says which keeps it', () => {
		const accounts = [
			{ id: 'w-near', kind: 'wallet', source: 'near', asset: 'NEAR', ledgerAccount: '1400' },
			{ id: 'w-usdc', kind: 'wallet', source: 'near', asset: 'USDC', ledgerAccount: '1400' },
			// The same asset in two wallets on one number: allowed.
			{ id: 'v-near', kind: 'wallet', source: 'near', asset: 'NEAR', ledgerAccount: '1400' },
			{ id: 'x-btc', kind: 'exchange', source: 'kraken', asset: 'BTC', ledgerAccount: '1200' },
			{ id: 'bank', kind: 'bank', ledgerAccount: '1200' },
			{ id: 'e-eth', kind: 'wallet', source: 'ethereum', asset: 'ETH', ledgerAccount: '1450' },
			{ id: 'e-xyz', kind: 'wallet', source: 'ethereum', asset: 'XYZ', ledgerAccount: '1450' },
			{ id: 'gone', kind: 'wallet', asset: 'USDC', ledgerAccount: '1450', deleted: true },
			{ id: 'b-only', kind: 'wallet', asset: 'NEAR', ledgerAccount: '1460' }
		];
		const native = (/** @type {any} */ a) =>
			a.source === 'near' ? 'NEAR' : a.source === 'ethereum' ? 'ETH' : '';
		const named = { accounts: [{ number: '1450', name: 'Wallet XYZ Token' }] };
		const found = ledgerConflicts(accounts, named, native);
		expect(found.map((c) => [c.number, c.assets, c.keep.id, c.move.map((a) => a.id)])).toEqual([
			['1200', ['BTC', 'EUR'], 'x-btc', ['bank']],
			['1400', ['NEAR', 'USDC'], 'w-near', ['w-usdc']],
			// The chart names XYZ: XYZ keeps it, the native asset moves.
			['1450', ['ETH', 'XYZ'], 'e-xyz', ['e-eth']]
		]);
		expect(ledgerConflicts(accounts.slice(0, 1), null)).toEqual([]);
	});
});
