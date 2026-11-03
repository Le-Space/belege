// The README lists every command with its scope (#576): a command added to
// src/commands.js without a row there fails here.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { emptyCommands } from './support/commands.js';

test('bridge/README.md lists every command, with its scope', async () => {
	const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
	for (const c of emptyCommands()) {
		const row = readme.split('\n').find((line) => line.startsWith(`| \`${c.name}\` |`));
		assert.ok(row, `${c.name}: no row in the README's command table`);
		const scope = c.public ? 'public' : c.scope ? `\`${c.scope}\`` : 'the token';
		assert.ok(
			row.includes(`| ${scope} |`),
			`${c.name}: the README names another scope than ${scope}`
		);
	}
});
