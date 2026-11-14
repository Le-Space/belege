// The hosted bridge on Phala through NEAR (#696), for an E2E without a chain,
// a cloud or a TDX machine. What is fake and what is real:
//
//   fake  the NEAR contract (bridge/tee/near-contract) behind NEAR's JSON-RPC:
//         the books' implicit account (funded by the test), the function-call
//         transactions the app signs (Borsh and ed25519 checked here, as NEAR
//         would), request_start / request_stop / get_books, and the
//         launcher's register_bridge / ack_request. The quote's DCAP chain is
//         not checked (no Intel here): its report data must bind the start and
//         the intake key, and its compose hash must be the approved one.
//   fake  Phala Cloud's API (provision, the KMS's signature over the app's
//         env key, create, delete, collateral), with a KMS key of its own the
//         test pins in the app (`belege.e2e.near`), and dstack's guest API on
//         a Unix socket per VM (GetQuote, Info).
//   real  the launcher (bridge/tee/launcher: createLauncher, launcherServer,
//         phalaClient with this fetch), the provision body (provision.mjs),
//         and in the "VM" what the image runs: dstack's env decryption is
//         done here, then sort-secrets.mjs and registrar.mjs as the
//         entrypoint runs them. The test starts the bridge from the run
//         directory, as the entrypoint does.
//
// Everything listens on 127.0.0.1; nothing is real.
import {
	createDecipheriv,
	createHash,
	createPublicKey,
	diffieHellman,
	generateKeyPairSync,
	randomBytes,
	verify
} from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58 } from '@scure/base';

import { createLauncher } from '../../tee/launcher/src/launcher.js';
import { launcherServer } from '../../tee/launcher/src/server.js';
import { API, VERIFY, phalaClient } from '../../tee/launcher/src/phala.js';
import { provisionBody } from '../../tee/dstack/provision.mjs';
import { register } from '../../tee/dstack/registrar.mjs';
import { sortSecrets } from '../../tee/dstack/sort-secrets.mjs';

/** The fake contract's account and the fake KMS's slug, as the app is told them. */
export const FAKE_NEAR_CONTRACT = 'belege-bridge.e2e.testnet';
export const FAKE_KMS_SLUG = 'e2e-fake-kms';
/** The image the fake launcher provisions: a made-up digest. */
export const FAKE_BRIDGE_IMAGE = `ghcr.io/example/belege-bridge@sha256:${'3c'.repeat(32)}`;
const START_DOMAIN = 'belege-bridge/start/1';
const QUOTE_MARK = Buffer.from('E2E-FAKE-TDX-QUOTE');
const ONE_NEAR = 10n ** 24n;

const sha256 = (/** @type {Buffer|string} */ b) => createHash('sha256').update(b).digest();
const listen = (/** @type {import('node:http').Server} */ server, /** @type {any} */ at) =>
	new Promise((resolve) => server.listen(at, () => resolve(undefined)));
const closeServer = (/** @type {import('node:http').Server} */ server) =>
	new Promise((resolve) => {
		server.closeAllConnections?.();
		server.close(() => resolve(undefined));
	});

/** @param {import('node:http').IncomingMessage} req */
async function readJson(req) {
	let raw = '';
	for await (const chunk of req) raw += chunk;
	return raw ? JSON.parse(raw) : {};
}

// --- NEAR ----------------------------------------------------------------------

/** Borsh, as far as a signed function-call transaction goes. @param {Buffer} buf */
function reader(buf) {
	let at = 0;
	const take = (/** @type {number} */ n) => {
		if (at + n > buf.length) throw new Error('short transaction');
		const out = buf.subarray(at, at + n);
		at += n;
		return out;
	};
	const u32 = () => take(4).readUInt32LE(0);
	const uint = (/** @type {number} */ n) =>
		[...take(n)].reverse().reduce((v, b) => (v << 8n) | BigInt(b), 0n);
	return {
		u8: () => take(1)[0],
		u32,
		uint,
		fixed: take,
		string: () => take(u32()).toString('utf8'),
		vec: () => take(u32()),
		get at() {
			return at;
		},
		get rest() {
			return buf.length - at;
		}
	};
}

