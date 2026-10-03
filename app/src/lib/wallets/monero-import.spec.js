// Monero from the wallet's own export (CSV): both exports understood, only
// confirmed transfers, an outgoing fee booked apart, and the whole through the
// same booking as every wallet – valued at the day's rate, idempotent. Every
// hash, address, amount and note is made up.
import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import {
	csvFields,
	fromPiconero,
	importMoneroExport,
	moneroEntries,
	parseMoneroExport,
	toPiconero
} from './monero-import.js';
import { addWallet } from './wallet-sync.js';
import { looksLikeAddress, WALLET_CHAINS, walletChain } from './chains.js';

const h = (/** @type {string} */ c) => c.repeat(64).slice(0, 64);
const ADDRESS = `4${'A'.repeat(94)}`;
const DEST = `8${'B'.repeat(94)}`;
const at = (/** @type {string} */ iso) => Math.round(Date.parse(iso) / 1000);

const GUI = [
	'blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,label,subaddrAccount,paymentId,description',
	`3300000,${at('2025-03-01T10:00:00Z')},2025-03-01 10:00,in,2.5,2500000000000,0.00003,${h('a')},"Primary account",0,,"Einlage aus Privatbesitz"`,
	`3310000,${at('2025-04-15T12:30:00Z')},2025-04-15 12:30,in,1.2,1200000000000,0.00002,${h('b')},"Kunde",0,,"Rechnung 2025-021"`,
	`3320000,${at('2025-05-02T08:00:00Z')},2025-05-02 08:00,out,0.7,700000000000,0.000061,${h('c')},"",0,,"an Lieferant"`,
	// Not confirmed yet: left out.
	`0,${at('2025-05-03T08:00:00Z')},2025-05-03 08:00,out,0.1,100000000000,0.00005,${h('d')},"",0,,""`
].join('\n');

const pad = (/** @type {string} */ s, /** @type {number} */ n) => s.padStart(n);
const CLI = [
	'   block,direction, unlocked,                timestamp,  transaction amount,     running balance,                                                            hash,      payment ID,           fee,                                                                                               destination,  destination amount,index,note,tx key',
	`${pad('3300000', 8)},${pad('in', 9)},${pad('unlocked', 8)},${pad('2025-03-01 10:00:00', 25)},${pad('2.500000000000', 20)},${pad('2.500000000000', 20)},${h('a')},${pad('0000000000000000', 16)},${pad('0.000030000000', 14)},${pad('-', 106)},${pad('', 20)},"0","Einlage, privat",`,
	`${pad('3320000', 8)},${pad('out', 9)},${pad('unlocked', 8)},${pad('2025-05-02 08:00:00', 25)},${pad('0.700000000000', 20)},${pad('1.799939000000', 20)},${h('c')},${pad('0000000000000000', 16)},${pad('0.000061000000', 14)},${pad(DEST, 106)},${pad('0.500000000000', 20)},"0","an ""Lieferant""",`,
	// A second destination of the same transfer: no block, kept with it.
	`${pad('', 8)},${pad('', 9)},${pad('', 8)},${pad('', 25)},${pad('', 20)},${pad('', 20)},${pad('', 64)},${pad('', 16)},${pad('', 14)},${pad(`8${'C'.repeat(94)}`, 106)},${pad('0.200000000000', 20)},"","",`,
	`${pad('3330000', 8)},${pad('block', 9)},${pad('unlocked', 8)},${pad('2025-06-01 00:00:00', 25)},${pad('0.600000000000', 20)},${pad('2.399939000000', 20)},${h('e')},${pad('0000000000000000', 16)},${pad('0.000000000000', 14)},${pad('-', 106)},${pad('', 20)},"0","",`,
	`${pad('3340000', 8)},${pad('pool', 9)},${pad('locked', 8)},${pad('2025-06-02 00:00:00', 25)},${pad('0.100000000000', 20)},${pad('2.399939000000', 20)},${h('f')},${pad('0000000000000000', 16)},${pad('0.000000000000', 14)},${pad('-', 106)},${pad('', 20)},"0","",`
].join('\n');

