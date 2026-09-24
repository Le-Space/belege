// The secret step of a setup CLI, shared by setup:mail and setup:llm. The same
// rules as setup:hibiscus (#9): a value found in the repo's .env is offered
// once; the hidden prompt keeps a stored secret on Enter only when there is
// one, and asks again (three times) on the first run.

/** @param {string} answer */
export const yes = (answer) => /^(y|yes|j|ja)$/i.test(answer.trim());

/**
 * @param {object} params
 * @param {{ ask: (q: string) => Promise<string>, askHidden: (q: string) => Promise<string>, print: (line: string) => void }} params.io
 * @param {import('./keychain.js').Keychain} params.keychain
 * @param {string} params.what e.g. "IMAP password or auth token"
 * @param {string} params.account the keychain account, for the message
 * @param {string} [params.envName] e.g. IMAP_PASSWORD
 * @param {string} [params.envValue]
 * @returns {Promise<boolean>} whether a secret is stored now
 */
export async function storeSecret({ io, keychain, what, account, envName, envValue }) {
	const stored = await keychain.read().then(
		() => true,
		() => false
	);
	let secret = '';
	if (!stored && envValue && envName) {
		if (yes((await io.ask(`${envName} found in .env. Store it in the keychain? [Y/n]: `)) || 'y')) {
			secret = envValue;
		}
	}
	for (let tries = 0; !secret && tries < 3; tries++) {
		secret = await io.askHidden(
			stored
				? `${what} (hidden; empty keeps the stored one): `
				: `${what} (hidden; none is stored yet): `
		);
		if (!secret && stored) break;
		if (!secret) io.print(`No ${what} is stored yet, so it cannot be kept – please type it.`);
	}
	if (secret) {
		await keychain.write(secret);
		io.print(`Stored in the keychain (service belege-bridge, account ${account}).`);
		if (envName && secret === envValue) {
			io.print(`You can now delete ${envName} from .env: the bridge reads only the keychain.`);
		}
		return true;
	}
	if (stored) {
		io.print('Keeping the one already in the keychain.');
		return true;
	}
	io.print('Nothing stored.');
	return false;
}

/**
 * Loads the repo's .env into process.env when there is one (phase-0 spikes
 * kept their settings there). Never prints it.
 *
 * @param {URL} url
 */
export function loadRepoEnv(url) {
	try {
		process.loadEnvFile(url);
	} catch {
		// no .env: nothing to offer
	}
}