/** @param {Buffer} signed */
export function decodeSignedTransaction(signed) {
	const r = reader(signed);
	const signerId = r.string();
	if (r.u8() !== 0) throw new Error('not an ed25519 key');
	const publicKey = Buffer.from(r.fixed(32));
	const nonce = r.uint(8);
	const receiverId = r.string();
	r.fixed(32); // block hash
	if (r.u32() !== 1) throw new Error('one action only');
	if (r.u8() !== 2) throw new Error('not a function call');
	const methodName = r.string();
	const args = JSON.parse(r.vec().toString('utf8') || '{}');
	const gas = r.uint(8);
	const deposit = r.uint(16);
	const tx = signed.subarray(0, r.at);
	if (r.u8() !== 0) throw new Error('not an ed25519 signature');
	const signature = r.fixed(64);
	if (r.rest) throw new Error('trailing bytes');
	const key = createPublicKey({
		key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), publicKey]),
		format: 'der',
		type: 'spki'
	});
	const valid = verify(null, sha256(tx), key, signature);
	return { signerId, publicKey, nonce, receiverId, methodName, args, gas, deposit, valid };
}

/**
 * The bridge contract on a fake NEAR: JSON-RPC for the browser (with CORS),
 * and the calls the launcher makes, in process.
 *
 * @param {{ origin: string }} o the app's origin, for CORS
 */
