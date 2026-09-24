// Reading a shared folder, with a stand-in for FileSystemDirectoryHandle.
import { describe, expect, it } from 'vitest';

import { folderSupported, listFolderFiles } from './folder.js';

/** @param {string} name @param {string} content */
const file = (name, content) => ({
	kind: 'file',
	name,
	getFile: async () => new Blob([content])
});
/** @param {string} name @param {any[]} entries */
const dir = (name, entries) => ({
	kind: 'directory',
	name,
	async *values() {
		yield* entries;
	}
});

describe('shared folder', () => {
	it('lists PDFs and images three levels deep, skips hidden folders and other files', async () => {
		const root = dir('Belege', [
			file('b.pdf', '%PDF-b'),
			file('notiz.txt', 'x'),
			file('Foto.JPG', 'jpg'),
			dir('.git', [file('x.pdf', '%PDF-x')]),
			dir('2026', [
				file('a.PDF', '%PDF-a'),
				dir('08', [file('c.png', 'png'), dir('tief', [file('d.pdf', 'd')])])
			])
		]);
		const files = await listFolderFiles(root);
		expect(files.map((f) => f.path)).toEqual(['2026/08/c.png', '2026/a.PDF', 'b.pdf', 'Foto.JPG']);
		expect(new TextDecoder().decode(await files[1].bytes())).toBe('%PDF-a');
	});

	it('is not offered where the browser has no File System Access API', () => {
		expect(folderSupported()).toBe(false);
	});
});
