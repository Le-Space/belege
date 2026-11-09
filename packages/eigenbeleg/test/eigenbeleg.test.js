// SPDX-License-Identifier: AGPL-3.0-or-later
// The Eigenbeleg of a period and the Kontoauszug: what goes on them, the CSV,
// the PDF/A. From Le-Space/eigenbeleg-agent packages/eigenbeleg/test at e6cde90.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { entry } from '@le-space/ledger';
import { pdfaStructure } from '@le-space/pdf/testing/pdfa-structure';
import { mapRaw } from '@le-space/chains/near';
import { fixedRates, valueEntries } from '../src/value.js';
import {
	NOTE,
	buildDocument,
	deEuro,
	deNumber,
	eigenbelegCsv,
	eigenbelegPdf
} from '../src/index.js';

// Made-up payer, as everywhere in this repository.
const payer = {
	name: 'Wolkenfabrik Hosting GmbH',
	address: 'Musterstraße 1\n12345 Beispielstadt',
	addresses: ['wolkenfabrik.testnet', 'wolkenfabrik-ops.testnet']
};
const base = {
	chain: 'near',
	network: 'testnet',
	account: 'wolkenfabrik.testnet',
	height: 1,
	contract: 'native',
	asset: 'NEAR',
	priceAs: 'NEAR',
	decimals: 24,
	counterpartyLabel: '',
	method: '',
	memo: '',
	success: true,
	explorerUrl: 'https://testnet.nearblocks.io/txns/X'
};
const e = (over) => entry({ ...base, hash: over.id, time: '2026-10-05T10:00:00Z', ...over });

const entries = await valueEntries(
	[
		e({
			id: 'fee1',
			type: 'fee',
			kind: 'fee',
			amount: '-0.000446365125',
			counterparty: 'near',
			counterpartyLabel: 'NEAR-Netzwerk'
		}),
		e({
			id: 'sto1',
			type: 'sent',
			kind: 'storage',
			amount: '-0.00125',
			counterparty: 'usdc.fakes.testnet'
		}),
		e({
			id: 'pay1',
			type: 'sent',
			kind: 'transfer',
			amount: '-2',
			counterparty: 'stromwerk.testnet'
		}),
		e({
			id: 'own1',
			type: 'sent',
			kind: 'transfer',
			amount: '-1',
			counterparty: 'wolkenfabrik-ops.testnet'
		}),
		e({
			id: 'in1',
			type: 'received',
			kind: 'transfer',
			amount: '5',
			counterparty: 'stromwerk.testnet'
		}),
		e({
			id: 'spam',
			type: 'received',
			kind: 'transfer',
			amount: '100',
			asset: 'SPAM',
			priceAs: '',
			contract: 'spam.testnet',
			counterparty: 'spam.testnet'
		})
	],
	fixedRates({ NEAR: '3.8' })
);
const docArgs = {
	payer,
	chain: 'near',
	network: 'testnet',
	period: { from: '2026-10-01', to: '2026-10-31' },
	entries,
	number: 'EB-2026-007',
	issuedAt: '2026-11-06T10:00:00.000Z'
};
const doc = buildDocument(docArgs);

test('only payments to the network are on it; everything else says why not', () => {
	assert.deepEqual(
		doc.positions.map((p) => [p.pos, p.entry.id]),
		[
			[1, 'fee1'],
			[2, 'sto1']
		]
	);
	assert.deepEqual(Object.fromEntries(doc.excluded.map((x) => [x.entry.id, x.why])), {
		pay1: 'Zahlung an ein Konto: Fremdbeleg anfordern oder bewusst einbeziehen',
		own1: 'Umbuchung zwischen eigenen Adressen',
		in1: 'Eingang, keine Zahlung',
		spam: 'Eingang, keine Zahlung'
	});
	assert.deepEqual(doc.totals.quantities, { NEAR: '0.001696365125' });
	assert.equal(doc.totals.eurExact, '0.00644619');
	assert.equal(doc.totals.eur, '0.01');
	assert.ok(doc.testnet);
});

test('a transfer goes on it only when the payer includes it', () => {
	const d = buildDocument({
		payer,
		chain: 'near',
		network: 'testnet',
		period: { from: '2026-10-01', to: '2026-10-31' },
		entries,
		includeKinds: ['fee', 'storage', 'transfer']
	});
	assert.deepEqual(
		d.positions.map((p) => p.entry.id),
		['fee1', 'sto1', 'pay1']
	);
	assert.equal(d.number, 'EB-2026-001');
});

test('the payer is required: name, postal address, own addresses', () => {
	const args = {
		chain: 'near',
		network: 'testnet',
		period: { from: '2026-10-01', to: '2026-10-31' },
		entries
	};
	assert.throws(() => buildDocument({ ...args, payer: { ...payer, name: '' } }), /payer.name/);
	assert.throws(
		() => buildDocument({ ...args, payer: { ...payer, address: '' } }),
		/payer.address/
	);
	assert.throws(
		() => buildDocument({ ...args, payer: { ...payer, addresses: [] } }),
		/payer.addresses/
	);
});

