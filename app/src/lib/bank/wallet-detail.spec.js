// The pieces of a wallet payment's detail (issue #254): Filecoin addresses are
// addresses, the purpose without what is shown elsewhere, the explorer's page
// of an address, a rate to read. Made-up addresses and hashes.
import { describe, expect, it } from 'vitest';

import { looksLikeAddress, payeeName, walletPurposeExtra } from './payee.js';
import { addressExplorerUrl } from '../wallets/chains.js';
import { formatRateShort } from '../assets/valuation.js';

const OTHER = 'f410fotheraddressexamplexxxxxxxxxxxxxxxyyyy';
const CID = 'bafy2bzaceexamplemessagecidaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';

describe('wallet payment detail', () => {
	it('a Filecoin address is an address, and a payment to one is called by its short form', () => {
		expect(looksLikeAddress(OTHER)).toBe(true);
		expect(looksLikeAddress('f01518369')).toBe(true);
		expect(looksLikeAddress('Filecoin')).toBe(false);
		expect(looksLikeAddress('foo bar')).toBe(false);
		const name = payeeName({ source: 'filecoin', counterparty: OTHER, counterpartyAddress: OTHER });
		expect(name.name).toBe('f410foth…xxyyyy');
	});

	it('the purpose loses the type and the hash, and keeps a memo or a swap', () => {
		const tx = { source: 'filecoin', bookingType: 'Gesendet' };
		expect(walletPurposeExtra({ ...tx, purpose: 'Gesendet · Tx bafy2bza…aaaa' })).toBe('');
		expect(
			walletPurposeExtra({ ...tx, purpose: 'Gesendet · Memo: Miete · Tx bafy2bza…aaaa' })
		).toBe('Memo: Miete');
		// A bank booking keeps its purpose as it is.
		expect(walletPurposeExtra({ purpose: 'Rechnung 42 · Tx ist kein Hash' })).toBe(
			'Rechnung 42 · Tx ist kein Hash'
		);
	});

	it('the explorer page of an address, from the link to a transaction or a Filecoin message', () => {
		expect(addressExplorerUrl(`https://filfox.info/en/message/${CID}`, CID, OTHER)).toBe(
			`https://filfox.info/en/address/${OTHER}`
		);
		expect(
			addressExplorerUrl('https://etherscan.io/tx/0xabc', '0xabc', '0x' + '1'.repeat(40))
		).toBe(`https://etherscan.io/address/0x${'1'.repeat(40)}`);
		expect(addressExplorerUrl('https://example.org/other/0xabc', '0xabc', OTHER)).toBeNull();
		expect(addressExplorerUrl('http://filfox.info/en/message/x', 'x', OTHER)).toBeNull();
		expect(addressExplorerUrl(`https://filfox.info/en/message/${CID}`, CID, 'a/b')).toBeNull();
	});

	it('a rate to read has at most six significant digits, and at least two decimals', () => {
		expect(formatRateShort('1.1138044488773364', 'de-DE')).toBe('1,1138');
		expect(formatRateShort('60123.4', 'de-DE')).toBe('60.123,40');
		expect(formatRateShort('0.0000123456789', 'de-DE')).toBe('0,0000123456');
		expect(formatRateShort('2', 'de-DE')).toBe('2,00');
		expect(formatRateShort('1234567.1', 'de-DE')).toBe('1.234.567,10');
	});
});

describe('naming an address', () => {
	/** A collection in memory, as the store's. */
	const collection = () => {
		/** @type {Record<string, any>[]} */
		const rows = [];
		return {
			rows,
			list: async () => rows.filter((r) => !r.deleted),
			/** @param {Record<string, any>} r */
			put: async (r) => {
				const at = rows.findIndex((x) => x.id === r.id);
				const saved = { ...r, id: r.id ?? `p${rows.length + 1}` };
				if (at >= 0) rows[at] = saved;
				else rows.push(saved);
				return saved;
			}
		};
	};
	const tx = { source: 'filecoin', counterpartyAddress: OTHER, counterparty: OTHER };

	it('makes a partner who is known by the address, or adds the address to one', async () => {
		const { nameAddress } = await import('../matching/partners.js');
		const { addressBook } = await import('./payee.js');
		const partners = collection();
		const made = await nameAddress(/** @type {any} */ (partners), tx, '  Kraken-Einzahlung ');
		expect(made?.name).toBe('Kraken-Einzahlung');
		expect(made?.aliases).toEqual([`addr:filecoin:${OTHER}`]);
		expect(payeeName(tx, addressBook({ partners: partners.rows })).name).toBe('Kraken-Einzahlung');
		// The same name again: the same partner, the address once.
		await nameAddress(/** @type {any} */ (partners), tx, 'kraken-einzahlung');
		expect(partners.rows).toHaveLength(1);
		expect(partners.rows[0].aliases).toHaveLength(1);
		expect(await nameAddress(/** @type {any} */ (partners), tx, '   ')).toBeNull();
		expect(
			await nameAddress(/** @type {any} */ (partners), { counterparty: 'Bank' }, 'X')
		).toBeNull();
	});
});
