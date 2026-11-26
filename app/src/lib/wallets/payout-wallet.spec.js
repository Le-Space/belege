// A Bitcoin receipt from a payout wallet (issue #1037): the signals, the
// flow's roles, the own address, confirmations – and that an answer for such
// a booking holds for it alone. Made-up addresses, amounts and names.
import { describe, expect, it } from 'vitest';
import { confirmationsOf, ownAddressOf, payoutSignals, utxoFlow } from './payout-wallet.js';
import { addressKindOf, bookingKindOf, nameAddress } from '../matching/partners.js';
import { classifyTransaction } from '../matching/classify.js';
import { addressBook, walletParties } from '../bank/payee.js';

const OURS = 'bc1qexampleownreceive0000000000000000k7m2';
const OUR_CHANGE = 'bc1qexampleownchange00000000000000000d6g';
const SENDER = '3Ex4mpLePayoutWa11etXXXXXXXXXXXyz9';
const other = (/** @type {number} */ i) => `bc1qexampleother${i}aaaaaaaaaaaaaaaaaaaaaaaaa`;

/** @param {Partial<Record<string, any>>} [u] @param {Partial<Record<string, any>>} [tx] */
const receipt = (u = {}, tx = {}) => ({
	id: 'B1',
	source: 'bitcoin',
	accountId: 'acc-btc',
	movement: 'transfer',
	asset: 'BTC',
	decimals: 8,
	quantity: '1234567',
	amountCents: 81240,
	counterpartyAddress: SENDER,
	txRef: 'ab'.repeat(32),
	utxo: {
		inputs: [{ address: SENDER, sats: '148210000', own: false, count: 1 }],
		outputs: [
			{ address: other(1), sats: '5000000', own: false },
			{ address: OURS, sats: '1234567', own: true },
			{ address: SENDER, sats: '130871232', own: false },
			...[2, 3, 4, 5, 6].map((i) => ({ address: other(i), sats: '2000000', own: false }))
		],
		inputCount: 1,
		outputCount: 8,
		fee: '4210',
		height: 871230,
		senderTxs: 100000,
		...u
	},
	...tx
});

/** An own payment with change: both inputs ours. */
const send = {
	id: 'B2',
	source: 'bitcoin',
	movement: 'transfer',
	asset: 'BTC',
	decimals: 8,
	quantity: '-412000',
	amountCents: -27115,
	counterpartyAddress: other(9),
	utxo: {
		inputs: [{ address: OURS, sats: '600000', own: true, count: 2 }],
		outputs: [
			{ address: other(9), sats: '412000', own: false },
			{ address: OUR_CHANGE, sats: '185200', own: true }
		],
		inputCount: 2,
		outputCount: 2,
		fee: '2800',
		height: 871822
	}
};

describe('the flow of a Bitcoin transaction', () => {
	it('marks ours, the change back to the sender and the others', () => {
		const flow = utxoFlow(receipt());
		expect(flow?.weSent).toBe(false);
		expect(flow?.outputs.map((o) => o.role)).toEqual([
			'other',
			'ours',
			'change',
			'other',
			'other',
			'other',
			'other',
			'other'
		]);
	});

	it('marks an own payment’s change as ours, not as the sender’s', () => {
		const flow = utxoFlow(send);
		expect(flow?.weSent).toBe(true);
		expect(flow?.outputs.map((o) => o.role)).toEqual(['other', 'ourChange']);
	});

	it('is none without the reader’s shape', () => {
		expect(utxoFlow({ source: 'bitcoin' })).toBeNull();
		expect(utxoFlow({ utxo: { inputs: [] } })).toBeNull();
	});

	it('gives the own address: where a receipt arrived, where a payment was paid from', () => {
		expect(ownAddressOf(receipt())).toBe(OURS);
		expect(ownAddressOf(send)).toBe(OURS);
		expect(ownAddressOf({})).toBe('');
	});

	it('counts confirmations from the tip of the last sync', () => {
		expect(confirmationsOf(receipt(), 872433)).toBe(1204);
		expect(confirmationsOf(receipt(), 871230)).toBe(1);
		expect(confirmationsOf(receipt(), undefined)).toBeNull();
		expect(confirmationsOf(receipt(), 100)).toBeNull();
	});
});