test('German number formats', () => {
	assert.equal(deNumber('-1234567.891'), '−1.234.567,891');
	assert.equal(deEuro('0.00644619', 4), '0,0064 €');
	assert.equal(deEuro('1234.5'), '1.234,50 €');
});

test('the CSV: BOM, semicolons, every entry, formulas defused', async () => {
	const evil = await valueEntries(
		[
			e({
				id: 'evil',
				type: 'sent',
				kind: 'transfer',
				amount: '-1',
				counterparty: '=HYPERLINK("x")'
			})
		],
		fixedRates({ NEAR: '1' })
	);
	const csv = eigenbelegCsv(
		buildDocument({
			payer,
			chain: 'near',
			network: 'testnet',
			period: { from: '2026-10-01', to: '2026-10-31' },
			entries: evil
		})
	);
	assert.ok(csv.startsWith('\uFEFFBelegnummer;Position;'));
	assert.match(csv, /;"'=HYPERLINK\(""x""\)";/);
	const lines = eigenbelegCsv(doc).trim().split('\r\n');
	assert.equal(lines.length, 1 + entries.length + 2);
	assert.match(
		lines[1],
		/^EB-2026-007;1;2026-10-05;10:00:00;near;testnet;wolkenfabrik\.testnet;Netzwerkgebühr \(Gas\);Gebühr;NEAR-Netzwerk \(near\);NEAR;native;-0,000446365125;3,8;-0,00169619;/
	);
	assert.match(
		lines.at(-1) ?? '',
		/^EB-2026-007;Summe;.*;-0,01;gerundet auf Cent, ungerundet -0,00644619;/
	);
});

