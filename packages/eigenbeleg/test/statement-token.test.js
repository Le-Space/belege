// SPDX-License-Identifier: AGPL-3.0-or-later
// A Kontoauszug of an EVM wallet with a token not in the chain's list (#93):
// a section of its own, named by its contract, valued only by its contract;
// and a section that does not fit on the rest of a page starts on a new one.
// Made-up addresses and amounts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractText, getDocumentProxy } from 'unpdf';

import { buildStatement, fixedRates, statementPdf, valueEntries } from '../src/index.js';
import { WALLET, XYZ, tokenEntries } from './support/token-entries.js';

const payer = { name: 'Wolkenfabrik Hosting GmbH', address: 'Musterstraße 1\n12345 Beispielstadt' };
const period = { from: '2026-10-01', to: '2026-10-31' };
const issuedAt = '2026-11-06T10:00:00.000Z';
const DROP = `0x${'d7'.repeat(20)}`;

/** @param {Uint8Array} bytes @returns {Promise<string[]>} one text per page */
const pagesOf = async (bytes) =>
	/** @type {string[]} */ (
		(await extractText(await getDocumentProxy(bytes.slice()), { mergePages: false })).text
	).map((t) => t.replace(/\s+/g, ' '));

/** @param {import('@le-space/ledger').LedgerEntry[]} entries @param {Partial<Parameters<typeof buildStatement>[0]>} [over] */
const statement = async (entries, over = {}) =>
	buildStatement({
		payer,
		account: WALLET,
		chain: 'ethereum',
		network: 'mainnet',
		period,
		entries: await valueEntries(entries, fixedRates({ ETH: '3000', [XYZ]: '0.02' })),
		opening: { ETH: '1', XYZ: '100' },
		closing: { ETH: '0.5', XYZ: '40' },
		method: 'derived',
		issuedAt,
		...over
	});

test('a token not in the list: a section of its own, its contract, its sources', async () => {
	const st = await statement(tokenEntries());
	assert.deepEqual(
		st.sections.map((s) => [s.asset, s.contract, s.closing]),
		[
			['ETH', '', '0.5'],
			['XYZ', XYZ, '40']
		],
		'the failed send is no booking; the Akash denom without a contract gets no section'
	);
	assert.deepEqual(st.sections[1].sources, [`fester Testkurs (Token-Vertrag ${XYZ})`]);
	assert.equal(st.unlisted, 1);
});

test('a token with a balance and no booking in the period: named by the reader’s contract', async () => {
	const st = await statement(tokenEntries().slice(0, 1), {
		opening: { ETH: '1', DROP: '5' },
		closing: { ETH: '0.5', DROP: '5' },
		contracts: { DROP: DROP.toUpperCase().replace('0X', '0x'), ETH: 'native' }
	});
	assert.deepEqual(
		st.sections.map((s) => [s.asset, s.contract]),
		[
			['ETH', ''],
			['DROP', DROP]
		]
	);
});

test('the PDF names the contract and says the symbol is its own claim', async () => {
	const text = (await pagesOf(await statementPdf(await statement(tokenEntries())))).join(' ');
	assert.match(text, /XYZ \(laut Token-Vertrag\)/);
	assert.ok(text.includes(XYZ), 'the contract in full');
	assert.match(text, /Name »XYZ« und Nachkommastellen nennt der Vertrag/);
	assert.ok(
		text.includes(`zum Kurs nach der Vertragsadresse: fester Testkurs (Token-Vertrag ${XYZ})`)
	);
	assert.ok(!/XYZ[^]{0,400}CoinGecko, sonst Kraken/.test(text.slice(text.indexOf('XYZ (laut'))));
});

test('an unvalued token says so instead of naming a market rate', async () => {
	const entries = await valueEntries(tokenEntries(), fixedRates({ ETH: '3000' }));
	const st = buildStatement({
		payer,
		account: WALLET,
		chain: 'ethereum',
		network: 'mainnet',
		period,
		entries,
		opening: { ETH: '1', XYZ: '100' },
		closing: { ETH: '0.5', XYZ: '40' },
		method: 'derived',
		issuedAt
	});
	const text = (await pagesOf(await statementPdf(st))).join(' ');
	assert.match(text, /für diesen Token nennt keine Kursquelle einen Kurs/);
});

test('a section that does not fit on the rest of the page starts on a new one; short ones follow', async () => {
	const short = await pagesOf(
		await statementPdf(await statement(tokenEntries()), { chart: false })
	);
	assert.equal(short.length, 1, 'two short sections on one page');

	// More and more ETH bookings: somewhere the XYZ section would start near the foot of a page.
	const eth = tokenEntries()[0];
	let broke = 0;
	for (let n = 10; n <= 40; n += 2) {
		const many = Array.from({ length: n }, (_, i) => ({
			...eth,
			id: `${eth.id}-${i}`,
			hash: `0x${String(i).padStart(2, '0').repeat(32)}`,
			amount: '-0.01'
		}));
		const pages = await pagesOf(
			await statementPdf(await statement([...many, ...tokenEntries().slice(1)]), {
				chart: false
			})
		);
		const at = pages.findIndex((p) => p.includes('XYZ (laut Token-Vertrag)'));
		assert.ok(pages[at].includes('(Ende) 40 XYZ'), `${n}: the XYZ section on one page`);
		assert.ok(/\(Ende\) [\d,]+ ETH/.test(pages.slice(0, at + 1).join(' ')), `${n}: ETH first`);
		if (!/\(Ende\) [\d,]+ ETH/.test(pages[at])) broke++;
	}
	assert.ok(broke > 0, 'at least once the XYZ section started on a page of its own');
});