describe('reading a Monero export', () => {
	it('fields, amounts: CSV quoting and 12 decimals, exactly', () => {
		expect(csvFields('a, "b, c" ,"d ""e"""')).toEqual(['a', 'b, c', 'd "e"']);
		expect(toPiconero('2.5')).toBe(2_500_000_000_000n);
		expect(toPiconero('0.000061000000')).toBe(61_000_000n);
		expect(toPiconero('1,5')).toBeNull();
		expect(fromPiconero(-61_000_000n)).toBe('-0.000061');
		expect(fromPiconero(2_500_000_000_000n)).toBe('2.5');
	});

	it('the GUI export: confirmed transfers only, by epoch, with note and label', () => {
		const { format, transfers, skipped } = parseMoneroExport(GUI);
		expect(format).toBe('gui');
		expect(skipped).toBe(1);
		expect(transfers.map((t) => [t.direction, t.amount, t.time.slice(0, 10)])).toEqual([
			['in', 2_500_000_000_000n, '2025-03-01'],
			['in', 1_200_000_000_000n, '2025-04-15'],
			['out', 700_000_000_000n, '2025-05-02']
		]);
		expect(transfers[0].note).toBe('Einlage aus Privatbesitz · Primary account');
	});

	it('the CLI export: padded fields, UTC times, a further destination kept with its transfer, a mined block', () => {
		const { format, transfers, skipped } = parseMoneroExport(CLI);
		expect(format).toBe('cli');
		expect(skipped).toBe(1);
		expect(transfers.map((t) => [t.direction, fromPiconero(t.amount), t.time])).toEqual([
			['in', '2.5', '2025-03-01T10:00:00.000Z'],
			['out', '0.7', '2025-05-02T08:00:00.000Z'],
			['block', '0.6', '2025-06-01T00:00:00.000Z']
		]);
		expect(transfers[1].destination).toBe(DEST);
		expect(transfers[1].note).toBe('an "Lieferant"');
	});

	it('anything else is refused, saying what is expected', () => {
		expect(() => parseMoneroExport('date;amount\n1;2')).toThrow(/Not a Monero export/);
	});

	it('entries as a wallet sync books them: the outgoing fee apart, the incoming one not; the balance', () => {
		const { entries, balance } = moneroEntries(parseMoneroExport(CLI).transfers);
		expect(entries.map((e) => [e.id.slice(-9), e.type, e.kind, e.amount])).toEqual([
			[':received:0'.slice(-9), 'received', 'transfer', '2.5'],
			[':sent:0'.padStart(9, h('c')).slice(-9), 'sent', 'transfer', '-0.7'],
			[`${h('c')}:fee`.slice(-9), 'fee', 'fee', '-0.000061'],
			[':received:0'.slice(-9), 'received', 'mining', '0.6']
		]);
		expect(entries[1].counterparty).toBe(DEST);
		expect(entries[0].explorerUrl).toBe(`https://xmrchain.net/tx/${h('a')}`);
		// 2.5 − 0.7 − 0.000061 + 0.6
		expect(balance).toBe('2.399939');
	});
});

describe('importing into the books', () => {
	const store = () => ({
		accounts: memoryCollection('accounts').collection,
		transactions: memoryCollection('transactions').collection,
		settings: memoryCollection('settings').collection,
		events: memoryCollection('events').collection
	});
	/** @type {string[]} */
	const asked = [];
	const client = {
		rate: async (/** @type {string} */ asset, /** @type {string} */ date) => {
			asked.push(`${asset} ${date}`);
			return {
				asset,
				date,
				currency: 'EUR',
				rate: '200',
				usdRate: null,
				source: 'coingecko',
				at: `${date}T00:00:00Z`
			};
		}
	};

	it('one XMR account, every transfer valued at its day, the fee booked apart; a second import adds nothing', async () => {
		expect(walletChain('monero')?.nativeSymbol).toBe('XMR');
		expect(looksLikeAddress(WALLET_CHAINS.monero, ADDRESS)).toBe(true);
		expect(looksLikeAddress(WALLET_CHAINS.monero, `1${'A'.repeat(94)}`)).toBe(false);
		const s = store();
		const wallet = await addWallet(s.settings, { chain: 'monero', address: ADDRESS });
		// 2.5 + 1.2 − 0.7 − 0.000061
		const first = await importMoneroExport({ client, store: s, wallet, text: GUI });
		expect(first.format).toBe('gui');
		expect(first.totals.new).toBe(4);
		expect(asked).toContain('XMR 2025-03-01');
		const txs = await s.transactions.list();
		const byKind = txs.map((t) => [t.bookingType, t.amountCents, t.txRef === h('c') ? 'c' : '']);
		expect(byKind).toEqual(
			expect.arrayContaining([
				['Empfangen', 50_000, ''],
				['Empfangen', 24_000, ''],
				['Gesendet', -14_000, 'c'],
				['Netzwerkgebühr', -1, 'c']
			])
		);
		const [account] = await s.accounts.list();
		expect(account).toMatchObject({ source: 'monero', asset: 'XMR', balance: '2.999939' });
		const again = await importMoneroExport({ client, store: s, wallet, text: GUI });
		expect(again.totals.new).toBe(0);
		expect(await s.transactions.list()).toHaveLength(4);
	});
});