export async function startFakeNear({ origin }) {
	/** @type {Map<string, { amount: bigint, nonce: bigint }>} implicit accounts the test funded */
	const accounts = new Map();
	/** @type {Map<string, { request: any, bridge: any }>} */
	const books = new Map();
	/** @type {Set<string>} */
	const approvedCompose = new Set();
	/** @type {{ method: string, books: string, at: number }[]} */
	const calls = [];
	const blockHash = base58.encode(randomBytes(32));
	let clock = Date.now();
	const now = () => (clock = Math.max(clock + 1, Date.now()));

	const implicitKey = (/** @type {string} */ id) =>
		/^[0-9a-f]{64}$/.test(id) ? `ed25519:${base58.encode(Buffer.from(id, 'hex'))}` : null;

	const viewOf = (/** @type {string} */ id) => {
		const b = books.get(id);
		if (!b) return null;
		return { grants: [], request: b.request, bridge: b.bridge };
	};

	/** @param {string} id @param {'Start'|'Stop'} kind @param {bigint} deposit */
	function request(id, kind, deposit) {
		if (!books.has(id)) {
			if (deposit < ONE_NEAR / 100n) throw new Error('Not enough deposit for the books');
			books.set(id, { request: null, bridge: null });
		}
		const b = /** @type {{ request: any, bridge: any }} */ (books.get(id));
		const at = now();
		b.request = { kind, by: id, at_ms: String(at) };
		// A stop forgets the bridge at once.
		if (kind === 'Stop') b.bridge = null;
		calls.push({ method: kind === 'Start' ? 'request_start' : 'request_stop', books: id, at });
		return String(at);
	}

	const server = createServer(async (req, res) => {
		const cors = {
			'access-control-allow-origin': origin,
			'access-control-allow-methods': 'POST',
			'access-control-allow-headers': 'content-type'
		};
		const send = (/** @type {any} */ body) => {
			res.writeHead(200, { 'content-type': 'application/json', ...cors });
			res.end(JSON.stringify(body));
		};
		if (req.method === 'OPTIONS') {
			res.writeHead(204, cors);
			return res.end();
		}
		/** @type {any} */
		let rpc = {};
		try {
			rpc = await readJson(req);
			const p = rpc.params ?? {};
			const fail = (/** @type {string} */ name) =>
				send({ jsonrpc: '2.0', id: rpc.id, error: { name: 'HANDLER_ERROR', cause: { name } } });
			if (rpc.method === 'query' && p.request_type === 'view_account') {
				const a = accounts.get(p.account_id);
				if (!a) return fail('UNKNOWN_ACCOUNT');
				return send({ jsonrpc: '2.0', id: rpc.id, result: { amount: String(a.amount) } });
			}
			if (rpc.method === 'query' && p.request_type === 'view_access_key') {
				const a = accounts.get(p.account_id);
				if (!a || implicitKey(p.account_id) !== p.public_key) return fail('UNKNOWN_ACCESS_KEY');
				return send({
					jsonrpc: '2.0',
					id: rpc.id,
					result: { nonce: Number(a.nonce), permission: 'FullAccess', block_hash: blockHash }
				});
			}
			if (rpc.method === 'query' && p.request_type === 'call_function') {
				if (p.account_id !== FAKE_NEAR_CONTRACT) return fail('UNKNOWN_ACCOUNT');
				const args = JSON.parse(Buffer.from(p.args_base64, 'base64').toString('utf8') || '{}');
				if (p.method_name !== 'get_books') return fail('METHOD_NOT_FOUND');
				const result = [...Buffer.from(JSON.stringify(viewOf(String(args.books))))];
				return send({ jsonrpc: '2.0', id: rpc.id, result: { result } });
			}
			if (rpc.method === 'send_tx') {
				const tx = decodeSignedTransaction(Buffer.from(p.signed_tx_base64, 'base64'));
				const a = accounts.get(tx.signerId);
				if (!tx.valid) return fail('INVALID_SIGNATURE');
				if (!a || implicitKey(tx.signerId) !== `ed25519:${base58.encode(tx.publicKey)}`)
					return fail('INVALID_ACCESS_KEY');
				if (tx.receiverId !== FAKE_NEAR_CONTRACT) return fail('INVALID_RECEIVER');
				if (tx.nonce <= a.nonce) return fail('INVALID_NONCE');
				a.nonce = tx.nonce;
				a.amount -= tx.deposit;
				let value;
				try {
					if (tx.methodName === 'request_start') value = request(tx.signerId, 'Start', tx.deposit);
					else if (tx.methodName === 'request_stop')
						value = request(tx.signerId, 'Stop', tx.deposit);
					else throw new Error('no such method');
				} catch (e) {
					return send({
						jsonrpc: '2.0',
						id: rpc.id,
						result: { status: { Failure: { message: /** @type {Error} */ (e).message } } }
					});
				}
				return send({
					jsonrpc: '2.0',
					id: rpc.id,
					result: {
						status: { SuccessValue: Buffer.from(JSON.stringify(value)).toString('base64') }
					}
				});
			}
			fail('UNKNOWN_METHOD');
		} catch (e) {
			send({
				jsonrpc: '2.0',
				id: rpc?.id ?? null,
				error: {
					name: 'REQUEST_VALIDATION_ERROR',
					cause: { name: /** @type {Error} */ (e).message }
				}
			});
		}
	});
	await listen(server, { port: 0, host: '127.0.0.1' });
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());

	return {
		url: `http://127.0.0.1:${port}`,
		contractId: FAKE_NEAR_CONTRACT,
		calls,
		books,
		/** The test sends the books' implicit account NEAR: it exists from now on. @param {string} id */
		fund(id, near = 1n) {
			const a = accounts.get(id);
			if (a) a.amount += near * ONE_NEAR;
			else accounts.set(id, { amount: near * ONE_NEAR, nonce: 0n });
		},
		/** The contract's owner approves a compose hash (the measurements, in the real one). @param {string} hash */
		approve(hash) {
			approvedCompose.add(hash);
		},
		/** The contract as the launcher's nearClient sees it (bridge/tee/launcher/src/near.js). */
		launcherSide: {
			contractId: FAKE_NEAR_CONTRACT,
			accountId: 'launcher.e2e.testnet',
			async requests() {
				return [...books]
					.filter(([, b]) => b.request)
					.map(([id, b]) => ({ books: id, request: b.request }));
			},
			async books(/** @type {string} */ id) {
				return viewOf(id);
			},
			async keyBelongsTo(/** @type {string} */ owner, /** @type {string} */ publicKey) {
				return accounts.has(owner) && implicitKey(owner) === publicKey;
			},
			/** @param {{ books: string, attestation: any, intakeKeyHash: string }} o */
			async registerBridge({ books: id, attestation, intakeKeyHash }) {
				const b = books.get(id);
				if (!b || b.request?.kind !== 'Start')
					throw new Error('These books did not ask for a start');
				const quote = Buffer.from(attestation.quote);
				if (!quote.subarray(0, QUOTE_MARK.length).equals(QUOTE_MARK))
					throw new Error('Attestation refused: not a quote');
				const expected = Buffer.concat([
					sha256(`${START_DOMAIN}${id}:${b.request.at_ms}`),
					Buffer.from(intakeKeyHash, 'hex')
				]);
				if (!quote.subarray(QUOTE_MARK.length).equals(expected))
					throw new Error('Attestation refused: report data');
				const compose = String(attestation.tcb_info?.compose_hash ?? '');
				if (!approvedCompose.has(compose))
					throw new Error('Attestation refused: compose hash not approved');
				const at = now();
				b.bridge = {
					intake_key_hash: intakeKeyHash,
					compose_hash: compose,
					start_at_ms: b.request.at_ms,
					registered_ms: String(at),
					valid_until_ms: String(at + 86_400_000),
					valid: true
				};
				b.request = null;
				calls.push({ method: 'register_bridge', books: id, at });
				return b.bridge;
			},
			/** @param {{ books: string, atMs: string, outcome: string }} o */
			async ack({ books: id, atMs }) {
				const b = books.get(id);
				if (!b || b.request?.at_ms !== String(atMs)) throw new Error('No such request');
				b.request = null;
				calls.push({ method: 'ack_request', books: id, at: now() });
			}
		},
		close: () => closeServer(server)
	};
}