describe('a payout wallet', () => {
	it('is a busy sender that pays out in a batch with the change back', () => {
		const s = payoutSignals(receipt());
		expect(s).toMatchObject({
			payout: true,
			sender: SENDER,
			busy: true,
			reused: true,
			batch: true,
			changeBack: true,
			outputs: 8
		});
	});

	it('is a busy sender alone, even in a transaction of two outputs', () => {
		const s = payoutSignals(
			receipt({
				outputs: [
					{ address: OURS, sats: '1234567', own: true },
					{ address: other(1), sats: '99', own: false }
				],
				outputCount: 2,
				senderTxs: 1000
			})
		);
		expect(s).toMatchObject({ payout: true, busy: true, batch: false, changeBack: false });
	});

	it('is a batch with the change back, without knowing how busy the sender is', () => {
		const s = payoutSignals(receipt({ senderTxs: undefined }));
		expect(s).toMatchObject({ payout: true, busy: false, reused: false, changeBack: true });
	});

	it('is a batch from a sender seen in other bookings of ours', () => {
		const shape = receipt({
			senderTxs: undefined,
			outputs: [
				{ address: OURS, sats: '1234567', own: true },
				...[1, 2, 3, 4].map((i) => ({ address: other(i), sats: '2000000', own: false }))
			],
			outputCount: 5
		});
		expect(payoutSignals(shape)?.payout).toBe(false);
		expect(payoutSignals(shape, { others: 2 })).toMatchObject({ payout: true, reused: true });
	});

	it('is not a person who pays once, with change to a fresh address', () => {
		const s = payoutSignals(
			receipt({
				outputs: [
					{ address: OURS, sats: '1234567', own: true },
					{ address: other(7), sats: '500000', own: false }
				],
				outputCount: 2,
				senderTxs: 1
			})
		);
		expect(s).toMatchObject({ payout: false, busy: false, reused: false, batch: false });
	});

	it('is not asked of an own payment', () => {
		expect(payoutSignals(send)).toBeNull();
	});
});

describe('an answer for one booking', () => {
	/** @param {Record<string, any>[]} partners */
	const ctx = (partners) =>
		/** @type {any} */ ({
			rules: [],
			companyNames: [],
			ownIbans: new Set(),
			ownLast4: new Map(),
			addressKindOf: (/** @type {Record<string, any>} */ tx) => addressKindOf(partners, tx)
		});

	it('comes before what is remembered for the address, and leaves other bookings alone', () => {
		const partners = [
			{
				id: 'p1',
				name: 'Stromwerk Test AG',
				aliases: [`addr:bitcoin:${SENDER}`],
				addressKinds: {}
			}
		];
		const said = receipt({}, { saidKind: { kind: 'custodian', name: 'Kraken BTC' } });
		expect(bookingKindOf(said)).toEqual({ kind: 'custodian', name: 'Kraken BTC', booking: true });
		expect(addressKindOf(partners, said)).toMatchObject({ kind: 'custodian', booking: true });
		expect(classifyTransaction(said, ctx(partners))).toMatchObject({
			kind: 'own-transfer',
			account: '1360',
			via: 'custodian',
			company: 'Kraken BTC'
		});
		// The next payout from the same address: what the address was said to be.
		const next = receipt({}, { id: 'B3' });
		expect(addressKindOf(partners, next)).toMatchObject({
			kind: 'vendor',
			name: 'Stromwerk Test AG'
		});
		expect(addressKindOf(partners, next)?.booking).toBeUndefined();
	});

	it('is nothing without a kind or a name', () => {
		expect(bookingKindOf(receipt({}, { saidKind: { kind: 'vendor', name: ' ' } }))).toBeNull();
		expect(bookingKindOf(receipt({}, { saidKind: { kind: 'own', name: 'x' } }))).toBeNull();
		expect(bookingKindOf(receipt({}, { saidKind: null }))).toBeNull();
	});

	it('names the booking’s other side', async () => {
		/** @type {Record<string, any>[]} */
		const rows = [];
		const partners = {
			list: async () => rows,
			/** @param {Record<string, any>} r */
			put: async (r) => (rows.push({ ...r, id: `p${rows.length + 1}` }), r)
		};
		await nameAddress(/** @type {any} */ (partners), receipt(), 'Muster GmbH');
		const book = addressBook({ accounts: [], partners: rows });
		const said = receipt({}, { saidKind: { kind: 'vendor', name: 'Stromwerk Test AG' } });
		expect(walletParties(said, undefined, book)?.from.label).toBe('Stromwerk Test AG');
		expect(walletParties(receipt(), undefined, book)?.from.label).toBe('Muster GmbH');
	});
});

describe('the own side of a key-read wallet', () => {
	it('is the address the receipt arrived at, not the key’s fingerprint', () => {
		const account = {
			id: 'acc-btc',
			source: 'bitcoin',
			walletAddress: 'btc-0a1b2c3d',
			name: 'Konto A · BTC'
		};
		const p = walletParties(receipt(), account, addressBook({ accounts: [account], partners: [] }));
		expect(p?.to).toMatchObject({ address: OURS, own: true, label: 'Konto A · BTC' });
		expect(p?.from.address).toBe(SENDER);
	});

	it('is no address at all without the transaction’s shape', () => {
		const account = {
			id: 'acc-btc',
			source: 'bitcoin',
			walletAddress: 'btc-0a1b2c3d',
			name: 'Konto A · BTC'
		};
		const p = walletParties(
			{ ...receipt(), utxo: undefined },
			account,
			addressBook({ accounts: [account], partners: [] })
		);
		expect(p?.to.address).toBe('');
	});
});
