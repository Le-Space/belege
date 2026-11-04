// The owner and the bookkeeping, in two browsers that are really apart (#625).
//
//   1. Both make a passkey with device sync switched on in the consent screen.
//   2. The owner enters a booking (a made-up statement file).
//   3. The bookkeeping makes a join code; the owner admits it and answers; the
//      bookkeeping enters the answer. Both pages show the same fingerprint.
//   4. The bookkeeping opens the books as a member, both at a public relay.
//   5. The owner's booking shows on the bookkeeping's side; the bookkeeping's
//      shows on the owner's. Both directions timed.
//   6. Screenshots and result.json.
//
// Every name and amount is made up; the screenshots show nothing else.
import { mkdir, writeFile } from 'node:fs/promises';
import { BelegeAgent, progress } from './agent.mjs';
import { madeUpStatement } from './statement.mjs';

const BOOKS = 'Wolkenfabrik Hosting GmbH';
const MEMBER = 'Buchhaltung Test';
const FINGERPRINT = /[0-9A-F]{4}(?:-[0-9A-F]{4}){3}/;

/**
 * @param {{
 *   browserA: import('playwright').Browser,
 *   browserB: import('playwright').Browser,
 *   appUrl: string,
 *   outputDir: string,
 *   provider?: string,
 *   providerEvidence?: Record<string, unknown>,
 *   requirePublicRelay?: boolean,
 *   replicationTimeout?: number
 * }} options
 */
