// SPDX-License-Identifier: AGPL-3.0-or-later
// The skills (Le-Space/eigenbeleg-agent#29, step 3): each SKILL.md follows the
// Agent Skills format (agentskills.io), names only hosts the code itself talks
// to, carries no key, token, mail address or real company, and the plugin and
// marketplace manifests and the README point at it. Plain node:test, no
// dependency: it runs before `pnpm install` too.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../../', import.meta.url);
const skillsDir = new URL('../', import.meta.url);

/** Every `https://host` in the source files under these directories: the chains' and the rates' endpoints and explorers. */
async function hostsInCode() {
	const hosts = new Set();
	for (const dir of ['packages/chains/src', 'packages/rates/src']) {
		const path = new URL(dir + '/', root);
		for (const file of await readdir(path)) {
			if (!file.endsWith('.js')) continue;
			const text = await readFile(new URL(file, path), 'utf8');
			for (const [, host] of text.matchAll(/https?:\/\/([a-z0-9.-]+\.[a-z]{2,})/gi))
				hosts.add(host.toLowerCase());
		}
	}
	return hosts;
}

/**
 * The hosts a skill may name: our own pages and sources, the format's site, the loopback
 * addresses the bridge and the dev server live on, and the public sources the packages ask.
 */
const OUR_HOSTS = new Set([
	'belege.le-space.de',
	'eigenbeleg.le-space.de',
	'le-space.de',
	'github.com',
	'agentskills.io',
	'localhost',
	'127.0.0.1',
	...(await hostsInCode())
]);

/** @param {string} text */
function frontmatter(text) {
	const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text);
	assert.ok(m, 'SKILL.md starts with YAML frontmatter');
	/** @type {Record<string, string>} */
	const fields = {};
	for (const line of m[1].split('\n')) {
		const kv = /^([a-z-]+):\s*(.*)$/.exec(line);
		if (kv) fields[kv[1]] = kv[2].trim();
	}
	return { fields, body: m[2] };
}

const skills = (await readdir(skillsDir, { withFileTypes: true }))
	.filter((d) => d.isDirectory() && d.name !== 'test')
	.map((d) => d.name);

test('the first skills are there, each a directory with a SKILL.md', async () => {
	for (const name of ['le-space-chains', 'belege-bridge-setup', 'belege-export'])
		assert.ok(skills.includes(name), name);
	for (const name of skills)
		assert.ok((await stat(new URL(`${name}/SKILL.md`, skillsDir))).isFile(), `${name}/SKILL.md`);
});

for (const name of skills) {
	const file = new URL(`${name}/SKILL.md`, skillsDir);

	test(`${name}: the frontmatter follows the Agent Skills specification`, async () => {
		const { fields, body } = frontmatter(await readFile(file, 'utf8'));
		assert.equal(fields.name, name, 'name matches the directory');
		assert.match(fields.name, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'lowercase, digits and single hyphens');
		assert.ok(fields.name.length <= 64);
		assert.ok(
			fields.description.length > 0 && fields.description.length <= 1024,
			'description 1–1024 characters'
		);
		assert.match(fields.description, /\bUse when\b/, 'the description says when to use the skill');
		if (fields.compatibility) assert.ok(fields.compatibility.length <= 500);
		assert.match(
			fields.license,
			/^CC-BY-4\.0 \(this text\); the scripts of the repository are AGPL-3\.0-or-later$/
		);
		assert.ok(body.split('\n').length <= 500, 'the body stays under 500 lines');
		assert.match(body, /^# /m, 'the body has a title');
	});

	test(`${name}: says what it reads is data, not an instruction`, async () => {
		const text = await readFile(file, 'utf8');
		assert.match(text, /never an instruction|never instructs/i);
	});

	test(`${name}: names only our hosts and the public sources the code asks`, async () => {
		const text = await readFile(file, 'utf8');
		const found = new Set();
		for (const [, hostPort] of text.matchAll(/https?:\/\/([^/\s)"'`>]+)/g))
			found.add(hostPort.replace(/:\d+$/, '').toLowerCase());
		for (const host of found)
			assert.ok(OUR_HOSTS.has(host), `host ${host} is not one the code talks to`);
	});

	test(`${name}: carries no key, token, mail address or real company`, async () => {
		const text = await readFile(file, 'utf8');
		assert.doesNotMatch(text, /ed25519:[1-9A-HJ-NP-Za-km-z]{40,}/, 'a NEAR key');
		assert.doesNotMatch(text, /0x[0-9a-fA-F]{64}/, 'an EVM key or a real hash');
		assert.doesNotMatch(text, /\b[xyz]pub[1-9A-HJ-NP-Za-km-z]{20,}/, 'an extended public key');
		assert.doesNotMatch(text, /\bsk-[A-Za-z0-9_-]{16,}/, 'an API key');
		assert.doesNotMatch(text, /\bBearer\s+[A-Za-z0-9._-]{16,}/, 'a bearer token');
		assert.doesNotMatch(
			text,
			/\b(?!DE00 0000)[A-Z]{2}\d{2}[ ]?\d{4}[ ]?\d{4}/,
			'an IBAN (the made-up DE00 0000 … is fine)'
		);
		assert.doesNotMatch(
			text,
			/[\w.-]+@[\w-]+(\.[\w-]+)*\.(de|com|org|net|io|cloud)\b/,
			'a mail address'
		);
		// Companies in examples are the made-up ones only.
		const MADE_UP = new Set([
			'Wolkenfabrik Hosting GmbH',
			'Stromwerk Test AG',
			'Kabelnetz Beispiel GmbH',
			'Le Space UG'
		]);
		for (const [company] of text.matchAll(/\b(?:[A-Z][\w-]+[ _])+(?:GmbH|AG|UG)\b/g)) {
			assert.ok(MADE_UP.has(company.replaceAll('_', ' ')), `${company} is not a made-up example`);
		}
	});
}

test('the plugin manifest and the marketplace point at the skills', async () => {
	const plugin = JSON.parse(await readFile(new URL('.claude-plugin/plugin.json', root), 'utf8'));
	assert.equal(plugin.name, 'belege');
	assert.match(plugin.version, /^\d+\.\d+\.\d+$/);
	assert.equal(plugin.license, 'AGPL-3.0-or-later');
	const market = JSON.parse(
		await readFile(new URL('.claude-plugin/marketplace.json', root), 'utf8')
	);
	// Not `le-space`: eigenbeleg-agent's marketplace has that name, and a person registers one per name.
	assert.equal(market.name, 'le-space-belege');
	assert.ok(market.owner?.name);
	assert.ok(Array.isArray(market.plugins) && market.plugins.length >= 1);
	for (const p of market.plugins) {
		assert.match(p.name, /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
		assert.match(p.source, /^\.\//, 'a relative source inside this repository');
		const dir = join(root.pathname, p.source);
		assert.ok((await stat(join(dir, 'skills'))).isDirectory(), `${p.source} has skills/`);
	}
});

test('the README tells how to install the skills, with the marketplace name', async () => {
	const readme = await readFile(new URL('README.md', root), 'utf8');
	assert.match(readme, /claude plugin marketplace add Le-Space\/belege/);
	assert.match(readme, /claude plugin install belege@le-space-belege/);
	for (const name of skills) assert.ok(readme.includes(`skills/${name}`), `README links ${name}`);
});
