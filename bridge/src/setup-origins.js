// `pnpm setup:origins`: the pages allowed to call the bridge (`appOrigins` in
// bridge.json). The bridge answers a browser only for a page on this list;
// any other gets 403 and the log says `refused origin "…"`.
//
//   pnpm setup:origins                                       the list, and how to change it
//   pnpm setup:origins -- --add https://belege.le-space.de   allow a page
//   pnpm setup:origins -- --remove http://localhost:5173      take one back
//   pnpm setup:origins -- --defaults                          the list a new bridge starts with
//
// An origin is scheme, host and port, no path: `https://belege.le-space.de`,
// `http://localhost:5173`. `http://127.0.0.1:5173` is another origin than
// `http://localhost:5173`. Only `appOrigins` is touched; nothing else in
// bridge.json is read out or printed. Restart the bridge afterwards.

import { fileURLToPath } from 'node:url';

import { defaultConfig, defaultConfigPath, loadConfig, saveConfig } from './config.js';

/**
 * `https://belege.le-space.de/` → `https://belege.le-space.de`; null for anything that is not an origin.
 *
 * @param {string} text
 */
export function asOrigin(text) {
	const s = String(text ?? '')
		.trim()
		.replace(/\/$/, '');
	try {
		const url = new URL(s);
		if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
		return url.origin === s ? s : null;
	} catch {
		return null;
	}
}

/**
 * @param {object} p
 * @param {{ print: (line: string) => void }} p.io
 * @param {string} p.configPath
 * @param {string[]} [p.add]
 * @param {string[]} [p.remove]
 * @param {boolean} [p.defaults] start again from the list a new bridge has
 * @returns {Promise<boolean>} false when an origin was not one, or nothing could be saved
 */
export async function runOriginsSetup({ io, configPath, add = [], remove = [], defaults = false }) {
	const config = await loadConfig(configPath);
	const bad = [...add, ...remove].filter((o) => !asOrigin(o));
	if (bad.length) {
		io.print(
			`Not an origin: ${bad.join(', ')}. An origin is scheme, host and port, no path – e.g. https://belege.le-space.de or http://localhost:5173.`
		);
		return false;
	}
	const before = config.appOrigins.slice();
	let list = defaults ? defaultConfig().appOrigins.slice() : before.slice();
	for (const o of add.map((x) => /** @type {string} */ (asOrigin(x)))) {
		if (!list.includes(o)) list.push(o);
	}
	const gone = new Set(remove.map((x) => /** @type {string} */ (asOrigin(x))));
	list = list.filter((o) => !gone.has(o));
	const changed = list.join('\n') !== before.join('\n');
	if (changed) {
		config.appOrigins = list;
		await saveConfig(config, configPath);
	}
	io.print('Pages allowed to call the bridge (appOrigins):');
	for (const o of list) io.print(`  ${o}`);
	if (!list.length) io.print('  (none – no page can reach the bridge)');
	if (changed) {
		io.print(`Saved ${configPath}. Restart the bridge (pnpm bridge) to use it.`);
	} else if (!add.length && !remove.length && !defaults) {
		io.print('Allow another page:  pnpm setup:origins -- --add https://belege.le-space.de');
		io.print('Take one back:       pnpm setup:origins -- --remove <origin>');
		io.print('As a new bridge has: pnpm setup:origins -- --defaults');
	} else {
		io.print('Nothing changed.');
	}
	return true;
}

/** @param {string[]} argv @param {string} flag */
const valuesOf = (argv, flag) =>
	argv.flatMap((a, i) => (a === flag && argv[i + 1] ? [argv[i + 1]] : []));

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	const argv = process.argv.slice(2);
	try {
		const ok = await runOriginsSetup({
			io: { print: (line) => console.log(line) },
			configPath: defaultConfigPath(),
			add: valuesOf(argv, '--add'),
			remove: valuesOf(argv, '--remove'),
			defaults: argv.includes('--defaults')
		});
		process.exit(ok ? 0 : 1);
	} catch (/** @type {any} */ error) {
		console.error(`Failed: ${error.message}`);
		process.exit(1);
	}
}
