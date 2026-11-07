// SPDX-License-Identifier: AGPL-3.0-or-later
// Writes one of each document this package draws (test/support/samples.js)
// into a folder, for veraPDF: `node scripts/pdfa-samples.js out/` and then
// `verapdf --flavour 2b out/*.pdf` (.github/workflows/packages.yml).

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { samples } from '../test/support/samples.js';

const dir = resolve(process.argv[2] ?? 'pdfa-samples');
await mkdir(dir, { recursive: true });
const { pdfs } = await samples();
for (const [name, bytes] of Object.entries(pdfs)) {
	await writeFile(join(dir, name), bytes);
	console.log(`${join(dir, name)} (${bytes.length} bytes)`);
}
