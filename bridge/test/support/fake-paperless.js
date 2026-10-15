// A Paperless-ngx API on 127.0.0.1 for tests (issue #318): token auth, paged
// lists with `added__gt`, names of tags, correspondents and document types, and
// downloads of the original or the archive PDF. Its `next` links name another
// host, as a Paperless behind a proxy does; a client must not follow them.
// All documents, names and texts are made up.
import http from 'node:http';

import { makePdf } from './synthetic-pdf.js';

export const FAKE_PAPERLESS_TOKEN = 'fake-paperless-token-0000000000000000000000';

/** A JPEG's first bytes and some more: enough for a sniffer, not a picture. */
const FAKE_JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

export const TAGS = [
	{ id: 1, name: 'Rechnung' },
	{ id: 2, name: 'aus-Mail' }
];
export const CORRESPONDENTS = [{ id: 7, name: 'Beispiel Hosting GmbH' }];
export const DOCUMENT_TYPES = [{ id: 3, name: 'Rechnung' }];

/**
 * The documents, oldest first. `original` and `archive` are the bytes Paperless
 * would hand out; null where it has none.
 */
export function sampleDocuments() {
	const invoice = makePdf(['Beispiel Hosting GmbH', 'Rechnung RE-2026-0042', 'Summe 23,80 EUR']);
	return [
		{
			id: 11,
			title: 'Rechnung RE-2026-0042',
			created: '2026-09-03',
			added: '2026-09-04T08:00:00+02:00',
			correspondent: 7,
			document_type: 3,
			tags: [1, 2],
			original_file_name: 'RE-2026-0042.pdf',
			mime_type: 'application/pdf',
			content: 'Beispiel Hosting GmbH\nRechnung RE-2026-0042\nSumme 23,80 EUR',
			original: invoice,
			archive: invoice
		},
		{
			id: 12,
			title: 'Kassenbon Baumarkt',
			created: '2026-09-10',
			added: '2026-09-11T09:30:00+02:00',
			correspondent: null,
			document_type: null,
			tags: [1],
			original_file_name: 'scan-0001.jpg',
			mime_type: 'image/jpeg',
			content: 'Musterbaumarkt\nSchrauben 4,99\nSUMME EUR 4,99',
			original: FAKE_JPEG,
			archive: makePdf(['Musterbaumarkt', 'SUMME EUR 4,99'])
		},
		{
			id: 13,
			title: 'Ihre Bestellung',
			created: '2026-09-20',
			added: '2026-09-20T12:00:00+02:00',
			correspondent: null,
			document_type: null,
			tags: [2],
			original_file_name: 'bestellung.eml',
			mime_type: 'message/rfc822',
			content: 'Danke für Ihre Bestellung. Betrag 12,00 EUR',
			original: Buffer.from(
				'From: shop@example.invalid\r\nSubject: Ihre Bestellung\r\n\r\nBetrag 12,00 EUR'
			),
			archive: makePdf(['Ihre Bestellung', 'Betrag 12,00 EUR'])
		},
		{
			id: 14,
			title: 'Tabelle',
			created: '2026-09-25',
			added: '2026-09-25T10:00:00+02:00',
			correspondent: null,
			document_type: null,
			tags: [],
			original_file_name: 'tabelle.xlsx',
			mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			content: '',
			original: Buffer.from('PK\x03\x04 not a receipt'),
			archive: null
		}
	];
}

/**
 * @param {{ documents?: ReturnType<typeof sampleDocuments>, pageSizeCap?: number }} [options]
 *   pageSizeCap: answer at most this many per page, whatever is asked (to make paging happen)
 */
export async function startFakePaperless({ documents = sampleDocuments(), pageSizeCap } = {}) {
	/** @type {string[]} */
	const seen = [];
	/** @type {string[]} */
	const authHeaders = [];

	/** @param {any[]} rows @param {URL} url */
	const paged = (rows, url) => {
		const size = Math.min(Number(url.searchParams.get('page_size') ?? 25), pageSizeCap ?? Infinity);
		const page = Number(url.searchParams.get('page') ?? 1);
		const results = rows.slice((page - 1) * size, page * size);
		const more = page * size < rows.length;
		return {
			count: rows.length,
			// The host Paperless believes it is on: not this one.
			next: more ? `http://paperless.example.invalid${url.pathname}?page=${page + 1}` : null,
			previous: null,
			results
		};
	};

	const server = http.createServer((req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1');
		seen.push(`${url.pathname}${url.search}`);
		authHeaders.push(String(req.headers.authorization ?? ''));
		/** @param {number} status @param {unknown} body */
		const json = (status, body) => {
			res.writeHead(status, { 'content-type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		if (req.headers.authorization !== `Token ${FAKE_PAPERLESS_TOKEN}`) {
			return json(401, { detail: 'Invalid token.' });
		}
		if (url.pathname === '/api/tags/') return json(200, paged(TAGS, url));
		if (url.pathname === '/api/correspondents/') return json(200, paged(CORRESPONDENTS, url));
		if (url.pathname === '/api/document_types/') return json(200, paged(DOCUMENT_TYPES, url));
		if (url.pathname === '/api/documents/') {
			const after = url.searchParams.get('added__gt');
			const rows = documents
				.filter((d) => !after || Date.parse(d.added) > Date.parse(after))
				.map(({ original, archive, ...row }) => row);
			return json(200, paged(rows, url));
		}
		const m = /^\/api\/documents\/(\d+)\/download\/$/.exec(url.pathname);
		if (m) {
			const id = Number(m[1]);
			if (id === 98) {
				res.writeHead(302, { location: 'http://paperless.example.invalid/elsewhere' });
				return res.end();
			}
			if (id === 99) {
				res.writeHead(200, { 'content-type': 'application/pdf' });
				return res.end(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(15 * 1024 * 1024)]));
			}
			const doc = documents.find((d) => d.id === id);
			const bytes = !doc
				? null
				: url.searchParams.get('original') === 'true'
					? doc.original
					: (doc.archive ?? doc.original);
			if (!bytes) return json(404, { detail: 'Not found.' });
			res.writeHead(200, { 'content-type': 'application/octet-stream' });
			return res.end(bytes);
		}
		return json(404, { detail: 'Not found.' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
	return {
		url: `http://127.0.0.1:${port}`,
		seen,
		authHeaders,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}
