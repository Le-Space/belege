// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The launcher (#696): starts and stops the hosted bridge on Phala when its
// books ask on NEAR, and hands the bridge's quote to the contract.
//
//   1. The books call request_start on the contract.            (on chain)
//   2. tick(): the launcher sees the open start, provisions the bridge's
//      compose on Phala and keeps the app's env key.
//   3. The browser fetches that key with the KMS's signature over it
//      (startInfo), checks the signature, encrypts the start (bridge_start,
//      nothing secret) to it and uploads it, signed with a key of the books
//      (uploadEnv). The launcher checks the signature and the key on chain,
//      then creates the VM.
//   4. The VM's registrar makes a key of its own and posts its quote, which
//      binds that key to the start (quote): the launcher checks it answers the
//      open start, fetches the collateral and calls register_bridge, paying
//      the gas. The contract checks the quote and keeps the key's hash.
//   5. The browser sees the VM attested on NEAR, checks the intake key the
//      launcher shows against the hash there, seals the bridge's secrets to
//      it and uploads them, signed (uploadSecrets). The registrar fetches
//      them (secretsFor) and the bridge starts. The launcher never sees them.
//   6. A stop (request_stop): the launcher deletes the VM and answers the
//      request (ack_request). So does a start nobody finishes in time.
//
// State is in memory: after a restart, open starts are provisioned again and
// running VMs are found by name (belege-bridge-<books>).

import { createHash, createPublicKey, verify } from 'node:crypto';
import { base58 } from '@scure/base';

export const ENV_DOMAIN = 'belege-bridge/env/1';
export const SECRETS_DOMAIN = 'belege-bridge/secrets/1';
/** A start that has no env after this long, or no quote after its VM was made, is given up. */
export const START_TIMEOUT_MS = 10 * 60_000;
const MAX_ENV_HEX = 512 * 1024;
/** The bridge's secrets: bridge.json with many devices, a sealed file, the accounts. */
const MAX_SECRETS_HEX = 2 * 1024 * 1024;

/**
 * What the books sign to hand the launcher their encrypted env.
 *
 * @param {string} books @param {string} atMs @param {string} encryptedEnv hex
 */
export function envMessage(books, atMs, encryptedEnv) {
	const digest = createHash('sha256').update(encryptedEnv).digest('hex');
	return `${ENV_DOMAIN}\n${books}\n${atMs}\n${digest}`;
}

/**
 * What the books sign to hand the attested VM its sealed secrets.
 *
 * @param {string} books @param {string} atMs @param {string} sealed hex
 */
export function secretsMessage(books, atMs, sealed) {
	const digest = createHash('sha256').update(sealed).digest('hex');
	return `${SECRETS_DOMAIN}\n${books}\n${atMs}\n${digest}`;
}

/**
 * @param {string} publicKey ed25519:<base58>
 * @param {string} message
 * @param {string} signature base64
 */
export function verifyEd25519(publicKey, message, signature) {
	const m = /^ed25519:([1-9A-HJ-NP-Za-km-z]{43,44})$/.exec(publicKey);
	if (!m) return false;
	const raw = base58.decode(m[1]);
	if (raw.length !== 32) return false;
	const key = createPublicKey({
		key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), Buffer.from(raw)]),
		format: 'der',
		type: 'spki'
	});
	try {
		return verify(null, Buffer.from(message), key, Buffer.from(signature, 'base64'));
	} catch {
		return false;
	}
}

/**
 * @param {object} o
 * @param {ReturnType<typeof import('./near.js').nearClient>} o.near
 * @param {ReturnType<typeof import('./phala.js').phalaClient>} o.phala
 * @param {(books: string) => any} o.provisionBody the compose for the released image (provision.mjs)
 * @param {(books: string) => Promise<boolean>} [o.mayStart] the books' Credits; true for the hackathon
 * @param {() => number} [o.now]
 * @param {(line: string) => void} [o.log]
 */
