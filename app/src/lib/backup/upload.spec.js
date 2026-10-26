// The backup's upload with progress (upload.js): the file's own hash from the
// host's answer, progress where the host allows it, and – where it refuses
// the preflight, as Aleph's IPFS host does – the same upload without it, that
// host not asked again. Against a stand-in XMLHttpRequest; the hashes are made up.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	API_UPLOAD_LIMIT,
	IngestGoneError,
	UploadTimeoutError,
	addedHash,
	uploadToAleph
} from './upload.js';

/** What the stand-in host does with each request. */
let behaviour = /** @type {(x: FakeXhr) => void} */ (() => {});
/** @type {FakeXhr[]} */
let made = [];

class FakeXhr {
	status = 0;
	statusText = '';
	responseText = '';
	timeout = 0;
	/** @type {{ onprogress: ((e: { loaded: number, total: number, lengthComputable: boolean }) => void) | null }} */
	upload = { onprogress: null };
	/** @type {(() => void) | null} */ onload = null;
	/** @type {(() => void) | null} */ onerror = null;
	/** @type {(() => void) | null} */ ontimeout = null;
	/** @param {string} method @param {string} url */
	open(method, url) {
		this.url = url;
	}
	send() {
		made.push(this);
		queueMicrotask(() => behaviour(this));
	}
}

/** @param {FakeXhr} x @param {string} hash */
const answer = (x, hash) => {
	x.status = 200;
	x.responseText = `${JSON.stringify({ Name: 'backups', Hash: 'QmWrapper' })}\n${JSON.stringify({ Name: 'backups/b.car', Hash: hash })}\n`;
	x.onload?.();
};

afterEach(() => {
	vi.unstubAllGlobals();
	made = [];
});

describe('addedHash', () => {
	it('takes the file’s own line, not a wrapper’s', () => {
		const text = '{"Name":"dir","Hash":"QmDir"}\n{"Name":"dir/f","Hash":"QmFile"}\n';
		expect(addedHash(text, 'dir/f')).toBe('QmFile');
		expect(addedHash('{"Name":"x","Hash":"QmOnly"}', 'other')).toBe('QmOnly');
		expect(() => addedHash('not json', 'f')).toThrow(/not JSON/);
		expect(() => addedHash('{"Name":"f"}', 'f')).toThrow(/no Hash/);
	});
});

