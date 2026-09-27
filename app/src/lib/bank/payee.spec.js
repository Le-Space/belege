// Payment names and crypto sides (issues #103, #108). Made-up data only.
import { describe, expect, it } from 'vitest';

import {
	addressBook,
	merchantFromPurpose,
	payeeName,
	shortAddress,
	walletParties
} from './payee.js';

const evm = (/** @type {string} */ b) => `0x${b.repeat(20)}`;
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
/** @param {string} prefix @param {number} seed */
const bech = (prefix, seed) =>
	`${prefix}1${Array.from({ length: 38 }, (_, i) => CHARSET[(seed * 7 + i * 3) % 32]).join('')}`;

describe('merchantFromPurpose', () => {
	it('the merchant after payment words, dates and card numbers', () => {
		expect(merchantFromPurpose('Kartenzahlung WOLKENSPEICHER TEST BERLIN//DE 2026-03-17')).toBe(
			'WOLKENSPEICHER TEST BERLIN'
		);
		expect(merchantFromPurpose('VISA Debitkarte 17.03. XXXX1234 Beispiel Cloud Inc')).toBe(
			'Beispiel Cloud Inc'
		);
		expect(merchantFromPurpose('SVWZ+Kartenzahlung Kaffee Nordlicht, Hamburg')).toBe(
			'Kaffee Nordlicht'
		);
		expect(merchantFromPurpose('17.03.2026 49,52 EUR')).toBe('');
		expect(merchantFromPurpose('')).toBe('');
	});
});

describe('payeeName', () => {
	it('counterparty, then the merchant from the purpose, then the type, never a dash', () => {
		expect(payeeName({ counterparty: 'Stromwerk Test AG' })).toEqual({
			name: 'Stromwerk Test AG',
			from: 'counterparty'
		});
		expect(payeeName({ counterparty: '', purpose: 'Kartenzahlung Wolkenspeicher Test' })).toEqual({
			name: 'Wolkenspeicher Test',
			from: 'purpose'
		});
		expect(payeeName({ counterparty: '', purpose: '', bookingType: 'Lastschrift' }).name).toBe(
			'Lastschrift'
		);
		expect(payeeName({}).name).toBe('Unbekannte Gegenpartei');
	});

	it('a bank counterparty that is an address is shortened', () => {
		expect(payeeName({ counterparty: evm('ab') }).name).toBe(shortAddress(evm('ab')));
	});
});

describe('wallet bookings: names and sides', () => {
	const accounts = [
		{
			id: 'acc-biz',
			source: 'ethereum',
			name: 'Wallet ETH Firma',
			walletAddress: evm('aa'),
			asset: 'ETH'
		},
		{
			id: 'acc-priv',
			source: 'ethereum',
			name: 'Wallet ETH privat',
			walletAddress: evm('bb'),
			asset: 'ETH'
		},
		{
			id: 'acc-akt',
			source: 'akash',
			name: 'Wallet AKT',
			walletAddress: bech('akash', 1),
			asset: 'AKT'
		},
		{ id: 'acc-nym', source: 'nyx', name: 'Wallet NYM', walletAddress: bech('n', 2), asset: 'NYM' }
	];
	const partners = [{ name: 'Muster Hosting', aliases: [`addr:evm:${evm('cc')}`] }];
	const book = addressBook({ accounts, partners });

	it('received from an own other wallet: both sides named, the own receiver last', () => {
		const tx = {
			source: 'ethereum',
			accountId: 'acc-biz',
			amountCents: 591,
			counterparty: evm('bb'),
			counterpartyAddress: evm('bb')
		};
		expect(payeeName(tx, book)).toEqual({ name: 'Wallet ETH privat', from: 'wallet' });
		const p = walletParties(tx, accounts[0], book);
		expect(p?.from).toMatchObject({ label: 'Wallet ETH privat', own: true, address: evm('bb') });
		expect(p?.to).toMatchObject({ label: 'Wallet ETH Firma', own: true, address: evm('aa') });
	});

	it('sent to a partner, and to a foreign address', () => {
		const toPartner = {
			source: 'ethereum',
			amountCents: -1000,
			counterparty: evm('cc'),
			counterpartyAddress: evm('cc')
		};
		expect(payeeName(toPartner, book).name).toBe('Muster Hosting');
		const foreign = { ...toPartner, counterparty: evm('dd'), counterpartyAddress: evm('dd') };
		const p = walletParties(foreign, accounts[0], book);
		expect(p?.from.label).toBe('Wallet ETH Firma');
		expect(p?.to).toMatchObject({ label: shortAddress(evm('dd')), own: false });
	});

	it('an IBC receiver on another chain, a module label, a fee', () => {
		const ibc = {
			source: 'nyx',
			amountCents: -684,
			counterparty: 'IBC-Transfer',
			counterpartyAddress: bech('akash', 1)
		};
		expect(payeeName(ibc, book).name).toBe('Wallet AKT');
		const stake = {
			source: 'nyx',
			amountCents: -500,
			counterparty: 'Staking (gebunden)',
			counterpartyAddress: bech('n', 9)
		};
		expect(payeeName(stake, book).name).toBe('Staking (gebunden)');
		const fee = { source: 'ethereum', movement: 'fee', amountCents: -2 };
		expect(payeeName(fee, book).name).toBe('Netzwerkgebühr');
		expect(walletParties(fee, accounts[0], book)).toMatchObject({
			fee: true,
			from: { label: 'Wallet ETH Firma' }
		});
	});

	it('below a cent, the quantity says the way', () => {
		const dust = {
			source: 'ethereum',
			amountCents: 0,
			quantity: '5',
			counterparty: evm('dd'),
			counterpartyAddress: evm('dd')
		};
		expect(walletParties(dust, accounts[0], book)?.to.label).toBe('Wallet ETH Firma');
	});

	it('a bank booking has no sides', () => {
		expect(walletParties({ source: 'hibiscus' }, undefined, book)).toBeNull();
	});
});
