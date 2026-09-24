// A tiny HTTP client that may set Host and Origin, which fetch() will not.
import http from 'node:http';

/**
 * @param {number} port
 * @param {string} path
 * @param {{ method?: string, headers?: Record<string, string>, body?: unknown }} [options]
 * @returns {Promise<{ status: number, headers: import('node:http').IncomingHttpHeaders, json: any, text: string }>}
 */
export function request(port, path, { method = 'GET', headers = {}, body } = {}) {
	const payload = body === undefined ? undefined : JSON.stringify(body);
	return new Promise((resolve, reject) => {
		const req = http.request(
			{
				host: '127.0.0.1',
				port,
				path,
				method,
				headers: {
					host: `127.0.0.1:${port}`,
					...(payload
						? {
								'content-type': 'application/json',
								'content-length': String(Buffer.byteLength(payload))
							}
						: {}),
					...headers
				}
			},
			(res) => {
				let text = '';
				res.setEncoding('utf8');
				res.on('data', (d) => (text += d));
				res.on('end', () => {
					let json = null;
					try {
						json = text ? JSON.parse(text) : null;
					} catch {}
					resolve({ status: res.statusCode ?? 0, headers: res.headers, json, text });
				});
			}
		);
		req.on('error', reject);
		req.end(payload);
	});
}
