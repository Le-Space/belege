// A fake Hibiscus for tests: HTTPS with a self-signed certificate made on the
// spot, XML-RPC `konto.find` and `umsatz.list`, basic auth with a test
// password. Every request is recorded, so a test can prove that nothing (and
// no password) reached it.
//
// All data here is synthetic: IBANs with check digits 00, made-up names.

import https from 'node:https';
import { X509Certificate } from 'node:crypto';
import { generate } from 'selfsigned';

import { decodeCall, encodeValue } from '../../src/xmlrpc.js';

export const FAKE_PASSWORD = 'fake-master-password-for-tests';

/** Two accounts; only the first ends in the suffix the tests allow (`4711`). */
export function sampleData() {
	return {
		accounts: [
			{
				id: 1,
				iban: 'DE00 0000 0000 0000 0047 11',
				bezeichnung: 'Geschäftskonto Test',
				name: 'Test GmbH',
				waehrung: 'EUR',
				saldo: '1.234,56',
				saldo_datum: '2026-09-22'
			},
			{
				id: 2,
				iban: 'DE00 0000 0000 0000 0099 99',
				bezeichnung: 'Privatkonto Geheim',
				name: 'Privatperson Geheimname',
				waehrung: 'EUR',
				saldo: '99999.99',
				saldo_datum: '2026-09-22'
			}
		],
		transactions: [
			{
				id: 101,
				konto_id: 1,
				datum: '2026-09-22',
				valuta: '2026-09-22',
				betrag: '-22,42',
				empfaenger_name: 'Kaffeerösterei Nordlicht GmbH',
				empfaenger_konto: 'DE00000000000000001234',
				zweck: 'Rechnung KR-2026-0917',
				zweck_raw: 'EREF+KR20260917 MREF+M-77 CRED+DE00ZZZ00000000001 SVWZ+Rechnung KR-2026-0917',
				art: 'Basislastschrift',
				endtoendid: 'KR20260917'
			},
			{
				id: 102,
				konto_id: 1,
				datum: '2026-09-22',
				valuta: '2026-09-23',
				betrag: '1439.76',
				empfaenger_name: 'Kundin Beispiel AG',
				empfaenger_konto: 'DE00000000000000005678',
				zweck: 'Rechnung 2026-004',
				zweck_raw: 'SVWZ+Rechnung 2026-004 IBAN+DE00000000000000005678',
				art: 'Gutschrift',
				endtoendid: 'NOTPROVIDED'
			},
			{
				id: 103,
				konto_id: 1,
				datum: '2026-08-14',
				valuta: '2026-08-14',
				betrag: '-7,47',
				empfaenger_name: 'Softwareabo Muster Ltd',
				empfaenger_konto: '',
				zweck: 'Abo August',
				zweck_raw: 'EREF+ABO-0814 SVWZ+Abo August IBAN+IE00ABCD00000000000001',
				art: 'Basislastschrift',
				endtoendid: ''
			},
			{
				id: 201,
				konto_id: 2,
				datum: '2026-09-20',
				valuta: '2026-09-20',
				betrag: '-50,00',
				empfaenger_name: 'Privater Empfänger Geheim',
				empfaenger_konto: 'DE00000000000000009999',
				zweck: 'Privat',
				zweck_raw: 'SVWZ+Privat',
				art: 'Überweisung',
				endtoendid: ''
			}
		]
	};
}

/**
 * @param {object} [options]
 * @param {ReturnType<typeof sampleData>} [options.data]
 * @param {string} [options.password]
 * @param {number} [options.port] 0 = any free port
 */
export async function startFakeHibiscus({
	data = sampleData(),
	password = FAKE_PASSWORD,
	port = 0
} = {}) {
	const pems = await generate([{ name: 'commonName', value: 'jameica-fake' }], {
		keySize: 2048,
		days: 2,
		algorithm: 'sha256'
	});
	const fingerprint = new X509Certificate(pems.cert).fingerprint256;

	/** @type {{ method: string | null, authorized: boolean, sawPassword: boolean, params: unknown[] }[]} */
	const requests = [];

	const server = https.createServer({ key: pems.private, cert: pems.cert }, (req, res) => {
		let body = '';
		req.setEncoding('utf8');
		req.on('data', (d) => (body += d));
		req.on('end', () => {
			const auth = String(req.headers.authorization ?? '');
			const decoded = auth.startsWith('Basic ')
				? Buffer.from(auth.slice(6), 'base64').toString('utf8')
				: '';
			const authorized = decoded.split(':').slice(1).join(':') === password;
			/** @type {{ method: string, params: unknown[] } | null} */
			let call = null;
			try {
				call = decodeCall(body);
			} catch {}
			requests.push({
				method: call?.method ?? null,
				authorized,
				sawPassword: decoded.includes(password),
				params: call?.params ?? []
			});

			if (!authorized) {
				res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Jameica"' });
				return res.end();
			}
			/** @type {unknown} */ let result;
			if (call?.method === 'hibiscus.xmlrpc.konto.find') {
				result = data.accounts;
			} else if (call?.method === 'hibiscus.xmlrpc.umsatz.list') {
				const q = /** @type {Record<string, string>} */ (call.params[0] ?? {});
				result = data.transactions.filter(
					(t) =>
						String(t.konto_id) === String(q.konto_id) &&
						(!q['datum:min'] || t.datum >= q['datum:min'])
				);
			} else {
				const fault = `<?xml version="1.0"?><methodResponse><fault>${encodeValue({ faultCode: 1, faultString: 'no such method' })}</fault></methodResponse>`;
				res.writeHead(200, { 'Content-Type': 'text/xml' });
				return res.end(fault);
			}
			res.writeHead(200, { 'Content-Type': 'text/xml' });
			res.end(
				`<?xml version="1.0"?><methodResponse><params><param>${encodeValue(result)}</param></params></methodResponse>`
			);
		});
	});

	await new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(undefined)));
	const address = /** @type {import('node:net').AddressInfo} */ (server.address());

	return {
		host: '127.0.0.1',
		port: address.port,
		fingerprint,
		requests,
		data,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections();
			})
	};
}
