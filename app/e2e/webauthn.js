// Ported from Le-Space/simple-todo packages/e2e-kit (src/webauthn.mjs) at 56647d5.
// Changed: `forgetThisDevice` defaults to /robots.txt, which this app ships in
// static/; `addVirtualAuthenticator` skips the steps between prompts (#429)
// and `recordCeremonies` notes which credentials a request names.
//
/**
 * The passkey, as a test sees it: a virtual authenticator, and a count of how
 * often the page asks it for something.
 *
 * Every `navigator.credentials.create/get` is a prompt a person answers with a
 * touch or a fingerprint. How many a flow costs is a product decision the
 * chapters state in their copy ("in three touches"), so it is asserted, not
 * assumed — the count went from 2 to 5 unnoticed once already.
 */

/**
 * A platform-style authenticator with PRF, resident keys and user verification.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function addVirtualAuthenticator(page) {
	const cdp = await page.context().newCDPSession(page);
	await cdp.send('WebAuthn.enable');
	await cdp.send('WebAuthn.addVirtualAuthenticator', {
		options: {
			protocol: 'ctap2',
			ctap2Version: 'ctap2_1',
			transport: 'internal',
			hasResidentKey: true,
			hasUserVerification: true,
			isUserVerified: true,
			hasLargeBlob: true,
			hasPrf: true,
			automaticPresenceSimulation: true
		}
	});
	// No "Weiter" between the prompts of a create or restore (passkey-steps.svelte.js):
	// only e2e/passkey-steps.spec.js clicks through them, and switches this off.
	await page.addInitScript(() => {
		/** @type {any} */ (window).__belegeSkipPasskeySteps = true;
	});
	return cdp;
}

/**
 * Record every WebAuthn ceremony the page starts, from the first script on.
 *
 * @param {import('@playwright/test').Page} page
 */
export async function recordCeremonies(page) {
	await page.addInitScript(() => {
		/** @type {{ kind: string, prf: boolean, allow: number, name?: string, ok: boolean }[]} */
		const log = [];
		Object.defineProperty(window, '__webauthnCeremonies', { value: log });
		for (const kind of /** @type {const} */ (['create', 'get'])) {
			const original = navigator.credentials[kind].bind(navigator.credentials);
			navigator.credentials[kind] = async (/** @type {any} */ options) => {
				const entry = {
					kind,
					prf: Boolean(options?.publicKey?.extensions?.prf),
					// How many credentials the request names: 0 lets any passkey of the origin answer.
					allow: options?.publicKey?.allowCredentials?.length ?? 0,
					// What a picker lists for a new passkey (`user.name`).
					...(kind === 'create' ? { name: options?.publicKey?.user?.name } : {}),
					ok: false
				};
				log.push(entry);
				const result = await original(options);
				entry.ok = true;
				return result;
			};
		}
	});
}

/**
 * The ceremonies since the last call, and forget them.
 *
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{ kind: string, prf: boolean, allow: number, name?: string, ok: boolean }[]>}
 */
export async function takeCeremonies(page) {
	return page.evaluate(() => /** @type {any} */ (window).__webauthnCeremonies.splice(0));
}

/**
 * Everything this origin kept — localStorage, sessionStorage, every IndexedDB
 * database — gone, as on a device that has never been here.
 *
 * Done from a static page of the same origin, because the app holds its
 * databases open and a delete would wait for it.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} [staticPath] any same-origin page that is not the app
 */
export async function forgetThisDevice(page, staticPath = '/robots.txt') {
	await page.goto(staticPath);
	await page.evaluate(async () => {
		localStorage.clear();
		sessionStorage.clear();
		const databases = await indexedDB.databases();
		await Promise.all(
			databases.map(
				({ name }) =>
					new Promise((resolve, reject) => {
						if (!name) return resolve(undefined);
						const request = indexedDB.deleteDatabase(name);
						request.onsuccess = () => resolve(undefined);
						request.onerror = () => reject(request.error);
						request.onblocked = () => reject(new Error(`${name} is still open`));
					})
			)
		);
	});
}