// --- Phala, its KMS and dstack ----------------------------------------------------

/** dstack's env encryption, the VM's side: x25519, the shared secret as the AES-256-GCM key. */
function decryptEnv(/** @type {string} */ hex, /** @type {import('node:crypto').KeyObject} */ key) {
	const raw = Buffer.from(hex, 'hex');
	const eph = createPublicKey({
		key: Buffer.concat([Buffer.from('302a300506032b656e032100', 'hex'), raw.subarray(0, 32)]),
		format: 'der',
		type: 'spki'
	});
	const shared = diffieHellman({ privateKey: key, publicKey: eph });
	const body = raw.subarray(44);
	const d = createDecipheriv('aes-256-gcm', shared, raw.subarray(32, 44));
	d.setAuthTag(body.subarray(body.length - 16));
	const json = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
	/** @type {{ env: { key: string, value: string }[] }} */
	const { env } = JSON.parse(json.toString('utf8'));
	return Object.fromEntries(env.map(({ key: k, value }) => [k, value]));
}

/** dstack's guest API on a Unix socket: a quote that carries the report data, and the VM's info. */
async function startFakeDstack(
	/** @type {string} */ socketPath,
	/** @type {string} */ composeHash
) {
	const server = createServer(async (req, res) => {
		const body = await readJson(req).catch(() => ({}));
		const send = (/** @type {any} */ b) => {
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(b));
		};
		if (req.url === '/GetQuote') {
			const data = Buffer.from(String(body.report_data ?? ''), 'hex');
			return send({ quote: Buffer.concat([QUOTE_MARK, data]).toString('hex'), event_log: '[]' });
		}
		if (req.url === '/Info')
			return send({
				tcb_info: {
					mrtd: '00'.repeat(48),
					rtmr0: '00'.repeat(48),
					rtmr1: '00'.repeat(48),
					rtmr2: '00'.repeat(48),
					rtmr3: '00'.repeat(48),
					compose_hash: composeHash,
					event_log: []
				}
			});
		res.writeHead(404).end();
	});
	await listen(server, socketPath);
	return { close: () => closeServer(server) };
}

/**
 * Phala Cloud with its KMS, and Le Space's launcher (the real one) on top.
 * A VM is "booted" in this process: the env decrypted, sort-secrets.mjs and
 * registrar.mjs run against the launcher; `vm.ready` resolves with its run
 * directory once the registrar has sorted the secrets in (or gave up).
 *
 * @param {{ near: Awaited<ReturnType<typeof startFakeNear>>, origin: string, tickMs?: number }} o
 */