export async function runCollaboration({
	browserA,
	browserB,
	appUrl,
	outputDir,
	provider = 'local',
	providerEvidence = {},
	requirePublicRelay = false,
	replicationTimeout = 180_000
}) {
	const runId = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
	const owner = new BelegeAgent({ name: 'owner (runner)', browser: browserA, appUrl });
	const keeper = new BelegeAgent({ name: `bookkeeping (${provider})`, browser: browserB, appUrl });
	const fromOwner = {
		counterparty: 'Wolkenfabrik Hosting GmbH',
		purpose: `Hosting ${runId}`,
		amount: '12.34'
	};
	const fromKeeper = {
		counterparty: 'Stromwerk Test AG',
		purpose: `Strom ${runId}`,
		amount: '56.78'
	};
	/** @type {Record<string, any>} */
	const result = {
		runId,
		appUrl,
		provider: { name: provider, ...providerEvidence },
		startedAt: new Date().toISOString(),
		stage: 'starting',
		release: {},
		fingerprint: {},
		relay: {},
		replication: {},
		devices: {},
		screenshots: [],
		passed: false
	};
	/** @param {string} stage */
	const stage = (stage) => {
		result.stage = stage;
		progress(`stage: ${stage}`);
	};
	/** @param {string} name */
	const shoot = async (name) => {
		await Promise.allSettled([
			owner.screenshot(`${outputDir}/${name}-owner.png`),
			keeper.screenshot(`${outputDir}/${name}-bookkeeping.png`)
		]);
		result.screenshots.push(`${name}-owner.png`, `${name}-bookkeeping.png`);
	};

	await mkdir(outputDir, { recursive: true });
	try {
		stage('opening');
		await Promise.all([owner.open(), keeper.open()]);
		result.release = { owner: owner.facts.release, bookkeeping: keeper.facts.release };

		stage('passkeys-and-device-sync');
		await Promise.all([owner.acceptConsentWithDevices(), keeper.acceptConsentWithDevices()]);
		await Promise.all([
			owner.createPasskey('Remote Inhaber'),
			keeper.createPasskey('Remote Buchhaltung')
		]);

		stage('owner-at-relay');
		result.relay.ownerBefore = await owner.waitForPublicRelay({ require: requirePublicRelay });

		stage('owner-enters-booking');
		const ownerImport = await owner.importStatement(
			madeUpStatement({
				runId,
				iban: 'DE00000000000000001111',
				owner: BOOKS,
				...fromOwner
			})
		);
		progress(`owner imported: ${ownerImport}`);
		await owner.waitForBooking(fromOwner.counterparty, 30_000);

		stage('bookkeeping-makes-join-code');
		await keeper.openIntegration('zusammenarbeit');
		const kp = /** @type {import('playwright').Page} */ (keeper.page);
		await kp.getByTestId('member-join-name').fill(MEMBER);
		await kp.getByTestId('member-join-button').click();
		const codeBox = kp.getByTestId('member-join-code');
		await codeBox.waitFor({ state: 'visible', timeout: 60_000 });
		// What the bookkeeping would send by mail or chat.
		const code = await codeBox.inputValue();
		if (!code.startsWith('belege-join:')) throw new Error('the join code has an unknown form');
		const keeperCheck = (await kp.getByTestId('member-join-check').textContent()) ?? '';
		result.fingerprint.bookkeeping = FINGERPRINT.exec(keeperCheck)?.[0] ?? null;
		if (!result.fingerprint.bookkeeping) throw new Error('the join code shows no fingerprint');

		stage('owner-admits');
		await owner.openIntegration('zusammenarbeit');
		const op = /** @type {import('playwright').Page} */ (owner.page);
		await op.getByTestId('member-admit-name').fill(MEMBER);
		await op.getByTestId('member-admit-books').fill(BOOKS);
		await op.getByTestId('member-admit-code').fill(code);
		await op.getByTestId('member-admit-button').click();
		const answerBox = op.getByTestId('member-answer');
		await answerBox.waitFor({ state: 'visible', timeout: 60_000 });
		const answer = await answerBox.inputValue();
		if (!answer.startsWith('belege-member:')) throw new Error('the answer has an unknown form');
		const ownerCheck = (await op.getByTestId('member-admitted').textContent()) ?? '';
		result.fingerprint.owner = FINGERPRINT.exec(ownerCheck)?.[0] ?? null;
		result.fingerprint.same = result.fingerprint.owner === result.fingerprint.bookkeeping;
		if (!result.fingerprint.same) {
			throw new Error(
				`the pages show different fingerprints: owner ${result.fingerprint.owner}, bookkeeping ${result.fingerprint.bookkeeping}`
			);
		}

		stage('bookkeeping-enters-answer');
		await kp.getByTestId('member-join-answer').fill(answer);
		await kp.getByTestId('member-join-finish').click();
		const joined = kp.getByTestId('member-joined');
		await joined.waitFor({ state: 'visible', timeout: 60_000 });
		if (!((await joined.textContent()) ?? '').includes(BOOKS)) {
			throw new Error('the bookkeeping joined, but not the books the owner named');
		}
		await shoot('joined');

		stage('bookkeeping-opens-member-books');
		await keeper.reloadAndUnlock({ member: true });
		const memberBooks = (await kp.getByTestId('member-books').textContent()) ?? '';
		if (!memberBooks.includes(BOOKS)) throw new Error(`the header says "${memberBooks.trim()}"`);
		const opened = Date.now();

		stage('bookkeeping-at-relay');
		result.relay.bookkeeping = await keeper.waitForPublicRelay({ require: requirePublicRelay });
		result.relay.owner = await owner.waitForPublicRelay({ require: requirePublicRelay });

		stage('owner-to-bookkeeping');
		await keeper.waitForBooking(fromOwner.counterparty, replicationTimeout);
		result.replication.ownerToBookkeepingMs = Date.now() - opened;
		progress(`owner → bookkeeping: ${result.replication.ownerToBookkeepingMs} ms after unlock`);

		stage('bookkeeping-enters-booking');
		const keeperImport = await keeper.importStatement(
			madeUpStatement({
				runId,
				iban: 'DE00000000000000002222',
				owner: BOOKS,
				...fromKeeper
			})
		);
		progress(`bookkeeping imported: ${keeperImport}`);
		const written = Date.now();

		stage('bookkeeping-to-owner');
		await owner.waitForBooking(fromKeeper.counterparty, replicationTimeout);
		result.replication.bookkeepingToOwnerMs = Date.now() - written;
		progress(`bookkeeping → owner: ${result.replication.bookkeepingToOwnerMs} ms`);
		await shoot('replicated');

		stage('devices');
		result.devices.owner = await owner.devices();
		result.devices.bookkeeping = await keeper.devices();
		// The owner's list names the bookkeeping's device: the two met in the
		// same books (the database addresses themselves are not on any page).
		const keeperId = result.devices.bookkeeping.self;
		result.devices.ownerListsBookkeeping = result.devices.owner.devices.some(
			(/** @type {{ peerId: string | null }} */ d) => d.peerId && d.peerId === keeperId
		);
		if (!result.devices.ownerListsBookkeeping) {
			throw new Error(`the owner's Eigene Geräte do not list the bookkeeping's device ${keeperId}`);
		}
		await shoot('devices');

		result.passed = true;
		stage('completed');
		return result;
	} catch (error) {
		result.error = error instanceof Error ? error.message : String(error);
		progress(`FAILED at stage "${result.stage}": ${result.error}`);
		await shoot('failure');
		result.diagnostics = {
			owner: await owner.diagnostics().catch((e) => String(e)),
			bookkeeping: await keeper.diagnostics().catch((e) => String(e))
		};
		throw Object.assign(error instanceof Error ? error : new Error(result.error), { result });
	} finally {
		result.finishedAt = new Date().toISOString();
		await writeFile(`${outputDir}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
		await Promise.allSettled([owner.close(), keeper.close()]);
	}
}
