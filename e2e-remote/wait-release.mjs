// Wait until the deployed app serves a release: the footer names it.
//
// After deploy.yml links the domain, the gateway can serve the previous
// build for some minutes. The remote run waits here, with a local browser and
// before any VM is paid for, so it tests the release it was started for.
//
//   REMOTE_APP_URL   default https://belege.le-space.de
//   EXPECT_RELEASE   e.g. v0.28.0 (required)
//   WAIT_MINUTES     default 20
import { chromium } from 'playwright';

const appUrl = process.env.REMOTE_APP_URL || 'https://belege.le-space.de';
const expected = (process.env.EXPECT_RELEASE || '').trim();
const minutes = Number(process.env.WAIT_MINUTES || 20);
if (!/^v\d+\.\d+\.\d+$/.test(expected)) throw new Error('EXPECT_RELEASE must be vX.Y.Z');

const browser = await chromium.launch({ headless: true });
const deadline = Date.now() + minutes * 60_000;
let seen = '';
let served = false;
try {
	while (Date.now() < deadline) {
		// A fresh context each time: no service worker holding an older build.
		const context = await browser.newContext();
		const page = await context.newPage();
		try {
			await page.goto(appUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 });
			const footer = page.getByTestId('release');
			await footer.waitFor({ state: 'attached', timeout: 30_000 });
			seen = ((await footer.textContent()) ?? '').trim();
		} catch (error) {
			seen = `unreadable (${error instanceof Error ? error.message.split('\n')[0] : error})`;
		} finally {
			await context.close();
		}
		console.log(
			`[wait-release ${new Date().toISOString()}] ${appUrl} serves ${seen || 'no release'}`
		);
		if (seen === expected) {
			served = true;
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 30_000));
	}
	if (!served)
		throw new Error(
			`${appUrl} still serves ${seen || 'no release'} after ${minutes} min, not ${expected}`
		);
} finally {
	await browser.close();
}
