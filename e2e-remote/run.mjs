// Run the collaboration scenario: the owner in a local Chromium, the
// bookkeeping in a second local Chromium (REMOTE_PROVIDER=local) or on an
// Aleph VM (REMOTE_PROVIDER=aleph, set up by .github/workflows/remote-collaboration.yml).
//
//   REMOTE_APP_URL        the deployed app (default https://belege.le-space.de)
//   REMOTE_PROVIDER       aleph | local (default local)
//   REMOTE_OUTPUT_DIR     evidence (default test-results/remote-collab)
//   REQUIRE_PUBLIC_RELAY  'true': fail when the network menu shows no public relay
import { appendFile } from 'node:fs/promises';
import { createAlephBrowser, createLocalBrowser, PLAYWRIGHT_VERSION } from './providers.mjs';
import { runCollaboration } from './scenario.mjs';

const appUrl = process.env.REMOTE_APP_URL || 'https://belege.le-space.de';
const provider = process.env.REMOTE_PROVIDER || 'local';
const outputDir = process.env.REMOTE_OUTPUT_DIR || 'test-results/remote-collab';
const requirePublicRelay = process.env.REQUIRE_PUBLIC_RELAY === 'true';

const runUrl = process.env.GITHUB_RUN_ID
	? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
	: null;

/** @param {string} text */
async function summary(text) {
	if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, text);
}

const browserA = await createLocalBrowser();
/** @type {import('playwright').Browser | undefined} */
let browserB;
try {
	if (provider === 'aleph') {
		browserB = await createAlephBrowser({
			wsEndpoint: process.env.ALEPH_PLAYWRIGHT_WS_ENDPOINT,
			versionUrl: process.env.ALEPH_PLAYWRIGHT_VERSION_URL,
			secret: process.env.ALEPH_PLAYWRIGHT_SECRET
		});
	} else if (provider === 'local') {
		browserB = await createLocalBrowser();
	} else {
		throw new Error(`Unknown REMOTE_PROVIDER "${provider}": aleph or local.`);
	}
} catch (error) {
	await browserA.close();
	await summary(
		`## Collaboration over the internet\n\n**Result:** failed before the scenario\n\n**Reason:** ${error instanceof Error ? error.message : String(error)}\n`
	);
	throw error;
}

const providerEvidence =
	provider === 'aleph'
		? {
				instanceHash: process.env.ALEPH_PLAYWRIGHT_INSTANCE_HASH ?? null,
				crnHash: process.env.ALEPH_PLAYWRIGHT_CRN_HASH ?? null,
				crnName: process.env.ALEPH_PLAYWRIGHT_CRN_NAME ?? null,
				playwrightVersion: PLAYWRIGHT_VERSION,
				browserVersion: browserB.version()
			}
		: { browserVersion: browserB.version() };

try {
	const result = await runCollaboration({
		browserA,
		browserB,
		appUrl,
		outputDir,
		provider,
		providerEvidence,
		requirePublicRelay
	});
	console.log(JSON.stringify(result, null, 2));
	const relays = (/** @type {any} */ status) =>
		(status?.lights ?? [])
			.map((/** @type {any} */ l) => `${l.kind}: ${l.state}${l.relays ? ` (${l.relays})` : ''}`)
			.join('; ') || 'no relay light in this build';
	await summary(
		'## Collaboration over the internet\n\n' +
			'**Result:** passed\n\n' +
			`App: ${appUrl} (${result.release.owner || 'release unknown'})\n\n` +
			'| | Owner | Bookkeeping |\n| --- | --- | --- |\n' +
			`| Browser | local Chromium on the runner | ${provider === 'aleph' ? 'Chromium on an Aleph VM' : 'second local Chromium'} |\n` +
			`| Fingerprint | \`${result.fingerprint.owner}\` | \`${result.fingerprint.bookkeeping}\` |\n` +
			`| Relay | ${relays(result.relay.owner)} | ${relays(result.relay.bookkeeping)} |\n` +
			`| Device | \`${result.devices.owner.self}\` | \`${result.devices.bookkeeping.self}\` |\n` +
			`| Owner → bookkeeping | ${result.replication.ownerToBookkeepingMs} ms after the unlock | arrived |\n` +
			`| Bookkeeping → owner | arrived | ${result.replication.bookkeepingToOwnerMs} ms |\n\n` +
			(runUrl ? `Screenshots and result.json: [artifacts](${runUrl}#artifacts)\n` : '') +
			(provider === 'aleph'
				? `\nAleph INSTANCE \`${providerEvidence.instanceHash ?? 'unknown'}\` on CRN \`${providerEvidence.crnName ?? providerEvidence.crnHash ?? 'unknown'}\`, Playwright ${PLAYWRIGHT_VERSION}\n`
				: '')
	);
} catch (error) {
	const result = /** @type {any} */ (error)?.result;
	await summary(
		'## Collaboration over the internet\n\n' +
			'**Result:** failed\n\n' +
			`**Stage:** ${result?.stage ?? 'unknown'}\n\n` +
			`**Reason:** ${result?.error ?? (error instanceof Error ? error.message : String(error))}\n\n` +
			'Screenshots, result.json and what each page showed are in the artifact.\n'
	);
	process.exitCode = 1;
} finally {
	await Promise.allSettled([browserA.close(), browserB.close()]);
}
