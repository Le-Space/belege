// Ledger accounts read off the person's chart by name, and the number a new
// wallet is offered. Made-up charts and accounts.
import { describe, expect, it } from 'vitest';

import {
	bankWord,
	chartCandidates,
	ledgersFromChart,
	nameWords,
	suggestWalletLedger
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

	it('is nothing when there is nothing to go by', () => {
		expect(
			suggestWalletLedger({ chain: { name: 'Akash' }, wallets: [{}], accounts: [], chart: null })
		).toBeNull();
	});
});
