// What a person said an address is (partners.js ADDRESS_KINDS), and what the
// classifier makes of it. Made-up addresses and names.
import { describe, expect, it } from 'vitest';
import {
	addressKindOf,
	exchangeAddressAlias,
	forgetAddress,
	nameAddress,
	txAlias
} from './partners.js';
import { classifyTransaction } from './classify.js';
import { classificationLine } from './explain.js';

const EVM = '0x' + 'ab'.repeat(20);
const NEAR_HASH = '7'.repeat(44);

/** A partners collection in memory. */
function collection() {
	/** @type {Record<string, any>[]} */
	const rows = [];
	let n = 0;
	return {
		rows,
		list: async () => rows.map((r) => ({ ...r })),
		/** @param {Record<string, any>} r */
		put: async (r) => {
			const record = { ...r, id: r.id ?? `p${++n}` };
			const at = rows.findIndex((x) => x.id === record.id);
			if (at >= 0) rows[at] = record;
			else rows.push(record);
			return record;
		}
	};
}

const withdrawal = {
	id: 'K1',
	source: 'kraken',
	movement: 'transfer',
	asset: 'NEAR',
	amountCents: -1234,
	chainTxRef: NEAR_HASH,
	chainMethod: 'NEAR',
	chainAddress: 'Wolkenfabrik.near'
};
const walletSend = {
	id: 'W1',
	source: 'base',
	movement: 'transfer',
	asset: 'USDC',
	amountCents: -500,
	counterpartyAddress: EVM.toUpperCase().replace('0X', '0x')
};

/** @param {Record<string, any>[]} partners */
const ctx = (partners) =>
	/** @type {any} */ ({
		rules: [],
		companyNames: [],
		ownIbans: new Set(),
		ownLast4: new Map(),
		addressKindOf: (/** @type {Record<string, any>} */ tx) => addressKindOf(partners, tx)
	});

describe('the alias of an exchange withdrawal’s address', () => {
	it('is the chain and the address as a wallet of that chain keeps it', () => {
		expect(exchangeAddressAlias(withdrawal)).toBe('addr:near:wolkenfabrik.near');
		expect(txAlias(withdrawal)).toBe('addr:near:wolkenfabrik.near');
	});

	it('is one for every EVM chain, as a wallet’s booking has it', () => {
		const out = {
			source: 'kraken',
			asset: 'ETH',
			chainTxRef: '0x' + 'ef'.repeat(32),
			chainAddress: EVM.toUpperCase().replace('0X', '0x')
		};
		expect(exchangeAddressAlias(out)).toBe(`addr:evm:${EVM}`);
		expect(txAlias(walletSend)).toBe(`addr:evm:${EVM}`);
	});

	it('is none without an address or a clear chain', () => {
		expect(exchangeAddressAlias({ source: 'kraken', asset: 'NEAR' })).toBeNull();
		expect(
			exchangeAddressAlias({ source: 'kraken', asset: 'XYZ', chainAddress: 'somewhere' })
		).toBeNull();
		expect(txAlias({ source: 'kraken', counterparty: 'Kraken', asset: 'XYZ' })).toBe('kraken');
	});
});

describe('what an address was said to be', () => {
	it('private: every transfer with it needs no receipt, and says why', async () => {
		const partners = collection();
		await nameAddress(/** @type {any} */ (partners), withdrawal, 'Privat', 'private');
		expect(addressKindOf(partners.rows, withdrawal)).toMatchObject({
			kind: 'private',
			name: 'Privat'
		});
		const c = classifyTransaction(withdrawal, ctx(partners.rows));
		expect(c).toMatchObject({ kind: 'rule-private', via: 'address', reason: 'Privat' });
		expect(classificationLine(/** @type {any} */ (c), {})).toContain('als private Adresse gemerkt');
		// A fee on the same booking's reference is not a transfer: left to the fee rules.
		expect(
			classifyTransaction({ ...withdrawal, id: 'K1-fee', movement: 'trade' }, ctx(partners.rows))
		).toBeNull();
	});

	it('own money at a custodian: an own transfer on 1360 that names it', async () => {
		const partners = collection();
		await nameAddress(
			/** @type {any} */ (partners),
			walletSend,
			'Testbörse Nordlicht',
			'custodian'
		);
		const c = classifyTransaction(walletSend, ctx(partners.rows));
		expect(c).toMatchObject({
			kind: 'own-transfer',
			account: '1360',
			via: 'custodian',
			company: 'Testbörse Nordlicht'
		});
		expect(classificationLine(/** @type {any} */ (c), {})).toContain(
			'Eigenes Geld bei „Testbörse Nordlicht“'
		);
	});

	it('a vendor needs its receipt; said anew, the address leaves the one before', async () => {
		const partners = collection();
		await nameAddress(/** @type {any} */ (partners), walletSend, 'Wolkenfabrik Hosting GmbH');
		expect(addressKindOf(partners.rows, walletSend)?.kind).toBe('vendor');
		expect(classifyTransaction(walletSend, ctx(partners.rows))).toBeNull();

		await nameAddress(/** @type {any} */ (partners), walletSend, 'Privat', 'private');
		expect(addressKindOf(partners.rows, walletSend)).toMatchObject({
			kind: 'private',
			name: 'Privat'
		});
		expect(partners.rows.find((p) => p.name === 'Wolkenfabrik Hosting GmbH')?.aliases).toEqual([]);

		await forgetAddress(/** @type {any} */ (partners), walletSend);
		expect(addressKindOf(partners.rows, walletSend)).toBeNull();
		expect(classifyTransaction(walletSend, ctx(partners.rows))).toBeNull();
	});

	it('takes no kind it does not know, and no address without a name', async () => {
		const partners = collection();
		expect(await nameAddress(/** @type {any} */ (partners), walletSend, 'X', 'loan')).toBeNull();
		expect(await nameAddress(/** @type {any} */ (partners), walletSend, ' ', 'private')).toBeNull();
		expect(partners.rows).toEqual([]);
	});
});