export function createLauncher({
	near,
	phala,
	provisionBody,
	mayStart = async () => true,
	now = Date.now,
	log = (l) => console.error(`[launcher] ${l}`)
}) {
	/** @type {Map<string, { atMs: string, appId?: string, composeHash?: string, envPublicKey?: string, kms?: string, envKeySignature?: string, vmId?: string, since: number, phase: string }>} */
	const starts = new Map();
	/** @type {Map<string, { vmId: string, atMs: string, intakeKey: string, since: number, sealed: string | null }>} books → a registered VM */
	const running = new Map();

	/** Checks the books' signature and that the key is theirs on chain. @param {string} books @param {string} message @param {any} body */
	async function signedByBooks(books, message, body) {
		if (!verifyEd25519(String(body.public_key), message, String(body.signature ?? '')))
			return { status: 403, error: 'bad signature' };
		if (!(await near.keyBelongsTo(books, String(body.public_key))))
			return { status: 403, error: 'not a key of these books' };
		return null;
	}

	/** @param {string} books @param {string} atMs @param {string} outcome */
	async function giveUp(books, atMs, outcome) {
		const s = starts.get(books);
		if (s?.vmId) await phala.remove(s.vmId).catch((e) => log(`delete failed: ${e.message}`));
		starts.delete(books);
		await near.ack({ books, atMs, outcome }).catch((e) => log(`ack failed: ${e.message}`));
		log(`${books}: start ${atMs} given up (${outcome})`);
	}

	return {
		/** For tests and the status page. */
		state: () => ({
			starts: Object.fromEntries(starts),
			running: Object.fromEntries([...running].map(([b, r]) => [b, r.vmId]))
		}),

		/** One look at the contract's open requests. */
		async tick() {
			const open = await near.requests();
			const seen = new Set();
			for (const { books, request } of open) {
				seen.add(books);
				const atMs = String(request.at_ms);
				if (request.kind === 'Stop') {
					const vm = running.get(books)?.vmId ?? starts.get(books)?.vmId;
					if (vm) await phala.remove(vm);
					running.delete(books);
					starts.delete(books);
					await near.ack({ books, atMs, outcome: vm ? 'stopped' : 'nothing ran' });
					log(`${books}: stopped`);
					continue;
				}
				const s = starts.get(books);
				if (s && s.atMs === atMs) {
					if (now() - s.since > START_TIMEOUT_MS)
						await giveUp(books, atMs, s.vmId ? 'no quote in time' : 'no env in time');
					continue;
				}
				// A new start (or a newer one): the old VM goes.
				if (s?.vmId) await phala.remove(s.vmId).catch(() => {});
				const old = running.get(books);
				if (old) {
					await phala.remove(old.vmId).catch(() => {});
					running.delete(books);
				}
				if (!(await mayStart(books))) {
					await near.ack({ books, atMs, outcome: 'no credits' });
					continue;
				}
				const p = await phala.provision(provisionBody(books));
				starts.set(books, { atMs, ...p, since: now(), phase: 'waiting for env' });
				log(`${books}: start ${atMs} provisioned`);
			}
			// Starts the contract no longer lists were answered (registered) or replaced.
			for (const books of starts.keys()) if (!seen.has(books)) starts.delete(books);
			// A VM whose secrets never came is given up like a start.
			for (const [books, r] of running)
				if (!r.sealed && now() - r.since > START_TIMEOUT_MS) {
					await phala.remove(r.vmId).catch((e) => log(`delete failed: ${e.message}`));
					running.delete(books);
					log(`${books}: no secrets in time, VM deleted`);
				}
		},

		/** @param {string} books */
		startInfo(books) {
			const r = running.get(books);
			if (r)
				return {
					at_ms: r.atMs,
					phase: r.sealed ? 'secrets handed over' : 'attested',
					intake_key: r.intakeKey
				};
			const s = starts.get(books);
			if (!s?.envPublicKey) return null;
			return {
				at_ms: s.atMs,
				app_id: s.appId,
				compose_hash: s.composeHash,
				env_public_key: s.envPublicKey,
				kms: s.kms,
				env_key_signature: s.envKeySignature,
				phase: s.phase
			};
		},

		/**
		 * @param {string} books
		 * @param {{ at_ms: string, encrypted_env: string, public_key: string, signature: string }} body
		 */
		async uploadEnv(books, body) {
			const s = starts.get(books);
			if (!s || s.atMs !== String(body?.at_ms)) return { status: 409, error: 'no such start' };
			if (s.vmId) return { status: 409, error: 'already started' };
			const env = String(body.encrypted_env ?? '');
			if (!/^[0-9a-f]+$/.test(env) || env.length > MAX_ENV_HEX)
				return { status: 400, error: 'bad env' };
			const refused = await signedByBooks(books, envMessage(books, s.atMs, env), body);
			if (refused) return refused;
			const vm = await phala.create({
				appId: /** @type {string} */ (s.appId),
				composeHash: /** @type {string} */ (s.composeHash),
				encryptedEnv: env
			});
			s.vmId = vm.id;
			s.since = now();
			s.phase = 'booting';
			log(`${books}: VM created`);
			return { status: 202, body: { phase: s.phase } };
		},

		/**
		 * The VM's registrar.
		 *
		 * @param {{ books: string, start_at_ms: string, intake_key: string, quote: string, tcb_info: any }} body
		 */
		async quote(body) {
			const books = String(body?.books ?? '');
			const s = starts.get(books);
			if (!s?.vmId || s.atMs !== String(body.start_at_ms))
				return { status: 409, error: 'no such start' };
			const intakeKey = String(body.intake_key ?? '');
			if (!/^[0-9a-f]{64}$/.test(intakeKey)) return { status: 400, error: 'bad intake key' };
			const intakeKeyHash = createHash('sha256')
				.update(Buffer.from(intakeKey, 'hex'))
				.digest('hex');
			const quoteHex = String(body.quote ?? '').replace(/^0x/, '');
			if (!/^[0-9a-f]+$/.test(quoteHex) || quoteHex.length > 64 * 1024)
				return { status: 400, error: 'bad quote' };
			const tcb = typeof body.tcb_info === 'string' ? JSON.parse(body.tcb_info) : body.tcb_info;
			const attestation = {
				quote: [...Buffer.from(quoteHex, 'hex')],
				collateral: await phala.collateral(quoteHex),
				tcb_info: {
					mrtd: tcb.mrtd ?? '',
					rtmr0: tcb.rtmr0 ?? '',
					rtmr1: tcb.rtmr1 ?? '',
					rtmr2: tcb.rtmr2 ?? '',
					rtmr3: tcb.rtmr3 ?? '',
					os_image_hash: tcb.os_image_hash ?? '',
					compose_hash: tcb.compose_hash ?? '',
					device_id: tcb.device_id ?? '',
					app_compose: tcb.app_compose ?? '',
					event_log: (tcb.event_log ?? []).map((/** @type {any} */ e) => ({
						imr: e.imr,
						event_type: e.event_type,
						digest: e.digest,
						event: e.event,
						event_payload: e.event_payload
					}))
				}
			};
			await near.registerBridge({ books, attestation, intakeKeyHash });
			running.set(books, { vmId: s.vmId, atMs: s.atMs, intakeKey, since: now(), sealed: null });
			starts.delete(books);
			log(`${books}: bridge registered`);
			return { status: 200, body: { registered: true } };
		},

		/**
		 * The browser's secrets, sealed to the attested VM's intake key.
		 *
		 * @param {string} books
		 * @param {{ at_ms: string, sealed: string, public_key: string, signature: string }} body
		 */
		async uploadSecrets(books, body) {
			const r = running.get(books);
			if (!r || r.atMs !== String(body?.at_ms)) return { status: 409, error: 'no attested VM' };
			if (r.sealed) return { status: 409, error: 'already handed over' };
			const sealed = String(body.sealed ?? '');
			if (!/^[0-9a-f]+$/.test(sealed) || sealed.length > MAX_SECRETS_HEX)
				return { status: 400, error: 'bad secrets' };
			const refused = await signedByBooks(books, secretsMessage(books, r.atMs, sealed), body);
			if (refused) return refused;
			r.sealed = sealed;
			log(`${books}: secrets ready for the VM`);
			return { status: 202, body: { phase: 'secrets handed over' } };
		},

		/**
		 * The VM's registrar fetches its sealed secrets (only it can open them).
		 *
		 * @param {string} books @param {string} atMs
		 */
		secretsFor(books, atMs) {
			const r = running.get(books);
			if (!r || r.atMs !== String(atMs) || !r.sealed) return null;
			return { sealed: r.sealed };
		}
	};
}
