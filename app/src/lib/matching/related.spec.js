// Bookings that belong together. Made-up bookings only.
import { describe, expect, it } from 'vitest';

import { relatedIndex } from './related.js';

const HASH = 'ab'.repeat(32);

describe('relatedIndex', () => {
	it('an exchange deposit and the wallet that sent it, by the on-chain hash; the wallet fee both ways', () => {
		const deposit = {
			id: 'K1',
			accountId: 'KR-USDC',
			source: 'kraken',
			movement: 'transfer',
			txRef: 'FTEXAMPLE0001',
			chainTxRef: `0x${HASH}`,
			amountCents: 11059
		};
		const sent = {
			id: 'W1',
			accountId: 'W-USDC',
			source: 'ethereum',
			movement: 'transfer',
			txRef: `0x${HASH}`,
			amountCents: -11050
		};
		const fee = {
			id: 'W1F',
			accountId: 'W-ETH',
			source: 'ethereum',
			movement: 'fee',
			txRef: `0x${HASH}`,
			amountCents: -42
		};
		const index = relatedIndex([deposit, sent, fee]);
		const of = (/** @type {string} */ id) =>
			(index.get(id) ?? []).map((r) => [r.kind, r.via, r.other.id]);
		expect(of('K1')).toEqual([['transfer', 'hash', 'W1']]);
		expect(of('W1')).toEqual([
			['transfer', 'hash', 'K1'],
			['fee', 'hash', 'W1F']
		]);
		expect(of('W1F')).toEqual([['fee-of', 'hash', 'W1']]);
	});

	it('a trade’s two legs by the refid; the exchange fee on it', () => {
		const eur = {
			id: 'T1',
			accountId: 'KR-EUR',
			movement: 'trade',
			txRef: 'TRD-1',
			amountCents: -11040
		};
		const coin = {
			id: 'T2',
			accountId: 'KR-USDC',
			movement: 'trade',
			txRef: 'TRD-1',
			amountCents: 11040
		};
		const fee = {
			id: 'T1F',
			accountId: 'KR-EUR',
			movement: 'fee',
			txRef: 'TRD-1',
			amountCents: -30
		};
		const index = relatedIndex([eur, coin, fee]);
		expect(index.get('T1')?.map((r) => [r.kind, r.other.id])).toEqual([
			['trade', 'T2'],
			['fee', 'T1F']
		]);
		expect(index.get('T2')?.map((r) => [r.kind, r.via])).toEqual([
			['trade', 'refid'],
			['fee', 'refid']
		]);
	});

	it('a bank transfer by its counter-booking, from the classification; nothing for a lone booking', () => {
		const out = { id: 'B1', accountId: 'A', amountCents: -50000, txRef: '' };
		const into = { id: 'B2', accountId: 'B', amountCents: 50000, txRef: '' };
		const lone = { id: 'B3', accountId: 'A', amountCents: -999 };
		const index = relatedIndex([out, into, lone], {
			B1: { kind: 'own-transfer', via: 'counter-booking', counterBookingId: 'B2' }
		});
		expect(index.get('B1')?.map((r) => [r.kind, r.via, r.other.id])).toEqual([
			['transfer', 'counter-booking', 'B2']
		]);
		expect(index.get('B2')?.map((r) => r.other.id)).toEqual(['B1']);
		expect(index.has('B3')).toBe(false);
	});

	it('a transfer the classification found "by reference" through a shared hash says hash', () => {
		const w = {
			id: 'W',
			accountId: 'W1',
			movement: 'transfer',
			txRef: `0x${HASH}`,
			amountCents: -100
		};
		const k = {
			id: 'K',
			accountId: 'K1',
			movement: 'transfer',
			txRef: 'FT1',
			chainTxRef: `0x${HASH}`,
			amountCents: 100
		};
		const index = relatedIndex([w, k], {
			W: { kind: 'own-transfer', via: 'reference', counterBookingId: 'K' }
		});
		expect(index.get('W')?.map((r) => r.via)).toEqual(['hash']);
	});

	it('same direction, same account or deleted under one reference: no pair', () => {
		const a = { id: 'X1', accountId: 'A', movement: 'transfer', txRef: 'REF-9', amountCents: -100 };
		const sameDirection = { ...a, id: 'X2', accountId: 'B' };
		const sameAccount = { ...a, id: 'X3', amountCents: 100 };
		const deleted = { ...a, id: 'X4', accountId: 'B', amountCents: 100, deleted: true };
		expect(relatedIndex([a, sameDirection]).size).toBe(0);
		expect(relatedIndex([a, sameAccount]).size).toBe(0);
		expect(relatedIndex([a, deleted]).size).toBe(0);
	});
});
