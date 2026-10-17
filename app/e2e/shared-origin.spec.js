// On a path-style IPFS gateway the page's origin is the gateway's, shared by
// every CID there: the app asks for no passkey, opens no books and keeps no
// service worker (shared-origin.js). The gateway is played by routing
// /ipfs/<cid>/… to the preview server's root.
import { test, expect } from '@playwright/test';
import { recordCeremonies, takeCeremonies } from './webauthn.js';
import { acceptConsent } from './consent.js';

const CID = 'bafybeiexamplecidforthetest';

test('under /ipfs/<cid>/ nothing opens, and it says where to', async ({ page, baseURL }) => {
	await page.route(`**/ipfs/${CID}/**`, async (route) => {
		const url = new URL(route.request().url());
		const path = url.pathname.slice(`/ipfs/${CID}`.length) || '/';
		const response = await route.fetch({ url: new URL(path, baseURL).href });
		await route.fulfill({ response });
	});
	await recordCeremonies(page);
	await page.goto(`/ipfs/${CID}/`);
	await acceptConsent(page);

	await expect(page.getByTestId('passkey-shared-origin')).toContainText(
		'deshalb öffnet Le Space Belege sie hier nicht'
	);
	await expect(page.getByTestId('passkey-shared-origin-link')).toHaveAttribute(
		'href',
		'https://belege.le-space.de/'
	);
	await expect(page.getByTestId('passkey-create')).toHaveCount(0);
	await expect(page.getByTestId('passkey-restore')).toHaveCount(0);
	expect(await takeCeremonies(page)).toEqual([]);
	// No worker on this origin.
	expect(
		await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)
	).toBe(0);
});
