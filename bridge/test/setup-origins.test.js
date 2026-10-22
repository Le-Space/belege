// `pnpm setup:origins`: the pages allowed to call the bridge, changed without
// touching anything else in bridge.json. Every value is made up.
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { defaultConfig, loadConfig, saveConfig } from '../src/config.js';
import { asOrigin, runOriginsSetup } from '../src/setup-origins.js';

/** @type {string} */ let dir;
before(async () => {
	dir = await mkdtemp(join(tmpdir(), 'belege-origins-'));
});
after(() => rm(dir, { recursive: true, force: true }));

const quiet = () => {
	/** @type {string[]} */ const out = [];
	return { out, io: { print: (/** @type {string} */ l) => out.push(l) } };
};

test('asOrigin: scheme, host and port; no path, no other scheme', () => {
	assert.equal(asOrigin('https://belege.le-space.de/'), 'https://belege.le-space.de');
	assert.equal(asOrigin('http://localhost:5173'), 'http://localhost:5173');
	assert.equal(asOrigin('https://belege.le-space.de/integrationen'), null);
	assert.equal(asOrigin('belege.le-space.de'), null);
	assert.equal(asOrigin('ftp://example.invalid'), null);
});

test('--add puts a page on the list, keeps the rest of bridge.json, and says to restart', async () => {
	const configPath = join(dir, 'add.json');
	// A list a setup:hibiscus answer left without the domain.
	await saveConfig(
		{
			...defaultConfig(),
			appOrigins: ['http://localhost:5173'],
			hibiscus: { ...defaultConfig().hibiscus, ibanSuffixes: ['4711'] }
		},
		configPath
	);
	const run = quiet();
	assert.equal(
		await runOriginsSetup({ io: run.io, configPath, add: ['https://belege.le-space.de/'] }),
		true
	);
	const config = await loadConfig(configPath);
	assert.deepEqual(config.appOrigins, ['http://localhost:5173', 'https://belege.le-space.de']);
	assert.deepEqual(config.hibiscus.ibanSuffixes, ['4711']);
	assert.ok(run.out.some((l) => l.includes('Restart the bridge')));

	// A second --add of the same changes nothing.
	const again = quiet();
	await runOriginsSetup({ io: again.io, configPath, add: ['https://belege.le-space.de'] });
	assert.deepEqual((await loadConfig(configPath)).appOrigins, config.appOrigins);
	assert.ok(again.out.includes('Nothing changed.'));
});

test('--remove and --defaults; something that is no origin changes nothing', async () => {
	const configPath = join(dir, 'remove.json');
	await saveConfig(
		{ ...defaultConfig(), appOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'] },
		configPath
	);
	await runOriginsSetup({ io: quiet().io, configPath, remove: ['http://127.0.0.1:5173'] });
	assert.deepEqual((await loadConfig(configPath)).appOrigins, ['http://localhost:5173']);

	const bad = quiet();
	assert.equal(
		await runOriginsSetup({ io: bad.io, configPath, add: ['belege.le-space.de'] }),
		false
	);
	assert.ok(bad.out[0].startsWith('Not an origin'));
	assert.deepEqual((await loadConfig(configPath)).appOrigins, ['http://localhost:5173']);

	await runOriginsSetup({ io: quiet().io, configPath, defaults: true });
	assert.deepEqual((await loadConfig(configPath)).appOrigins, defaultConfig().appOrigins);
});

test('without flags: the list and the commands, nothing written', async () => {
	const configPath = join(dir, 'show.json');
	await saveConfig(defaultConfig(), configPath);
	const before = await readFile(configPath, 'utf8');
	const run = quiet();
	await runOriginsSetup({ io: run.io, configPath });
	assert.equal(await readFile(configPath, 'utf8'), before);
	assert.ok(run.out.some((l) => l.includes('--add https://belege.le-space.de')));
});