describe('uploadToAleph', () => {
	it('counts the bytes as they go out', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		behaviour = (x) => {
			x.upload.onprogress?.({ loaded: 4, total: 10, lengthComputable: true });
			x.upload.onprogress?.({ loaded: 10, total: 10, lengthComputable: true });
			answer(x, 'QmCounted');
		};
		/** @type {number[]} */ const seen = [];
		const r = await uploadToAleph({
			ingestUrl: 'https://ipfs.example.test/api/v0/add',
			bytes: new Uint8Array(10),
			name: 'backups/b.car',
			onProgress: (sent) => seen.push(sent)
		});
		expect(r).toEqual({ id: 'QmCounted', size: 10, measured: true });
		expect(seen).toEqual([4, 10]);
	});

	it('refused before a byte went: sent again without counting, and that host not asked again', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		// A listener on the upload makes the browser ask first; this host says no.
		behaviour = (x) => (x.upload.onprogress ? x.onerror?.() : answer(x, 'QmUncounted'));
		const ingestUrl = 'https://ipfs.refusing.test/api/v0/add';
		const onMeasured = vi.fn();
		const first = await uploadToAleph({
			ingestUrl,
			bytes: new Uint8Array(10),
			name: 'backups/b.car',
			onProgress: () => {},
			onMeasured
		});
		expect(first).toEqual({ id: 'QmUncounted', size: 10, measured: false });
		expect(onMeasured.mock.calls).toEqual([[true], [false]]);
		expect(made).toHaveLength(2);

		made = [];
		await uploadToAleph({
			ingestUrl,
			bytes: new Uint8Array(10),
			name: 'backups/b.car',
			onProgress: () => {}
		});
		expect(made).toHaveLength(1);
		expect(made[0].upload.onprogress).toBeNull();
	});

	it('a failure after bytes went is a failure, not sent twice', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		behaviour = (x) => {
			x.upload.onprogress?.({ loaded: 3, total: 10, lengthComputable: true });
			x.onerror?.();
		};
		await expect(
			uploadToAleph({
				ingestUrl: 'https://ipfs.dropping.test/api/v0/add',
				bytes: new Uint8Array(10),
				name: 'b',
				onProgress: () => {}
			})
		).rejects.toThrow(/unreachable/);
		expect(made).toHaveLength(1);
	});

	it('a refusing answer is an error with its status', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		behaviour = (x) => {
			x.status = 413;
			x.statusText = 'Payload Too Large';
			x.onload?.();
		};
		await expect(
			uploadToAleph({
				ingestUrl: 'https://ipfs.full.test/api/v0/add',
				bytes: new Uint8Array(1),
				name: 'b'
			})
		).rejects.toThrow(/413 Payload Too Large/);
	});

	it('a big file gets time for a slow line, and says how long it waited', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		behaviour = (x) => x.ontimeout?.();
		const size = 500e6;
		const error = await uploadToAleph({
			ingestUrl: 'https://ipfs.slow.test/api/v0/add',
			bytes: new Uint8Array(size),
			name: 'b'
		}).catch((e) => e);
		expect(error).toBeInstanceOf(UploadTimeoutError);
		// Two minutes, and 500 MB at 100 kB/s.
		expect(made[0].timeout).toBe(120_000 + size / 100);
		expect(error.minutes).toBe(85);
		expect(error.size).toBe(size);
	});

	it('the IPFS host gone (404): a small file goes to the API node, counted, and the host is not asked again', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		behaviour = (x) => {
			if (String(x.url).endsWith('/api/v0/add')) {
				x.status = 404;
				x.onload?.();
				return;
			}
			x.upload.onprogress?.({ loaded: 10, total: 10, lengthComputable: true });
			x.status = 200;
			x.responseText = JSON.stringify({ status: 'success', hash: 'QmViaApi', name: 'b', size: 10 });
			x.onload?.();
		};
		const ingestUrl = 'https://ipfs.gone.test/api/v0/add';
		const apiHost = 'https://api.example.test';
		/** @type {number[]} */ const seen = [];
		const onMeasured = vi.fn();
		const r = await uploadToAleph({
			ingestUrl,
			apiHost,
			bytes: new Uint8Array(10),
			name: 'b',
			onProgress: (sent) => seen.push(sent),
			onMeasured
		});
		expect(r).toEqual({ id: 'QmViaApi', size: 10, measured: true });
		expect(made.map((x) => x.url)).toEqual([ingestUrl, `${apiHost}/api/v0/ipfs/add_file`]);
		expect(seen).toEqual([10]);
		expect(onMeasured.mock.calls.at(-1)).toEqual([true]);

		made = [];
		await uploadToAleph({ ingestUrl, apiHost, bytes: new Uint8Array(10), name: 'b' });
		expect(made.map((x) => x.url)).toEqual([`${apiHost}/api/v0/ipfs/add_file`]);
	});

	it('the IPFS host gone and the file too big for the API: said so, nothing sent there', async () => {
		vi.stubGlobal('XMLHttpRequest', FakeXhr);
		behaviour = (x) => {
			x.status = 404;
			x.onload?.();
		};
		const size = API_UPLOAD_LIMIT + 1;
		const error = await uploadToAleph({
			ingestUrl: 'https://ipfs.gone-too.test/api/v0/add',
			apiHost: 'https://api.example.test',
			bytes: new Uint8Array(size),
			name: 'b'
		}).catch((e) => e);
		expect(error).toBeInstanceOf(IngestGoneError);
		expect(error.size).toBe(size);
		expect(made).toHaveLength(1);
	});
});
