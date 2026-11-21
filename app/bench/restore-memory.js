// What a restore holds in memory, measured (#512). Run by
// src/lib/backup/restore-memory.spec.js in a process of its own:
//
//   node --expose-gc bench/restore-memory.js <frames|one-piece> <MiB>
//
// Books with receipt files of that many MiB are backed up (archive.js
// `buildBackup`) and the sealed file is written to disk – in a process of
// its own (this file again, with `make`), so nothing of the making is in the
// memory that is measured. Then, in a node whose blocks are on disk as the
// app's are (LevelBlockstore), the file is read back as a stream and restored
// (`restoreBackup`), while a timer notes the most memory held in
// ArrayBuffers – collected before every reading, so what is counted is what
// is still referenced. Printed as JSON.
//
// - `frames`: the backup as it is sealed now, opened as it arrives.
// - `one-piece`: the same backup sealed as before #512, which can only be
//   opened whole.
//
// A real OrbitDB and Helia, offline; every name and byte is made up. The
// database is a plain one: what is measured is the file's way into the
// blockstore, which is the same for sealed books. That is why this file is
// here and not under src/: nothing the app ships opens a database unsealed
// (store/sealed-blocks.spec.js).

import process from 'node:process';
import { execFile } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import * as dagCbor from '@ipld/dag-cbor';
import { withBitswap } from '@helia/bitswap';
import { withLibp2p } from '@helia/libp2p';
import { IPFSAccessController, createOrbitDB } from '@orbitdb/core';
import { LevelBlockstore } from 'blockstore-level';
import { createHeliaLight } from 'helia';
import { CID } from 'multiformats/cid';
import * as raw from 'multiformats/codecs/raw';
import { sha256 } from 'multiformats/hashes/sha2';

import { sealer } from '../src/lib/db-encryption.js';
import { createOfflineLibp2p } from '../src/lib/network.js';
import { MAGIC, buildBackup, openBackup, restoreBackup } from '../src/lib/backup/archive.js';

const [mode, megabytes] = [process.argv[2], Number(process.argv[3] ?? 64)];
if (mode !== 'frames' && mode !== 'one-piece') throw new Error('frames or one-piece');
/** Set when this process is the one that makes the backup: the directory to make it in. */
const makeIn = process.argv[4] === 'make' ? process.argv[5] : null;
const gc = /** @type {() => void} */ (/** @type {any} */ (globalThis).gc);
const MIB = 1024 * 1024;
const open = { type: 'documents', AccessController: IPFSAccessController({ write: ['*'] }) };
// A made-up key, the same in the process that makes and the one that restores.
const key = new Uint8Array(32).fill(0x5a);

const dir = makeIn ?? (await mkdtemp(join(tmpdir(), 'belege-restore-memory-')));

/** A node with its blocks on disk. @param {string} name */
async function node(name) {
	const blockstore = new LevelBlockstore(join(dir, name, 'blocks'));
	await blockstore.open();
	const helia = await withBitswap(
		withLibp2p(createHeliaLight({ blockstore, codecs: [dagCbor] }), await createOfflineLibp2p())
	).start();
	const orbitdb = await createOrbitDB({
		ipfs: helia,
		id: name,
		// @ts-expect-error `directory` is a documented option the bundled types omit
		directory: join(dir, name, 'orbitdb')
	});
	return {
		helia,
		orbitdb,
		async stop() {
			await orbitdb.stop();
			await helia.stop();
			await blockstore.close();
		}
	};
}

/** The books, their backup, the sealed file on disk; what the restore needs to know of it. */
async function makeBackup() {
	const a = await node('a');
	const books = await a.orbitdb.open('restore-memory-books', open);
	await books.put({ _id: 'eins', counterparty: 'Wolkenfabrik Hosting GmbH', amountCents: -1234 });
	// One receipt file of the size asked for: a root that names its chunks,
	// and the chunks, a megabyte each, as receipts/blob-store.js keeps a file.
	const chunks = [];
	for (let i = 0; i < megabytes; i++) {
		const bytes = new Uint8Array(MIB);
		for (let at = 0; at < MIB; at += 65536) crypto.getRandomValues(bytes.subarray(at, at + 65536));
		const cid = CID.createV1(raw.code, await sha256.digest(bytes));
		await a.helia.blockstore.put(cid, bytes);
		chunks.push(cid);
	}
	const root = dagCbor.encode({ chunks });
	const rootCid = CID.createV1(dagCbor.code, await sha256.digest(root));
	await a.helia.blockstore.put(rootCid, root);

	const backup = await buildBackup({
		databases: { books },
		blockstore: a.helia.blockstore,
		receipts: /** @type {any} */ ({ list: async () => [{ fileCid: rootCid.toString() }] }),
		key,
		appVersion: '0.0.0-test'
	});
	let sealed = backup.sealed;
	if (mode === 'one-piece') {
		// As it was sealed before #512: "belegeB1" ‖ nonce ‖ AES-GCM(CAR).
		const { blocks } = await openBackup(sealed, key);
		const { createCARFromBlocks } = await import('@le-space/orbitdb-storage-bridge/backup-car');
		const [first] = blocks.keys();
		const body = await (await sealer(key)).seal(await createCARFromBlocks(blocks, first));
		sealed = new Uint8Array(MAGIC.length + body.length);
		sealed.set(MAGIC, 0);
		sealed.set(body, MAGIC.length);
	}
	const file = join(dir, 'backup.sealed');
	await writeFile(file, sealed);
	const made = {
		file,
		size: sealed.length,
		blocks: backup.blocks,
		address: String(books.address)
	};
	await books.close();
	await a.stop();
	return made;
}

if (makeIn) {
	process.stdout.write(JSON.stringify(await makeBackup()) + '\n');
	process.exit(0);
}

try {
	const { stdout } = await promisify(execFile)(
		process.execPath,
		['--no-warnings', fileURLToPath(import.meta.url), mode, String(megabytes), 'make', dir],
		{ maxBuffer: MIB }
	);
	/** @type {{ file: string, size: number, blocks: number, address: string }} */
	const made = JSON.parse(/** @type {string} */ (stdout.trim().split('\n').at(-1)));
	const b = await node('b');
	gc();
	const baseline = process.memoryUsage().arrayBuffers;
	let peak = 0;
	const sample = () => {
		gc();
		peak = Math.max(peak, process.memoryUsage().arrayBuffers - baseline);
	};
	const watching = setInterval(sample, 5);
	const result = await restoreBackup({
		orbitdb: b.orbitdb,
		// As a download arrives: in pieces, the file never whole in one buffer.
		sealed: () => createReadStream(made.file, { highWaterMark: 256 * 1024 }),
		key,
		targets: [{ name: 'sealed', addresses: { books: made.address }, open }],
		onProgress: sample
	});
	clearInterval(watching);
	const books = await b.orbitdb.open(made.address, open);
	const records = (await books.all()).length;
	await books.close();
	await b.stop();
	process.stdout.write(
		JSON.stringify({
			mode,
			megabytes,
			size: made.size,
			blocks: result.blocks,
			expected: made.blocks,
			streamed: result.streamed,
			records,
			peak
		}) + '\n'
	);
} finally {
	await rm(dir, { recursive: true, force: true });
}
