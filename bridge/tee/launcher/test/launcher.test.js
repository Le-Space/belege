// The launcher against a fake contract and a fake Phala: a start is
// provisioned, the env is taken only when signed by a key of the books, the
// quote becomes register_bridge, the secrets sealed to the attested VM are
// held for it, a stop deletes the VM, a start nobody finishes is given up.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { base58 } from '@scure/base';

import {
	START_TIMEOUT_MS,
	createLauncher,
	envMessage,
	secretsMessage,
	verifyEd25519
} from '../src/launcher.js';
import { launcherServer } from '../src/server.js';

function keypair() {
	const { publicKey, privateKey } = generateKeyPairSync('ed25519');
	const raw = publicKey.export({ format: 'der', type: 'spki' }).subarray(12);
	return {
		publicKey: `ed25519:${base58.encode(raw)}`,
		/** @param {string} m */
		sign: (m) => sign(null, Buffer.from(m), privateKey).toString('base64')
	};
}

function world() {
	const books = keypair();
	/** @type {any[]} */
	const open = [];
	/** @type {any[]} */
	const calls = [];
	let t = 1_000_000;
	const near = /** @type {any} */ ({
		requests: async () => open,
		keyBelongsTo: async (/** @type {string} */ owner, /** @type {string} */ key) =>
			owner === 'books-a.testnet' && key === books.publicKey,
		registerBridge: async (/** @type {any} */ a) => {
			calls.push(['register', a]);
			open.length = 0;
		},
		ack: async (/** @type {any} */ a) => {
			calls.push(['ack', a]);
			open.length = 0;
		}
	});
	const phala = /** @type {any} */ ({
		provision: async (/** @type {any} */ body) => {
			calls.push(['provision', body.name]);
			return {
				appId: 'app1',
				composeHash: 'c'.repeat(64),
				envPublicKey: 'e'.repeat(64),
				kms: 'pha1-prod3',
				envKeySignature: 'f'.repeat(130)
			};
		},
		create: async (/** @type {any} */ a) => {
			calls.push(['create', a]);
			return { id: 'cvm_1' };
		},
		remove: async (/** @type {string} */ id) => calls.push(['remove', id]),
		collateral: async () => ({ tcb_info: '{}', pck_crl: 'aa' })
	});
	const launcher = createLauncher({
		near,
		phala,
		provisionBody: (b) => ({ name: `belege-bridge-${b.length}` }),
		now: () => t,
		log: () => {}
	});
	return {
		books,
		open,
		calls,
		launcher,
		/** @param {number} ms */
		advance: (ms) => (t += ms)
	};
}

const start = {
	books: 'books-a.testnet',
	request: { kind: 'Start', by: 'books-a.testnet', at_ms: '2000' }
};

test('the books sign what they hand over; ed25519 as NEAR keys are', () => {
	const k = keypair();
	const m = envMessage('books-a.testnet', '2000', 'abcd');
	assert.match(m, /^belege-bridge\/env\/1\nbooks-a\.testnet\n2000\n[0-9a-f]{64}$/);
	assert.equal(verifyEd25519(k.publicKey, m, k.sign(m)), true);
	assert.equal(verifyEd25519(k.publicKey, m + 'x', k.sign(m)), false);
	assert.equal(verifyEd25519('ed25519:nope', m, k.sign(m)), false);
});

const INTAKE = '0a'.repeat(32);

test('a start: provision, signed env, VM, quote, register_bridge, sealed secrets', async () => {
	const w = world();
	w.open.push(start);
	await w.launcher.tick();
	assert.deepEqual(w.launcher.startInfo('books-a.testnet'), {
		at_ms: '2000',
		app_id: 'app1',
		compose_hash: 'c'.repeat(64),
		env_public_key: 'e'.repeat(64),
		kms: 'pha1-prod3',
		env_key_signature: 'f'.repeat(130),
		phase: 'waiting for env'
	});
	await w.launcher.tick();
	assert.equal(w.calls.filter((c) => c[0] === 'provision').length, 1, 'provisioned once');

	const env = 'ab'.repeat(40);
	const stranger = keypair();
	const bad = await w.launcher.uploadEnv('books-a.testnet', {
		at_ms: '2000',
		encrypted_env: env,
		public_key: stranger.publicKey,
		signature: stranger.sign(envMessage('books-a.testnet', '2000', env))
	});
	assert.equal(bad.status, 403, 'a key that is not the books’');
	const wrongStart = await w.launcher.uploadEnv('books-a.testnet', {
		at_ms: '1999',
		encrypted_env: env
	});
	assert.equal(wrongStart.status, 409);

	const ok = await w.launcher.uploadEnv('books-a.testnet', {
		at_ms: '2000',
		encrypted_env: env,
		public_key: w.books.publicKey,
		signature: w.books.sign(envMessage('books-a.testnet', '2000', env))
	});
	assert.equal(ok.status, 202);
	assert.deepEqual(w.calls.find((c) => c[0] === 'create')?.[1], {
		appId: 'app1',
		composeHash: 'c'.repeat(64),
		encryptedEnv: env
	});

	const q = await w.launcher.quote({
		books: 'books-a.testnet',
		start_at_ms: '2000',
		intake_key: INTAKE,
		quote: '0x0102',
		tcb_info: JSON.stringify({
			mrtd: 'aa',
			event_log: [{ imr: 3, event_type: 1, digest: 'd', event: 'e', event_payload: 'p', extra: 1 }]
		})
	});
	assert.equal(q.status, 200);
	const reg = w.calls.find((c) => c[0] === 'register')?.[1];
	assert.equal(reg.books, 'books-a.testnet');
	assert.equal(
		reg.intakeKeyHash,
		createHash('sha256').update(Buffer.from(INTAKE, 'hex')).digest('hex'),
		'the contract gets the hash of the key the VM showed'
	);
	assert.deepEqual(reg.attestation.quote, [1, 2]);
	assert.deepEqual(reg.attestation.tcb_info.event_log, [
		{ imr: 3, event_type: 1, digest: 'd', event: 'e', event_payload: 'p' }
	]);
	assert.deepEqual(w.launcher.state().running, { 'books-a.testnet': 'cvm_1' });

	// Phase 2: the browser sees the VM attested and seals the secrets to its key.
	assert.deepEqual(w.launcher.startInfo('books-a.testnet'), {
		at_ms: '2000',
		phase: 'attested',
		intake_key: INTAKE
	});
	assert.equal(w.launcher.secretsFor('books-a.testnet', '2000'), null, 'nothing yet');
	const sealed = '5e'.repeat(60);
	/** @param {any} who @param {string} message */
	const upload = (who, message) =>
		w.launcher.uploadSecrets('books-a.testnet', {
			at_ms: '2000',
			sealed,
			public_key: who.publicKey,
			signature: who.sign(message)
		});
	const right = secretsMessage('books-a.testnet', '2000', sealed);
	assert.equal((await upload(keypair(), right)).status, 403, 'a key that is not the books’');
	assert.equal(
		(await upload(w.books, envMessage('books-a.testnet', '2000', sealed))).status,
		403,
		'an env signature is not a secrets signature'
	);
	assert.equal((await upload(w.books, right)).status, 202);
	assert.deepEqual(w.launcher.secretsFor('books-a.testnet', '2000'), { sealed });
	assert.equal(w.launcher.secretsFor('books-a.testnet', '1999'), null, 'only for its start');
	assert.equal((await upload(w.books, right)).status, 409, 'once');
});