test('the PDF is PDF/A-2b shaped: XMP, sRGB intent, id, embedded fonts, the note', async () => {
	const bytes = await eigenbelegPdf(doc);
	const s = Buffer.from(bytes).toString('latin1');
	assert.ok(s.startsWith('%PDF-1.7'));
	assert.match(s, /<pdfaid:part>2<\/pdfaid:part>/);
	assert.match(s, /\/GTS_PDFA1/);
	assert.match(s, /\/ID \[/);
	assert.match(s, /\/FontFile2/);
	assert.doesNotMatch(s, /\/BaseFont \/(Helvetica|Courier|Times)/);
	// The id is SHA-256 of number|issuedAt|payer (now from @noble/hashes, the same in a browser): as node:crypto had it.
	const { createHash } = await import('node:crypto');
	const id = createHash('sha256')
		.update(`${doc.number}|${doc.issuedAt}|${doc.payer.name}`)
		.digest('hex')
		.slice(0, 32);
	assert.match(s, new RegExp(`/ID \\[ <${id}> <${id}> \\]`));
	// The same document twice is the same file: nothing depends on the clock or on chance.
	assert.deepEqual(await eigenbelegPdf(doc), bytes);
	assert.ok(
		NOTE.startsWith(
			'Eigenbeleg. Für diese Zahlung gibt es keinen Fremdbeleg: Empfänger ist ein Peer-to-Peer-Netzwerk ohne rechnungsstellende Organisation. Ausgestellt vom Zahlenden auf Grundlage der öffentlichen Transaktion'
		)
	);
});

test('a real relayer day (public data) gives one position per fee', async () => {
	const raw = JSON.parse(
		await readFile(new URL('./fixtures/relay-aurora-2026-11-01.json', import.meta.url), 'utf8')
	);
	const valued = await valueEntries(mapRaw(raw), fixedRates({ NEAR: '2' }));
	const d = buildDocument({
		payer: { ...payer, addresses: ['relay.aurora'] },
		chain: 'near',
		network: 'mainnet',
		period: { from: '2026-11-01', to: '2026-11-01' },
		entries: valued
	});
	assert.equal(d.positions.length, raw.txns.length);
	assert.equal(d.excluded.length, 0);
	assert.ok((await eigenbelegPdf(d)).length > 10_000);
});

test("the chain's mark beside the title, only with logo: true", async () => {
	const { buildStatement, statementPdf } = await import('../src/index.js');
	const st = buildStatement({
		payer,
		account: 'wolkenfabrik.testnet',
		chain: 'near',
		network: 'testnet',
		period: { from: '2026-10-01', to: '2026-10-31' },
		entries,
		opening: { NEAR: '10' },
		closing: { NEAR: '11.998303634875' },
		method: 'archive'
	});
	const mark = { width: 192, height: 192, colorSpace: 'DeviceRGB', softMask: false };
	for (const draw of [(o) => eigenbelegPdf(doc, o), (o) => statementPdf(st, o)]) {
		const plain = await draw();
		const marked = await draw({ logo: true });
		assert.deepEqual(pdfaStructure(plain).images, [], 'no image without logo');
		assert.deepEqual(pdfaStructure(marked).images, [mark], 'the mark, opaque RGB');
		assert.deepEqual(pdfaStructure(marked).pdfaid, { part: '2', conformance: 'B' });
		assert.deepEqual(await draw({ logo: true }), marked, 'the same bytes every time');
	}
	// One mark for all the Eigenbelege of a period, however many pages.
	const single = buildDocument({ ...docArgs, layout: 'single' });
	assert.equal(pdfaStructure(await eigenbelegPdf(single, { logo: true })).images.length, 1);
	// A chain without a mark: none, and no error.
	const other = { ...doc, chain: 'ethereum' };
	assert.deepEqual(pdfaStructure(await eigenbelegPdf(other, { logo: true })).images, []);
});

test('letters the fonts lack and bidi or control characters do not break the PDF (veraPDF rule 6.2.11.8)', async () => {
	const odd = buildDocument({
		payer: {
			name: '测试 GmbH 🚀\tTab',
			address: 'Straße 1\r\n12345 Ort ‮',
			addresses: ['x.testnet']
		},
		chain: 'near',
		network: 'testnet',
		period: { from: '2026-10-01', to: '2026-10-31' },
		entries: []
	});
	const bytes = await eigenbelegPdf(odd);
	assert.ok(bytes.length > 5000);
});

test('numbers count up from the first; one Eigenbeleg per transaction with all its movements', async () => {
	const { nthNumber } = await import('../src/document.js');
	assert.equal(nthNumber('EB-2026-009', 0), 'EB-2026-009');
	assert.equal(nthNumber('EB-2026-009', 2), 'EB-2026-011');
	assert.equal(nthNumber('EB-2026-099', 1), 'EB-2026-100');
	assert.equal(nthNumber('Beleg', 1), 'Beleg-2');
	const same = await valueEntries(
		[
			e({
				id: 'tx9:storage',
				hash: 'tx9',
				type: 'sent',
				kind: 'storage',
				amount: '-0.00125',
				counterparty: 'usdc.fakes.testnet'
			}),
			e({
				id: 'tx9:fee',
				hash: 'tx9',
				type: 'fee',
				kind: 'fee',
				amount: '-0.0003',
				counterparty: 'near',
				counterpartyLabel: 'NEAR-Netzwerk'
			}),
			e({
				id: 'tx8:in',
				hash: 'tx8',
				type: 'received',
				kind: 'transfer',
				amount: '5',
				counterparty: 'stromwerk.testnet'
			})
		],
		fixedRates({ NEAR: '2' })
	);
	const d = buildDocument({
		payer,
		chain: 'near',
		network: 'testnet',
		period: { from: '2026-10-01', to: '2026-10-31' },
		entries: same,
		number: 'EB-2026-009',
		layout: 'single'
	});
	assert.equal(d.transactions.length, 1);
	const [t] = d.transactions;
	assert.equal(t.number, 'EB-2026-009');
	assert.deepEqual([t.from.address, t.to.address], ['wolkenfabrik.testnet', 'usdc.fakes.testnet']);
	assert.deepEqual(
		t.movements.map((m) => [m.what, m.onIt]),
		[
			['Speicherhinterlegung (Storage Deposit)', true],
			['Netzwerkgebühr (Gas)', true]
		]
	);
	assert.equal(t.eurExact, '0.0031');
	assert.match(eigenbelegCsv(d), /\r\nEB-2026-009;1;/);
	assert.ok((await eigenbelegPdf(d)).length > 10_000);
});

test('the Kontoauszug: running balance, sums, and the check against the chain', async () => {
	const { buildStatement, statementPdf } = await import('../src/index.js');
	const st = (closing) =>
		buildStatement({
			payer,
			account: 'wolkenfabrik.testnet',
			chain: 'near',
			network: 'testnet',
			period: { from: '2026-10-01', to: '2026-10-31' },
			entries,
			opening: { NEAR: '10' },
			closing: { NEAR: closing },
			method: 'archive',
			belege: new Map([['fee1', 'EB-2026-007']])
		});
	const ok = st('11.99830363');
	const [near] = ok.sections;
	assert.deepEqual(
		near.rows.map((r) => [r.debit, r.credit, r.balance]),
		[
			['0.000446365125', '', '9.999553634875'],
			['0.00125', '', '9.998303634875'],
			['2', '', '7.998303634875'],
			['1', '', '6.998303634875'],
			['', '5', '11.998303634875']
		]
	);
	assert.equal(near.rows[0].beleg, 'EB-2026-007');
	assert.equal(near.closing, '11.998303634875');
	assert.equal(near.difference, '-0.000000004875', 'off by what the chain says');
	assert.equal(st('11.998303634875').sections[0].difference, '0');
	assert.equal(ok.unlisted, 1, 'the spam token is not a section');
	assert.ok((await statementPdf(ok)).length > 10_000);
});
