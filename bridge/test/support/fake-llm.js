// A fake OpenAI-compatible chat API for tests, on 127.0.0.1. It records every
// request (so a test can prove what left the bridge) and answers by reading
// the labelled lines of a synthetic invoice (fake-imap.js `invoiceLines`)
// back out of the text it was sent – so the answer depends on the text that
// really arrived.
//
// `behaviour[model]` scripts a model: 'ok' (default), 'length' (reasoning ran
// out of tokens), 'invalid' (net + VAT ≠ gross), 'garbage' (no JSON),
// 'http500', 'http401'. `answers.respond(body)` may answer other questions
// (the mail assist): whatever it returns is the answer, undefined = invoice.

import http from 'node:http';

export const FAKE_LLM_KEY = 'sk-fake-llm-key-for-tests';

/** `119,00` / `1.190,00` → 119 / 1190 */
const num = (/** @type {string | undefined} */ s) =>
	s === undefined ? null : Number(s.replace(/\./g, '').replace(',', '.'));

/**
 * @param {string} text the user message
 */
export function readInvoice(text) {
	/** @param {RegExp} re */
	const get = (re) => re.exec(text)?.[1]?.trim();
	const vendor =
		get(/Anbieter:\s*([^\n]+?)(?=\s+Rechnungsnummer:|\n|$)/) ??
		get(/Absender der E-Mail:\s*"?([^"<\n]+)/) ??
		'Unbekannt';
	const gross = num(get(/Brutto:\s*(-?[\d.,]+)/) ?? get(/Summe:\s*(-?[\d.,]+)/));
	const net = num(get(/Netto:\s*(-?[\d.,]+)/));
	const vat = num(get(/USt 19%:\s*(-?[\d.,]+)/));
	return {
		document_type: 'invoice',
		vendor,
		vendor_vat_id: null,
		invoice_number: get(/Rechnungsnummer:\s*(\S+)/) ?? null,
		customer_number: null,
		invoice_date: get(/Rechnungsdatum:\s*(\d{4}-\d{2}-\d{2})/) ?? null,
		due_or_debit_date: null,
		service_period: null,
		currency: 'EUR',
		net,
		vat: vat === null ? [] : [{ rate: 19, amount: vat }],
		gross,
		payment: null,
		iban_last4: get(/\[IBAN …(\w{4})\]/) ?? null,
		reverse_charge: false,
		travel: null,
		summary: 'Testleistung'
	};
}

/**
 * @param {{ behaviour?: Record<string, string>, key?: string }} [options]
 */
export async function startFakeLlm({ behaviour = {}, key = FAKE_LLM_KEY } = {}) {
	/** @type {{ model: string, authorized: boolean, body: any, raw: string }[]} */
	const requests = [];
	/** @type {{ respond?: (body: any) => any }} */
	const answers = {};
	const server = http.createServer((req, res) => {
		let raw = '';
		req.setEncoding('utf8');
		req.on('data', (d) => (raw += d));
		req.on('end', () => {
			/** @param {number} status @param {unknown} body */
			const send = (status, body) => {
				const text = JSON.stringify(body);
				res.writeHead(status, { 'Content-Type': 'application/json' });
				res.end(text);
			};
			if (req.method !== 'POST' || req.url !== '/chat/completions') return send(404, {});
			/** @type {any} */
			let body = {};
			try {
				body = JSON.parse(raw);
			} catch {}
			const authorized = req.headers.authorization === `Bearer ${key}`;
			requests.push({ model: body.model, authorized, body, raw });
			if (!authorized) return send(401, { error: { message: 'bad key' } });
			const mode = behaviour[body.model] ?? 'ok';
			if (mode === 'http500') return send(500, { error: { message: 'down' } });
			if (mode === 'http401') return send(401, { error: { message: 'bad key' } });
			const user = body.messages?.find((/** @type {any} */ m) => m.role === 'user')?.content ?? '';
			const custom = answers.respond?.(body);
			const data = custom ?? readInvoice(user);
			if (mode === 'invalid') data.gross = (data.gross ?? 0) + 5;
			const usage = {
				prompt_tokens: Math.ceil(user.length / 4),
				completion_tokens: 321,
				completion_tokens_details: { reasoning_tokens: 200 }
			};
			if (mode === 'length') {
				return send(200, {
					choices: [{ finish_reason: 'length', message: { content: '' } }],
					usage
				});
			}
			send(200, {
				model: body.model,
				choices: [
					{
						finish_reason: 'stop',
						message: {
							content: mode === 'garbage' ? 'Sure! Here is the data:' : JSON.stringify(data)
						}
					}
				],
				usage
			});
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		requests,
		behaviour,
		answers,
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}