test('secrets before the VM is attested are refused', async () => {
	const w = world();
	w.open.push(start);
	await w.launcher.tick();
	const sealed = '5e'.repeat(60);
	const r = await w.launcher.uploadSecrets('books-a.testnet', {
		at_ms: '2000',
		sealed,
		public_key: w.books.publicKey,
		signature: w.books.sign(secretsMessage('books-a.testnet', '2000', sealed))
	});
	assert.equal(r.status, 409);
});

test('a quote for another start is refused', async () => {
	const w = world();
	w.open.push(start);
	await w.launcher.tick();
	const r = await w.launcher.quote({
		books: 'books-a.testnet',
		start_at_ms: '2000',
		intake_key: INTAKE,
		quote: 'aa',
		tcb_info: {}
	});
	assert.equal(r.status, 409, 'no VM yet');
});

test('a stop deletes the VM and answers the request', async () => {
	const w = world();
	w.open.push(start);
	await w.launcher.tick();
	const env = 'cd'.repeat(10);
	await w.launcher.uploadEnv('books-a.testnet', {
		at_ms: '2000',
		encrypted_env: env,
		public_key: w.books.publicKey,
		signature: w.books.sign(envMessage('books-a.testnet', '2000', env))
	});
	w.open.length = 0;
	w.open.push({
		books: 'books-a.testnet',
		request: { kind: 'Stop', by: 'books-a.testnet', at_ms: '40000' }
	});
	await w.launcher.tick();
	assert.ok(w.calls.some((c) => c[0] === 'remove' && c[1] === 'cvm_1'));
	assert.deepEqual(w.calls.find((c) => c[0] === 'ack')?.[1], {
		books: 'books-a.testnet',
		atMs: '40000',
		outcome: 'stopped'
	});
});

test('a start nobody finishes is given up', async () => {
	const w = world();
	w.open.push(start);
	await w.launcher.tick();
	w.advance(START_TIMEOUT_MS + 1);
	await w.launcher.tick();
	assert.deepEqual(w.calls.find((c) => c[0] === 'ack')?.[1], {
		books: 'books-a.testnet',
		atMs: '2000',
		outcome: 'no env in time'
	});
	assert.equal(w.launcher.startInfo('books-a.testnet'), null);
});

test('the HTTP API: CORS for the app only, a body limit, accounts checked', async () => {
	const w = world();
	w.open.push(start);
	await w.launcher.tick();
	const server = launcherServer(w.launcher, {
		origins: ['https://belege.example.com'],
		log: () => {}
	});
	await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
	const base = `http://127.0.0.1:${/** @type {any} */ (server.address()).port}`;
	try {
		const ok = await fetch(`${base}/v1/starts/books-a.testnet`, {
			headers: { origin: 'https://belege.example.com' }
		});
		assert.equal(ok.status, 200);
		assert.equal(ok.headers.get('access-control-allow-origin'), 'https://belege.example.com');
		assert.equal((await ok.json()).env_public_key, 'e'.repeat(64));
		const other = await fetch(`${base}/v1/starts/books-a.testnet`, {
			headers: { origin: 'https://evil.example.com' }
		});
		assert.equal(other.headers.get('access-control-allow-origin'), null);
		assert.equal((await fetch(`${base}/v1/starts/Not%20An%20Account`)).status, 400);
		assert.equal((await fetch(`${base}/v1/starts/books-b.testnet`)).status, 404);
		const big = await fetch(`${base}/v1/bridge-quote`, {
			method: 'POST',
			body: 'x'.repeat(5 * 1024 * 1024)
		}).catch(() => null);
		assert.ok(!big || big.status === 413);
	} finally {
		server.close();
	}
});