export async function startFakePhala({ near, origin, tickMs = 500 }) {
	const kmsKey = secp256k1.utils.randomSecretKey();
	const kmsPublicKey = Buffer.from(secp256k1.getPublicKey(kmsKey, true)).toString('hex');
	const dir = await mkdtemp(join(tmpdir(), 'belege-e2e-phala-'));
	/** @type {Map<string, { envKey: import('node:crypto').KeyObject, envPublicKey: string, composeHash: string }>} app id → its env key */
	const apps = new Map();
	/** @type {Map<string, { id: string, appId: string, run: string, env: Record<string, string> | null, removed: boolean, ready: Promise<{ run: string, secrets: boolean }>, log: string[] }>} */
	const vms = new Map();
	/** @type {{ close: () => Promise<unknown> }[]} */
	const sockets = [];
	let launcherUrl = '';

	/** The KMS's signature over the env key (dstack's verifyEnvEncryptPublicKey), r ‖ s ‖ v. */
	const signEnvKey = (/** @type {string} */ appId, /** @type {string} */ publicKey) => {
		const message = Buffer.concat([
			Buffer.from('dstack-env-encrypt-pubkey:'),
			Buffer.from(appId, 'hex'),
			Buffer.from(publicKey, 'hex')
		]);
		const sig = secp256k1.sign(keccak_256(message), kmsKey, {
			prehash: false,
			format: 'recovered'
		});
		return Buffer.concat([sig.subarray(1), sig.subarray(0, 1)]).toString('hex');
	};

	/** @param {string} id @param {string} appId @param {string} encryptedEnv */
	function boot(id, appId, encryptedEnv) {
		const app = /** @type {any} */ (apps.get(appId));
		const run = join(dir, id);
		/** @type {string[]} */
		const log = [];
		const vm = {
			id,
			appId,
			run,
			env: /** @type {Record<string, string> | null} */ (null),
			removed: false,
			log
		};
		vm.ready = (async () => {
			// What dstack hands the container, then the entrypoint's two phases.
			vm.env = decryptEnv(encryptedEnv, app.envKey);
			sortSecrets(run, { BELEGE_BRIDGE_SECRETS: vm.env.BELEGE_BRIDGE_SECRETS });
			const socketPath = join(dir, `${id}.sock`);
			sockets.push(await startFakeDstack(socketPath, app.composeHash));
			const r = await register({
				run,
				launcher: launcherUrl,
				socketPath,
				log: (l) => log.push(l),
				pollMs: 300,
				timeoutMs: 5 * 60_000
			});
			return { run, secrets: Boolean(r?.secrets) };
		})();
		vms.set(id, /** @type {any} */ (vm));
	}

	/** @type {typeof fetch} */
	const phalaFetch = async (input, init = {}) => {
		const url = String(input);
		const method = init.method ?? 'GET';
		const json = (/** @type {number} */ status, /** @type {any} */ body) =>
			new Response(status === 204 ? null : JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
		if (url === VERIFY)
			return json(200, { quote_collateral: { tcb_info: '{}', qe_identity: '{}' } });
		if (!url.startsWith(API)) return json(404, { message: 'not Phala' });
		const path = url.slice(API.length);
		const body = typeof init.body === 'string' ? JSON.parse(init.body) : {};
		if (path === '/cvms/provision' && method === 'POST') {
			const appId = randomBytes(20).toString('hex');
			const { privateKey, publicKey } = generateKeyPairSync('x25519');
			const envPublicKey = publicKey
				.export({ format: 'der', type: 'spki' })
				.subarray(12)
				.toString('hex');
			// Phala adds its own pre-launch script, so the hash is Phala's to say.
			const composeHash = sha256(JSON.stringify(body.compose_file)).toString('hex');
			apps.set(appId, { envKey: privateKey, envPublicKey, composeHash });
			return json(200, {
				app_id: appId,
				compose_hash: composeHash,
				app_env_encrypt_pubkey: envPublicKey,
				kms_info: { slug: FAKE_KMS_SLUG }
			});
		}
		const kms = new RegExp(`^/kms/${FAKE_KMS_SLUG}/pubkey/([0-9a-f]{40})$`).exec(path);
		if (kms && method === 'GET') {
			const app = apps.get(kms[1]);
			if (!app) return json(404, { message: 'no such app' });
			return json(200, {
				public_key: app.envPublicKey,
				signature: signEnvKey(kms[1], app.envPublicKey)
			});
		}
		if (path === '/cvms' && method === 'POST') {
			const app = apps.get(body.app_id);
			if (!app || app.composeHash !== body.compose_hash)
				return json(400, { message: 'no such app or compose' });
			const id = `e2e-vm-${vms.size + 1}`;
			boot(id, body.app_id, String(body.encrypted_env));
			return json(200, { id, status: 'starting' });
		}
		const cvm = /^\/cvms\/([A-Za-z0-9_-]+)$/.exec(path);
		if (cvm && method === 'DELETE') {
			const vm = vms.get(cvm[1]);
			if (!vm) return json(404, { message: 'no such VM' });
			vm.removed = true;
			return json(204, null);
		}
		return json(404, { message: 'not found' });
	};

	const launcher = createLauncher({
		near: /** @type {any} */ (near.launcherSide),
		phala: phalaClient({ apiKey: 'e2e-not-a-key', fetchImpl: phalaFetch }),
		provisionBody: () =>
			provisionBody(FAKE_BRIDGE_IMAGE, { launcherUrl: 'https://launcher.example.com' }),
		log: () => {}
	});
	const server = launcherServer(launcher, { origins: [origin], log: () => {} });
	await listen(server, { port: 0, host: '127.0.0.1' });
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	launcherUrl = `http://127.0.0.1:${port}`;

	let ticking = false;
	const timer = setInterval(async () => {
		if (ticking) return;
		ticking = true;
		await launcher.tick().catch(() => {});
		ticking = false;
	}, tickMs);

	return {
		launcherUrl,
		kms: { [FAKE_KMS_SLUG]: kmsPublicKey },
		vms,
		launcher,
		/** The compose hash a provision gives (the same for every books): what the contract approves. */
		composeHash: () =>
			sha256(
				JSON.stringify(
					provisionBody(FAKE_BRIDGE_IMAGE, { launcherUrl: 'https://launcher.example.com' })
						.compose_file
				)
			).toString('hex'),
		async close() {
			clearInterval(timer);
			await closeServer(server);
			for (const s of sockets) await s.close();
			await rm(dir, { recursive: true, force: true });
		}
	};
}
