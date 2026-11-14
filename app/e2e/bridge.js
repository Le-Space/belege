// Pairing the bridge in a spec, by either way the app offers (#575):
//
//   http   (default) – the pairing code over HTTP, and every later call over
//                      HTTP on 127.0.0.1, as before the bridge had a node.
//   stream (E2E_BRIDGE_VIA=stream) – the bridge's own node: device sync is on
//                      from the start (playwright.config.js), every HTTP
//                      request from the page to the bridge is refused except
//                      `/pair`, and the device pairs by the invitation the
//                      bridge printed. From then on every call has to go over
//                      the stream – which is what this mode proves.
//
// `npm run test:e2e:stream` runs the bridge specs this way (BRIDGE_SPECS);
// CI runs them both ways. A spec that tests HTTP's own pairing (the code,
// the token, unpairing it) skips itself in stream mode with `httpOnly`.
import { expect, test } from '@playwright/test';

export const BRIDGE_VIA = process.env.E2E_BRIDGE_VIA === 'stream' ? 'stream' : 'http';
export const viaStream = BRIDGE_VIA === 'stream';

/** The specs that pair a bridge: what stream mode runs (playwright.config.js). */
export const BRIDGE_SPECS = [
	'akash-statement',
	'aleph',
	'appointments',
	'backup',
	'backup-restore',
	'bank-import',
	'books-identity',
	'bridge-blocks',
	'bridge-node',
	'bridge-scopes',
	'enablebanking',
	'export',
	'filecoin-swap',
	'filecoin-wallet',
	'instalments-currency',
	'llm-refusal',
	'match-foreign-currency',
	'matching',
	'monero',
	'outlay-rates',
	'paperless',
	'portal',
	'receipts',
	'transfer-first',
	'travel-mail',
	'travel-review',
	'travel-rates',
	'travel-reread',
	'upload-to-booking',
	'wallets',
	'wallets-alchemy'
];

/**
 * A spec (or a part of one) about HTTP's own pairing: skipped in stream mode.
 *
 * @param {string} why
 */
export function httpOnly(why) {
	test.skip(viaStream, `HTTP only: ${why}`);
}

/**
 * Pair this page with the spec's bridge, the way BRIDGE_VIA says.
 *
 * @param {import('@playwright/test').Page} page
 * @param {object} p
 * @param {string | (() => string)} p.code the pairing code (http)
 * @param {() => string} p.out what the bridge printed (stream: its invitation)
 * @param {number} [p.port] the bridge's HTTP port
 */
export async function pairBridge(page, { code, out, port = Number(process.env.E2E_BRIDGE_PORT) }) {
	if (!viaStream) {
		await page.getByTestId('pairing-code').fill(typeof code === 'function' ? code() : code);
		await page.getByRole('button', { name: 'Koppeln', exact: true }).click();
		await expect(page.getByTestId('bridge-status')).toContainText('dieses Gerät ist gekoppelt');
		return;
	}
	/** @type {string[]} */
	const refused = [];
	await page.context().route(`http://127.0.0.1:${port}/**`, (route) => {
		const path = new URL(route.request().url()).pathname;
		if (path === '/pair') return route.fallback();
		refused.push(path);
		return route.abort('connectionrefused');
	});
	test.info().annotations.push({ type: 'bridge', description: 'over the stream, HTTP refused' });
	const invitation = /(web\+ucep:pair\?\S+)/.exec(out())?.[1];
	if (!invitation) throw new Error(`no invitation in the bridge output:\n${out()}`);
	// Device sync must be online before the invitation form shows.
	await expect(page.getByTestId('bridge-invitation')).toBeVisible({ timeout: 60_000 });
	await page.getByTestId('bridge-invitation').fill(invitation);
	await page.getByTestId('bridge-pair-invitation').click();
	await expectPaired(page);
}

/**
 * The Bridge card says this device is paired, the way BRIDGE_VIA says: by its
 * text over HTTP; over the stream online by the bridge's node ("Status prüfen"
 * asks again until the node is connected and proved, as after an unlock).
 *
 * @param {import('@playwright/test').Page} page on a page with the Bridge card
 */
export async function expectPaired(page) {
	const status = page.getByTestId('bridge-status');
	if (!viaStream) {
		await expect(status).toContainText('dieses Gerät ist gekoppelt');
		return;
	}
	await expect
		.poll(
			async () => {
				const error = page.getByTestId('bridge-error');
				if (await error.isVisible()) {
					throw new Error(`the bridge over the stream: ${await error.textContent()}`);
				}
				const route = `${await status.getAttribute('data-paired')}/${await status.getAttribute('data-state')}/${await status.getAttribute('data-route')}`;
				if (route.startsWith('true/') && route !== 'true/online/stream') {
					await page.getByTestId('bridge-check').click();
				}
				return route;
			},
			{ timeout: 120_000, intervals: [1_000, 2_000] }
		)
		.toBe('true/online/stream');
}
