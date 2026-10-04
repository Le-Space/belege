// A fake Aleph API on 127.0.0.1 for tests: balance, credit history (with its
// filters and pages), its summary, and messages. Every address, hash and
// amount here is made up.
//
// For the backup (aleph-backup.js) it is also Aleph's IPFS host and takes
// STORE messages, as strictly as the real ones were measured (2026-10-02 and
// 2026-10-03):
//   POST /api/v0/add       multipart `file` → one JSON line { Name, Hash, Size }
//   POST /api/v0/messages  { message, sync }: a STORE whose item_hash is the
//                          sha-256 of its content, whose content names a CID
//                          that was added, and whose signature (personal_sign)
//                          is the sender's → 200 `processed`. A wrong
//                          signature → 202 `pending`, as Aleph answers before
//                          it rejects the message; a malformed one → 422.
//                          The content's `address` is the paying account: the
//                          sender itself, or an owner whose `security`
//                          aggregate lets the sender send STORE on that
//                          channel (otherwise 202, then `rejected`). With
//                          `payment: { type: 'credit' }` the owner needs
//                          credit for a day of the file, about 54 credits per
//                          MiB (otherwise 202, then `rejected` with error 6
//                          and the amounts, as Aleph answered); without a
//                          payment Aleph books `hold` and processes it.
//                          An AGGREGATE on channel `security`, key
//                          `security`, sent by the account itself, sets that
//                          account's authorizations.
//   GET  /api/v0/messages/<item hash>   a STORE's or AGGREGATE's status, with
//                          `error_code` and `details` when rejected
//   GET  /api/v0/aggregates/<address>.json?keys=security   the authorizations
//   GET  /api/v0/messages.json   STOREs by `addresses` (the sender) or
//                          `owners` (the paying account), and `channels`
import http from 'node:http';
import { createHash } from 'node:crypto';

import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { base58 } from '@scure/base';

import { toChecksumAddress } from '../../src/chains/evm.js';
import { addressOf } from '../../src/aleph-backup.js';

/** The Aleph account a backup key pays from, for a spec that funds it. */
export const alephAccountOf = addressOf;

/** A CIDv0-shaped id for bytes (sha-256 multihash, base58). @param {Uint8Array} bytes */
const cidOf = (bytes) =>
	base58.encode(new Uint8Array([0x12, 0x20, ...createHash('sha256').update(bytes).digest()]));

/** The address that signed a personal_sign message, or null. @param {string} signature @param {string} message */
function signerOf(signature, message) {
	try {
		const sig = Buffer.from(signature.replace(/^0x/, ''), 'hex');
		if (sig.length !== 65) return null;
		const body = new TextEncoder().encode(message);
		const prefix = new TextEncoder().encode(`\x19Ethereum Signed Message:\n${body.length}`);
		const digest = keccak_256(new Uint8Array([...prefix, ...body]));
		const recovered = new Uint8Array([sig[64] - 27, ...sig.subarray(0, 64)]);
		const pub = secp256k1.Point.fromBytes(
			secp256k1.recoverPublicKey(recovered, digest, { prehash: false })
		).toBytes(false);
		return toChecksumAddress(
			`0x${Buffer.from(keccak_256(pub.slice(1)).slice(-20)).toString('hex')}`
		);
	} catch {
		return null;
	}
}

/** A made-up 0x address from a phrase. @param {string} phrase */
export const fakeAlephAddress = (phrase) =>
	`0x${createHash('sha256').update(`aleph ${phrase}`).digest('hex').slice(0, 40)}`;

/** A made-up item hash. @param {string} phrase */
export const fakeItemHash = (phrase) => createHash('sha256').update(`item ${phrase}`).digest('hex');

/**
 * Credits a day of keeping costs, per MiB: 107.804934183756585600 for 2 MiB,
 * as Aleph asked on 2026-10-03.
 */
export const FAKE_CREDITS_PER_MIB_DAY = 107.8049341837565856 / 2;

/**
 * @typedef {object} FakeRow
 * @property {string} at ISO
 * @property {number} amount credits; negative leaves
 * @property {string} [paymentMethod] `credit_expense` for consumption
 * @property {string} [originRef] `storage`, or a billing message's hash
 * @property {string} [origin] a billed instance's item hash, or a transfer's other account
 * @property {string} [price] USD per credit, a purchase's
 * @property {string} [txHash]
 * @property {number} [count] resources billed
 * @property {number} [sizeMib]
 */

