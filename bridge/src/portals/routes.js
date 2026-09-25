// The bridge's portal endpoints (token required, checked by server.js before
// this is reached):
//
//   GET  /portals                               the portals and their session state
//   POST /portals/:id/login                     opens the visible window; returns when logged in
//   POST /portals/:id/cancel                    ends a waiting login
//   POST /portals/:id/fetch?since=YYYY-MM       { known: [invoice ids] } → lists, downloads new ones
//   GET  /portals/:id/invoice?ref=<invoice id>  the PDF's bytes, from the last fetch
//   POST /portals/:id/logout                    ends the session and deletes the profile
//   POST /portals/:id/record/start              "Portal aufzeichnen": opens the window on the start page
//   POST /portals/:id/record/stop               ends it; the steps for review (roles, labels, masked paths)
//   POST /portals/:id/record/save  { hosts }    the recording becomes the portal's recipe override;
//                                               hosts: the other hosts the user confirmed
//   POST /portals/:id/record/discard            drops the recording
//   GET  /portals/:id/recipe/export             the saved override, as JSON for sharing
//   POST /portals/:id/credentials  { username } "Zugangsdaten speichern": the password is asked
//                                               for in a native dialog on the bridge's Mac
//   DELETE /portals/:id/credentials             "Zugangsdaten löschen"
//   POST /portals/new  { name, startUrl }       "Neues Portal aufzeichnen": a local portal, recording
//   POST /portals/:id/remove                    "Portal entfernen": a local portal's recipe, profile, credentials

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
	if (path === '/portals/new') {
		if (req.method !== 'POST') {
			send(res, 405, { error: 'POST only' });
			return true;
		}
		const body = await readJson(req, 4096);
		send(res, 200, await portals.recordNew({ name: body?.name, startUrl: body?.startUrl }));
		return true;
	}
	const m =
		/^\/portals\/([^/]+)\/(login|cancel|fetch|invoice|logout|record\/(?:start|stop|save|discard)|recipe\/export|credentials|remove)$/.exec(
			path
		);
	if (!m || !ID.test(m[1])) {
		send(res, 404, { error: 'not found' });
		return true;
	}
	const [, id, action] = m;
	const methods =
		action === 'invoice' || action === 'recipe/export'
			? ['GET']
			: action === 'credentials'
				? ['POST', 'DELETE']
				: ['POST'];
	if (!methods.includes(String(req.method))) {
		send(res, 405, { error: `${methods.join(' or ')} only` });
		return true;
	}

	if (action === 'login') {
		send(res, 200, await portals.login(id));
	} else if (action === 'cancel') {
		send(res, 200, portals.cancel(id));
	} else if (action === 'logout') {
		send(res, 200, await portals.logout(id));
	} else if (action === 'record/start') {
		send(res, 200, await portals.recordStart(id));
	} else if (action === 'record/stop') {
		send(res, 200, await portals.recordStop(id));
	} else if (action === 'record/save') {
		const body = await readJson(req, 4096);
		send(res, 200, await portals.recordSave(id, { hosts: body?.hosts }));
	} else if (action === 'remove') {
		send(res, 200, await portals.remove(id));
	} else if (action === 'record/discard') {
		send(res, 200, await portals.recordDiscard(id));
	} else if (action === 'credentials') {
		if (req.method === 'DELETE') {
			send(res, 200, await portals.deleteCredentials(id));
		} else {
			// The user name only; a password in the body is not read.
			const body = await readJson(req, 4096);
			send(res, 200, await portals.saveCredentials(id, { username: body?.username }));
		}
	} else if (action === 'recipe/export') {
		send(res, 200, portals.recipeExport(id));
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
