// The bridge's portal endpoints (token required, checked by server.js before
// this is reached):
//
//   GET  /portals                               the portals and their session state
//   POST /portals/:id/login                     opens the visible window; returns when logged in
//   POST /portals/:id/cancel                    ends a waiting login
//   POST /portals/:id/fetch?since=YYYY-MM       { known: [invoice ids] } → lists, downloads new ones
//   GET  /portals/:id/invoice?ref=<invoice id>  the PDF's bytes, from the last fetch
//   POST /portals/:id/logout                    ends the session and deletes the profile

const ID = /^[a-z0-9-]{1,40}$/;
const INVOICE_ID = /^[A-Za-z0-9._-]{1,80}$/;

/**
 * @param {object} ctx
 * @param {import('node:http').IncomingMessage} ctx.req
 * @param {import('node:http').ServerResponse} ctx.res
 * @param {URL} ctx.url
 * @param {string} ctx.path
 * @param {import('./manager.js').PortalManager | null} ctx.portals
 * @param {(res: any, status: number, body: unknown) => void} ctx.send
 * @param {(res: any, bytes: Buffer, mime: string) => void} ctx.sendBytes
 * @param {(req: any, limit?: number) => Promise<any>} ctx.readJson
 * @returns {Promise<boolean>} whether the path was a portal path
 */
export async function handlePortalRequest({
	req,
	res,
	url,
	path,
	portals,
	send,
	sendBytes,
	readJson
}) {
	if (path !== '/portals' && !path.startsWith('/portals/')) return false;
	if (!portals) {
		send(res, 503, { error: 'Portals are not available on this bridge.', code: 'PORTALS_OFF' });
		return true;
	}
	if (path === '/portals' && req.method === 'GET') {
		send(res, 200, { portals: await portals.list() });
		return true;
	}
	const m = /^\/portals\/([^/]+)\/(login|cancel|fetch|invoice|logout)$/.exec(path);
	if (!m || !ID.test(m[1])) {
		send(res, 404, { error: 'not found' });
		return true;
	}
	const [, id, action] = m;
	const method = action === 'invoice' ? 'GET' : 'POST';
	if (req.method !== method) {
		send(res, 405, { error: `${method} only` });
		return true;
	}

	if (action === 'login') {
		send(res, 200, await portals.login(id));
	} else if (action === 'cancel') {
		send(res, 200, portals.cancel(id));
	} else if (action === 'logout') {
		send(res, 200, await portals.logout(id));
	} else if (action === 'fetch') {
		const since = url.searchParams.get('since') ?? '';
		if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(since)) {
			send(res, 400, { error: 'since must be YYYY-MM' });
			return true;
		}
		const body = await readJson(req, 64 * 1024);
		const known = Array.isArray(body?.known)
			? body.known
					.filter((/** @type {unknown} */ k) => typeof k === 'string' && INVOICE_ID.test(k))
					.slice(0, 1000)
			: [];
		send(res, 200, await portals.fetch(id, { since, known }));
	} else {
		const ref = url.searchParams.get('ref') ?? '';
		if (!INVOICE_ID.test(ref)) {
			send(res, 400, { error: 'ref is not an invoice id' });
			return true;
		}
		sendBytes(res, await portals.invoice(id, ref), 'application/pdf');
	}
	return true;
}
