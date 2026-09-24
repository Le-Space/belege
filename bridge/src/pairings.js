// Paired devices on the command line: list them, or forget them.
//
//   pnpm bridge -- --list-pairings
//   pnpm bridge -- --revoke 2        # the second one in the list
//   pnpm bridge -- --revoke-all
//
// For a device that cannot unpair itself (lost, wiped, or the bridge was not
// running when the app said "Kopplung lösen"). A running bridge keeps the
// list in memory and writes it back on the next pairing, so these refuse to
// run while one answers on the configured port.

import { loadConfig, saveConfig } from './config.js';

/**
 * @param {object} options
 * @param {string} options.configPath
 * @param {'list' | 'revoke' | 'revoke-all'} options.action
 * @param {number} [options.index] 1-based, for 'revoke'
 * @param {(port: number) => Promise<boolean>} [options.isRunning]
 * @param {(line: string) => void} [options.print]
 * @returns {Promise<number>} the exit code
 */
export async function managePairings({
	configPath,
	action,
	index,
	isRunning = bridgeAnswers,
	print = (line) => console.log(line)
}) {
	const config = await loadConfig(configPath);
	const list = config.pairedTokens;

	if (action === 'list') {
		if (!list.length) print('No paired device.');
		list.forEach((entry, i) =>
			print(`${i + 1}. paired ${entry.createdAt} · token hash ${String(entry.hash).slice(0, 8)}…`)
		);
		return 0;
	}

	if (await isRunning(config.bridge.port)) {
		print(
			`A bridge is running on port ${config.bridge.port}. Stop it first (Ctrl+C), then run this again:` +
				' a running bridge would write the old list back.'
		);
		return 1;
	}

	if (action === 'revoke-all') {
		config.pairedTokens = [];
		await saveConfig(config, configPath);
		print(`Forgot ${list.length} paired device(s). Pair again with \`pnpm bridge\`.`);
		return 0;
	}

	if (
		!Number.isInteger(index) ||
		/** @type {number} */ (index) < 1 ||
		/** @type {number} */ (index) > list.length
	) {
		print(`--revoke needs a number from --list-pairings (1–${list.length || 0}).`);
		return 1;
	}
	const [gone] = config.pairedTokens.splice(/** @type {number} */ (index) - 1, 1);
	await saveConfig(config, configPath);
	print(`Forgot the device paired ${gone.createdAt}.`);
	return 0;
}

/** @param {number} port */
async function bridgeAnswers(port) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/health`, {
			signal: AbortSignal.timeout(1500)
		});
		const body = await res.json();
		return body?.service === 'belege-bridge';
	} catch {
		return false;
	}
}