/**
 * @param {object} options
 * @param {Record<string, { balance: number, rows: FakeRow[] }>} options.accounts by address, in any
 *   case; answered only when asked in the EIP-55 checksummed form, as Aleph does (a lower-case
 *   address gets a balance of 0 and no history)
 * @param {Record<string, { type: string, name: string }>} [options.messages] by item hash
 */
export async function startFakeAleph({ accounts: given, messages = {} }) {
	const accounts = Object.fromEntries(
		Object.entries(given).map(([address, account]) => [toChecksumAddress(address), account])
	);
	/** @type {string[]} */
	const calls = [];
	/** What was uploaded, by id. @type {Map<string, Uint8Array>} */
	const added = new Map();
	/** The STORE messages taken: their sender, CID, channel and status. */
	const stores =
		/** @type {{ sender: string, cid: string, channel: string, status: string, owner: string, time: number, itemHash: string, payment: string | null, errorCode?: number, details?: unknown }[]} */ ([]);
	/** Each account's `security` authorizations, by checksummed address. @type {Map<string, any[]>} */
	const authorizations = new Map();
	/** The AGGREGATE messages taken, by item hash. @type {Map<string, { status: string }>} */
	const aggregates = new Map();
	/** Does `owner` let `sender` send a STORE on `channel`? @param {string} owner @param {string} sender @param {string} channel */
	const allowed = (owner, sender, channel) =>
		(authorizations.get(toChecksumAddress(owner)) ?? []).some(
			(a) =>
				String(a?.address).toLowerCase() === sender.toLowerCase() &&
				(!a.types?.length || a.types.includes('STORE')) &&
				(!a.channels?.length || a.channels.includes(channel)) &&
				(!a.chain || a.chain === 'ETH')
		);
	const server = http.createServer(async (req, res) => {
		const url = new URL(String(req.url), 'http://x');
		calls.push(url.pathname.replace(/0x[0-9a-fA-F]{40}/g, '<address>'));
		const reply = (/** @type {number} */ status, /** @type {unknown} */ body) => {
			res.writeHead(status, { 'Content-Type': 'application/json' });
			res.end(JSON.stringify(body));
		};
		const ipfs = /^\/ipfs\/([A-Za-z0-9]+)$/.exec(url.pathname);
		if (req.method === 'GET' && ipfs) {
			// Aleph's gateway: the bytes as they were added, readable by any page.
			const bytes = added.get(ipfs[1]);
			if (!bytes) return reply(404, { error: 'not found' });
			res.writeHead(200, {
				'Content-Type': 'application/octet-stream',
				'Access-Control-Allow-Origin': '*'
			});
			return res.end(Buffer.from(bytes));
		}
		if (req.method === 'GET' && url.pathname === '/api/v0/messages.json') {
			// Only the filters the bridge sends; and only messages Aleph kept.
			// `addresses` matches the sender, `owners` the paying account (measured).
			const senders = (url.searchParams.get('addresses') ?? '').split(',').filter(Boolean);
			const owners = (url.searchParams.get('owners') ?? '').split(',').filter(Boolean);
			const channels = (url.searchParams.get('channels') ?? '').split(',').filter(Boolean);
			if (url.searchParams.get('msgTypes') !== 'STORE') return reply(400, { error: 'msgTypes' });
			return reply(200, {
				messages: stores
					.filter((s) => s.status === 'processed')
					.filter((s) => !senders.length || senders.includes(s.sender))
					.filter((s) => !owners.length || owners.includes(s.owner))
					.filter((s) => !channels.length || channels.includes(s.channel))
					.map((s) => ({
						type: 'STORE',
						item_hash: s.itemHash,
						sender: s.sender,
						channel: s.channel,
						content: {
							address: s.owner,
							item_type: 'ipfs',
							item_hash: s.cid,
							...(s.payment ? { payment: { type: s.payment } } : {}),
							time: s.time
						}
					})),
				pagination_page: 1,
				pagination_total: stores.length,
				pagination_per_page: 50
			});
		}
		if (req.method === 'POST' && url.pathname === '/api/v0/add') {
			const form = await new Request('http://x', {
				method: 'POST',
				headers: { 'content-type': String(req.headers['content-type'] ?? '') },
				body: /** @type {any} */ (req),
				duplex: 'half'
			})
				.formData()
				.catch(() => null);
			const file = form?.get('file');
			if (!file || typeof file === 'string') return reply(400, { Message: 'no file' });
			const bytes = new Uint8Array(await file.arrayBuffer());
			const hash = cidOf(bytes);
			added.set(hash, bytes);
			// As Aleph's host answers: any page may read it (the app uploads from the browser).
			res.writeHead(200, {
				'Content-Type': 'application/json',
				'Access-Control-Allow-Origin': '*'
			});
			return res.end(
				`${JSON.stringify({ Name: file.name, Hash: hash, Size: String(bytes.length) })}\n`
			);
		}
		if (req.method === 'POST' && url.pathname === '/api/v0/messages') {
			/** @type {Buffer[]} */ const chunks = [];
			for await (const c of req) chunks.push(c);
			const m = /** @type {any} */ (
				(() => {
					try {
						return JSON.parse(Buffer.concat(chunks).toString('utf8')).message;
					} catch {
						return null;
					}
				})()
			);
			let content;
			try {
				content = JSON.parse(m?.item_content);
			} catch {
				return reply(422, { error: 'item_content is not JSON' });
			}
			const hashOk =
				m.item_hash === createHash('sha256').update(String(m.item_content)).digest('hex');
			const signed = signerOf(
				String(m.signature ?? ''),
				[m.chain, m.sender, m.type, m.item_hash].join('\n')
			);
			const signatureOk = signed === toChecksumAddress(String(m.sender));
			const answer = (/** @type {string} */ status) =>
				reply(status === 'processed' ? 200 : 202, {
					publication_status: { status: 'success', failed: [] },
					// Aleph answers before it has decided: anything but a processed message is pending here.
					message_status: status === 'processed' ? 'processed' : 'pending'
				});

			if (m?.type === 'AGGREGATE') {
				const shapeOk =
					hashOk &&
					m.chain === 'ETH' &&
					m.item_type === 'inline' &&
					m.channel === 'security' &&
					content?.key === 'security' &&
					content?.address === m.sender &&
					Array.isArray(content?.content?.authorizations);
				if (!shapeOk) return reply(422, { error: 'not an AGGREGATE this fake takes' });
				const status = signatureOk ? 'processed' : 'rejected';
				aggregates.set(m.item_hash, { status });
				if (status === 'processed') {
					authorizations.set(toChecksumAddress(m.sender), content.content.authorizations);
				}
				return answer(status);
			}

			const shapeOk =
				hashOk &&
				m.chain === 'ETH' &&
				m.type === 'STORE' &&
				m.item_type === 'inline' &&
				typeof m.channel === 'string' &&
				typeof m.time === 'number' &&
				content?.item_type === 'ipfs' &&
				typeof content?.address === 'string' &&
				added.has(content?.item_hash) &&
				(content.payment === undefined || ['credit', 'hold'].includes(content.payment?.type));
			if (!shapeOk) return reply(422, { error: 'not a STORE message this fake takes' });
			const payment = content.payment?.type ?? null;
			/** @type {{ status: string, errorCode?: number, details?: unknown }} */
			let verdict = { status: 'processed' };
			if (!signatureOk) verdict = { status: 'pending' };
			else if (content.address !== m.sender && !allowed(content.address, m.sender, m.channel)) {
				verdict = { status: 'rejected', errorCode: 3, details: { errors: ['not authorized'] } };
			} else if (payment === 'credit') {
				// The paying account is the owner, never the sender (measured 2026-10-03).
				const credits = accounts[toChecksumAddress(content.address)]?.balance ?? 0;
				const mib = /** @type {Uint8Array} */ (added.get(content.item_hash)).length / 1048576;
				const required = mib * FAKE_CREDITS_PER_MIB_DAY;
				if (credits < required) {
					verdict = {
						status: 'rejected',
						errorCode: 6,
						details: {
							errors: [
								{
									account_credits: String(credits),
									min_runtime_days: 1,
									required_credits: required.toFixed(18)
								}
							]
						}
					};
				}
			}
			stores.push({
				sender: m.sender,
				cid: content.item_hash,
				channel: m.channel,
				owner: content.address,
				time: content.time,
				itemHash: m.item_hash,
				payment,
				...verdict
			});
			return answer(verdict.status);
		}
		if (
			req.method === 'GET' &&
			/^\/api\/v0\/aggregates\/0x[0-9a-fA-F]{40}\.json$/.test(url.pathname)
		) {
			const owner = url.pathname.slice('/api/v0/aggregates/'.length, -'.json'.length);
			const list = authorizations.get(owner);
			// Aleph keys accounts by their checksummed form, as for balances.
			if (!list || owner !== toChecksumAddress(owner))
				return reply(404, { error: 'No aggregate found' });
			return reply(200, { address: owner, data: { security: { authorizations: list } } });
		}
		const m =
			/^\/api\/v0\/addresses\/(0x[0-9a-fA-F]{40})\/(balance|credit_history(?:\/summary)?)$/.exec(
				url.pathname
			);
		if (m) {
			const account = accounts[m[1]];
			if (!account) {
				if (m[2] === 'balance') return reply(404, { error: 'unknown address' });
				if (m[2] === 'credit_history/summary') {
					return reply(200, {
						address: m[1],
						entry_count: 0,
						total_amount: 0,
						total_incoming: 0,
						total_outgoing: 0
					});
				}
				return reply(404, { error: 'no history' });
			}
			if (m[2] === 'balance') {
				return reply(200, {
					address: m[1],
					balance: 0,
					locked_amount: 0,
					credit_balance: account.balance,
					details: {},
					credit_balance_details: {}
				});
			}
			const start = Number(url.searchParams.get('startDate') ?? -Infinity);
			const end = Number(url.searchParams.get('endDate') ?? Infinity);
			const direction = url.searchParams.get('direction');
			const rows = account.rows
				.filter((r) => {
					const t = Date.parse(r.at) / 1000;
					return t >= start && t <= end;
				})
				.filter((r) => !direction || (direction === 'incoming' ? r.amount > 0 : r.amount < 0))
				.sort((a, b) => (a.at < b.at ? 1 : -1));
			if (m[2] === 'credit_history/summary') {
				const incoming = rows.filter((r) => r.amount > 0).reduce((n, r) => n + r.amount, 0);
				const outgoing = rows.filter((r) => r.amount < 0).reduce((n, r) => n + r.amount, 0);
				return reply(200, {
					address: m[1],
					entry_count: rows.length,
					total_amount: incoming + outgoing,
					total_incoming: incoming,
					total_outgoing: outgoing
				});
			}
			const per = Number(url.searchParams.get('pagination') ?? 100);
			const page = Number(url.searchParams.get('page') ?? 1);
			return reply(200, {
				address: m[1],
				credit_history: rows.slice((page - 1) * per, page * per).map((r, i) => ({
					amount: r.amount,
					price: r.price ?? null,
					bonus_amount: null,
					tx_hash: r.txHash ?? null,
					token: r.price ? 'USDC' : null,
					chain: r.price ? 'ETH' : null,
					provider: 'ALEPH',
					origin: r.origin ?? null,
					origin_ref: r.originRef ?? null,
					payment_method: r.paymentMethod ?? (r.price ? 'token' : 'credit_transfer'),
					credit_ref: fakeItemHash(`ref ${r.at} ${i}`),
					credit_index: i,
					expense_count: r.count ?? null,
					expense_size_mib: r.sizeMib ?? null,
					expiration_date: null,
					message_timestamp: r.at
				})),
				pagination_page: page,
				pagination_total: rows.length,
				pagination_per_page: per
			});
		}
		const msg = /^\/api\/v0\/messages\/([0-9a-f]{64})$/.exec(url.pathname);
		const store = msg && stores.find((s) => s.itemHash === msg[1]);
		if (store) {
			return reply(200, {
				status: store.status,
				item_hash: store.itemHash,
				...(store.errorCode !== undefined ? { error_code: store.errorCode } : {}),
				...(store.details !== undefined ? { details: store.details } : {})
			});
		}
		const aggregate = msg && aggregates.get(msg[1]);
		if (aggregate) return reply(200, { status: aggregate.status, item_hash: msg[1] });
		if (msg && messages[msg[1]]) {
			const { type, name } = messages[msg[1]];
			return reply(200, {
				status: 'processed',
				message: { type, item_hash: msg[1], content: { metadata: { name } } }
			});
		}
		return reply(404, { error: 'not found' });
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		calls,
		added,
		stores,
		/** Put credits on an account, as a transfer would. @param {string} address @param {number} credits */
		fund(address, credits) {
			const key = toChecksumAddress(address);
			accounts[key] = { balance: credits, rows: accounts[key]?.rows ?? [] };
		},
		close: () =>
			new Promise((resolve) => {
				server.close(() => resolve(undefined));
				server.closeAllConnections?.();
			})
	};
}
