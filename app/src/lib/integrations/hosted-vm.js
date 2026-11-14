// Start and stop the hosted bridge's VM from this browser (#587): the books'
// Aleph key asks Aleph for a confidential instance of the published bridge
// image, and forgets it again to stop it. The unlock and pairing in between
// are hosted-bridge.js's (#585).
//
// Who pays (as Paperless anywhere's "Wer zahlt die VM?"):
//   - Le Space, from the books' package: Le Space Credits' sub-account
//     for these books holds the Aleph credits and is the INSTANCE's address;
//     the books' key sends the messages as its authorized delegate
//     (POST /v1/vm/authorize). Le Space pays and could stop the VM, nothing
//     more: the launch measurement still names the books' key, and only it
//     unlocks.
//   - the books' key itself (paperless-anywhere#7, pattern B): it is address
//     and sender, and pays from its own credits.
//
//   start: a confidential node from Aleph's node list → the INSTANCE (signed
//          here by the books' key, the launch measurement computed here for
//          the books' key pinned in it) → the node told → 443 forwarded
//   stop:  FORGET; the node stops the VM and drops it
//
// Every message is signed in this browser, as the backup's vault index is
// (backup/vault-index.js). The message shapes are relay-button's
// (@le-space/core), which paperless-anywhere starts its VMs with.

/** The VM: 2 vCPU, 2 GiB memory, 10 GiB disk, as "Bridge on a confidential node" runs it. */
export const HOSTED_VM = Object.freeze({ vcpus: 2, memoryMiB: 2048, rootfsSizeMiB: 10 * 1024 });

/** The Aleph channel the VM's messages go to. */
export const VM_CHANNEL = 'belege-bridge';

/** The sealed record of the VM's start: which instance, on which node, since when, at what price. */
export const VM_SETTING = 'bridge/hosted-vm';

/** Aleph takes a VM only when the payer holds this many hours of what it pays for. */
export const RESERVE_HOURS = 24;

/** Aleph's list of compute nodes, with what each reports about itself. */
export const CRN_LIST = 'https://crns-list.aleph.sh/crns.json?filter_inactive=true';

/**
 * An encrypted rootfs ignores it, and the image holds no SSH key; the
 * INSTANCE format wants one key.
 */
const NO_SSH_KEY =
	'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEJlbGVnZS1oYXNoZWQtYnJpZGdlLW5vLXNzaC1rZXk belege-hosted-bridge';

const HASH = /^[0-9a-f]{64}$/;
const REFUSED = ['rejected', 'forgotten'];
const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/** @param {string} text */
export async function sha256Hex(text) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * A node's base URL, if it is one to talk to: https, a name, no path. An
 * E2E build also takes the fake node on 127.0.0.1.
 *
 * @param {unknown} address
 * @param {{ loopback?: boolean }} [options]
 * @returns {string | null}
 */
export function nodeUrlOf(address, { loopback = false } = {}) {
	let url;
	try {
		url = new URL(String(address ?? ''));
	} catch {
		return null;
	}
	if (url.username || url.password || url.search || url.hash) return null;
	if (url.pathname !== '/' && url.pathname !== '') return null;
	if (loopback && url.protocol === 'http:' && url.hostname === '127.0.0.1') return url.origin;
	if (url.protocol !== 'https:') return null;
	// A name, never an address: no IPv4, no IPv6, no single label.
	if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) || /^[\d.]+$/.test(url.hostname)) {
		return null;
	}
	return url.origin;
}

/**
 * @typedef {{ hash: string, name: string, url: string, score: number, fits: boolean }} Node
 */

/**
 * The nodes that can run a confidential VM now, best first: those that say
 * so and have the room for this VM.
 *
 * @param {any} body the node list's JSON
 * @param {{ loopback?: boolean }} [options]
 * @returns {Node[]}
 */
export function confidentialNodes(body, { loopback = false } = {}) {
	/** @type {Node[]} */
	const out = [];
	for (const n of Array.isArray(body?.crns) ? body.crns : []) {
		if (n?.confidential_support !== true || n?.system_usage?.active === false) continue;
		const hash = String(n.hash ?? '');
		const url = nodeUrlOf(n.address, { loopback });
		if (!HASH.test(hash) || !url) continue;
		const u = n.system_usage ?? {};
		const freeVcpus = Math.floor((u.cpu?.count ?? 0) - (u.cpu?.load_average?.load1 ?? 0));
		const memKiB = Number(u.mem?.available_kB ?? 0);
		const diskKiB = Number(u.disk?.available_kB ?? 0);
		out.push({
			hash,
			name: String(n.name ?? '').trim() || hash.slice(0, 8),
			url,
			score: Number(n.score ?? 0),
			fits:
				freeVcpus >= HOSTED_VM.vcpus &&
				memKiB >= HOSTED_VM.memoryMiB * 1024 &&
				diskKiB >= HOSTED_VM.rootfsSizeMiB * 1024
		});
	}
	return out.sort((a, b) => Number(b.fits) - Number(a.fits) || b.score - a.score);
}

/**
 * @param {{ url?: string, fetch?: typeof fetch, loopback?: boolean }} [options]
 * @returns {Promise<Node[]>}
 */
export async function loadNodes({ url = CRN_LIST, fetch: f = fetch, loopback = false } = {}) {
	const res = await f(url, { cache: 'no-store' });
	if (!res.ok) throw new Error(`Aleph's node list answered ${res.status}`);
	return confidentialNodes(await res.json(), { loopback });
}

/** Who pays the VM: Le Space from the books' package, or the books' key itself. */
export const PAYERS = Object.freeze(['lespace', 'books']);

/**
 * The INSTANCE's content: the published image, confidential with the pins
 * computed for the books' key, on this node, paid in credits by `payer`.
 *
 * @param {{ payer: string, image: string, crn: string, trustedExecution: any, name: string, now?: number }} p
 */
export function instanceContent({ payer, image, crn, trustedExecution, name, now }) {
	if (!/^0x[0-9a-fA-F]{40}$/.test(String(payer ?? ''))) throw new Error('no payer address');
	if (!HASH.test(image)) throw new Error('the image is not a STORE hash');
	if (!HASH.test(crn)) throw new Error('the node is not a node hash');
	if (!Array.isArray(trustedExecution?.measurements) || !trustedExecution.measurements.length) {
		throw new Error('no launch measurement to pin');
	}
	return {
		address: payer,
		time: now ?? Date.now() / 1000,
		allow_amend: false,
		metadata: { name },
		authorized_keys: [NO_SSH_KEY],
		environment: {
			internet: true,
			aleph_api: true,
			hypervisor: 'qemu',
			reproducible: false,
			shared_cache: false,
			trusted_execution: trustedExecution
		},
		resources: { vcpus: HOSTED_VM.vcpus, memory: HOSTED_VM.memoryMiB, seconds: 30 },
		payment: { type: 'credit' },
		requirements: { node: { node_hash: crn } },
		volumes: [],
		rootfs: {
			parent: { ref: image, use_latest: true },
			persistence: 'host',
			size_mib: HOSTED_VM.rootfsSizeMiB
		}
	};
}

/** The port forward that lets Caddy answer on 443, in the payer's aggregate. @param {string} payer @param {string} instance @param {number} [now] */
export const forward443Content = (payer, instance, now) => ({
	address: payer,
	key: 'port-forwarding',
	content: { [instance]: { ports: { 443: { tcp: true, udp: false } } } },
	time: now ?? Date.now() / 1000
});

/** The FORGET that stops the VM. @param {string} payer @param {string} instance @param {number} [now] */
export const forgetContent = (payer, instance, now) => ({
	address: payer,
	time: now ?? Date.now() / 1000,
	hashes: [instance],
	aggregates: [],
	reason: 'belege: hosted bridge stopped'
});

/**
 * A message signed by `sign` (personal_sign over Aleph's verification
 * buffer), as Aleph takes it. The sender is the content's address, or a
 * delegate the address's `security` aggregate lets send this type.
 *
 * @param {{ type: 'INSTANCE' | 'AGGREGATE' | 'FORGET', content: any, sign: (payload: string) => string | Promise<string>, sender?: string, now?: number }} p
 */
export async function signedMessage({ type, content, sign, sender, now }) {
	const item_content = JSON.stringify(content);
	const unsigned = {
		sender: sender ?? content.address,
		chain: 'ETH',
		type,
		item_hash: await sha256Hex(item_content),
		item_type: 'inline',
		item_content,
		time: now ?? Date.now() / 1000,
		channel: VM_CHANNEL
	};
	const signature = await sign(
		[unsigned.chain, unsigned.sender, unsigned.type, unsigned.item_hash].join('\n')
	);
	return { ...unsigned, signature: signature.startsWith('0x') ? signature : `0x${signature}` };
}

/**
 * Send a message and wait until Aleph has processed it. Aleph may not answer
 * the synchronous send although it took the message; then its status says.
 *
 * @param {any} message
 * @param {{ apiHost: string, fetch?: typeof fetch, answerMs?: number, pollMs?: number, waitMs?: number }} p
 * @returns {Promise<string>} the item hash
 */
export async function sendMessage(
	message,
	{ apiHost, fetch: f = fetch, answerMs = 60_000, pollMs = 5_000, waitMs = 10 * 60_000 }
) {
	const what = message.type;
	/** @param {boolean} sync */
	const send = (sync) =>
		f(`${apiHost}/api/v0/messages`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ message, sync }),
			signal: AbortSignal.timeout(answerMs)
		});
	try {
		const response = await send(true);
		const answer = /** @type {any} */ (await response.json().catch(() => null));
		if (response.status === 422 || (!response.ok && response.status !== 202)) {
			throw new Error(`Aleph did not take the ${what}: ${response.status}`);
		}
		if (REFUSED.includes(answer?.message_status)) {
			throw new Error(`Aleph refused the ${what}: ${answer.message_status}`);
		}
		if (response.status === 200 && answer?.message_status === 'processed') {
			return message.item_hash;
		}
	} catch (e) {
		const name = /** @type {any} */ (e)?.name;
		if (!['TimeoutError', 'AbortError', 'TypeError'].includes(name)) throw e;
	}
	const until = Date.now() + waitMs;
	while (Date.now() < until) {
		await sleep(pollMs);
		const res = await f(`${apiHost}/api/v0/messages/${message.item_hash}`, {
			cache: 'no-store'
		}).catch(() => null);
		const body = res?.ok ? /** @type {any} */ (await res.json().catch(() => null)) : null;
		if (body?.status === 'processed') return message.item_hash;
		if (REFUSED.includes(body?.status)) {
			const why = body?.error_code === 6 ? ': too few credits' : '';
			throw new Error(`Aleph refused the ${what}${why}`);
		}
		if (res?.status === 404) await send(false).catch(() => null);
	}
	throw new Error(`Aleph did not process the ${what} in time`);
}

/**
 * The owner's credits.
 *
 * @param {string} owner @param {{ apiHost: string, fetch?: typeof fetch }} p
 */
export async function creditsOf(owner, { apiHost, fetch: f = fetch }) {
	const res = await f(`${apiHost}/api/v0/addresses/${owner}/balance`, { cache: 'no-store' });
	if (res.status === 404) return 0;
	if (!res.ok) throw new Error(`Aleph answered ${res.status} for the balance`);
	return Number(/** @type {any} */ (await res.json())?.credit_balance ?? 0);
}

/**
 * Credits per hour Aleph will charge for the INSTANCE, from its own estimate;
 * null when it cannot be asked.
 *
 * @param {any} message signed or not
 * @param {{ apiHost: string, fetch?: typeof fetch }} p
 * @returns {Promise<number | null>}
 */
export async function creditsPerHour(message, { apiHost, fetch: f = fetch }) {
	const unsigned = { ...message };
	delete unsigned.signature;
	const res = await f(`${apiHost}/api/v0/price/estimate`, {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ message: unsigned })
	}).catch(() => null);
	if (!res?.ok) return null;
	const perSecond = Number(/** @type {any} */ (await res.json().catch(() => null))?.cost);
	return perSecond > 0 ? Math.round(perSecond * 3600) : null;
}

/**
 * Ask the node to place the instance now. A node that has not yet seen the
 * INSTANCE answers 503; it is asked again.
 *
 * @param {string} nodeUrl @param {string} instance
 * @param {{ fetch?: typeof fetch, tries?: number, delayMs?: number }} [p]
 */
export async function notifyNode(
	nodeUrl,
	instance,
	{ fetch: f = fetch, tries = 10, delayMs = 3000 } = {}
) {
	let last = '';
	for (let i = 0; i < tries; i++) {
		if (i) await sleep(delayMs);
		const res = await f(`${nodeUrl}/control/allocation/notify`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ instance })
		}).catch((/** @type {any} */ e) => ({ ok: false, status: 0, why: String(e?.message ?? e) }));
		if (res.ok) return;
		last = `${/** @type {any} */ (res).status || /** @type {any} */ (res).why}`;
		if (res.status && res.status !== 503) break;
	}
	throw new Error(`the node did not take the VM (${last})`);
}

/**
 * The VM on its node: its state, the host port 443 is mapped to, and why the
 * node gave up starting it (its allocation `failed`, e.g. `startup_failed`);
 * null while the node does not list it.
 *
 * @param {string} nodeUrl @param {string} instance @param {{ fetch?: typeof fetch }} [p]
 * @returns {Promise<{ running: boolean, port443: number | null, failed?: { code: string, attempts: number } } | null>}
 */
export async function onNode(nodeUrl, instance, { fetch: f = fetch } = {}) {
	const res = await f(`${nodeUrl}/v2/about/executions/list`, { cache: 'no-store' }).catch(
		() => null
	);
	if (!res?.ok) return null;
	const entry = /** @type {any} */ (await res.json().catch(() => null))?.[instance];
	if (!entry) return null;
	const port = Number(entry.networking?.mapped_ports?.['443']?.host);
	const allocation = entry.allocation;
	const running = entry.running !== false && entry.status?.stopped_at == null;
	return {
		running,
		port443: Number.isInteger(port) && port > 0 && port < 65536 ? port : null,
		...(!running && allocation?.state === 'failed'
			? {
					failed: {
						code: String(allocation.error?.code ?? 'failed').slice(0, 40),
						attempts: Number(allocation.attempts) || 0
					}
				}
			: {})
	};
}

/**
 * Hours and credits since the start, from what the start recorded.
 *
 * @param {{ startedAt?: string, creditsPerHour?: number | null } | null | undefined} vm
 * @param {number} [now] ms
 */
export function usage(vm, now = Date.now()) {
	const since = Date.parse(String(vm?.startedAt ?? ''));
	if (!Number.isFinite(since)) return null;
	const hours = Math.max(0, (now - since) / 3_600_000);
	const perHour = Number(vm?.creditsPerHour);
	return { hours, credits: perHour > 0 ? Math.round(hours * perHour) : null };
}

/**
 * @typedef {{ hash: string, createdAt: string | null, crn: string | null, payer: string | null, name: string | null }} OwnInstance
 */

/**
 * The INSTANCEs `sender` sent that Aleph still holds (a FORGOTTEN one it no
 * longer lists), newest first: the books' key's VMs, whoever pays them.
 *
 * @param {string} sender the books' key's address
 * @param {{ apiHost: string, fetch?: typeof fetch, pagination?: number }} p
 * @returns {Promise<OwnInstance[]>}
 */
export async function listInstances(sender, { apiHost, fetch: f = fetch, pagination = 50 }) {
	if (!/^0x[0-9a-fA-F]{40}$/.test(String(sender ?? ''))) throw new Error('no sender address');
	const query = new URLSearchParams({
		msgTypes: 'INSTANCE',
		addresses: sender,
		pagination: String(pagination),
		page: '1'
	});
	const res = await f(`${apiHost}/api/v0/messages.json?${query}`, { cache: 'no-store' });
	if (!res.ok) throw new Error(`Aleph answered ${res.status} for the INSTANCE list`);
	const body = /** @type {any} */ (await res.json().catch(() => null));
	/** @type {OwnInstance[]} */
	const out = [];
	for (const m of Array.isArray(body?.messages) ? body.messages : []) {
		const hash = String(m?.item_hash ?? '');
		if (m?.type !== 'INSTANCE' || !HASH.test(hash)) continue;
		if (REFUSED.includes(String(m?.status ?? ''))) continue;
		if (String(m?.sender ?? '').toLowerCase() !== sender.toLowerCase()) continue;
		const content = m.content ?? {};
		const time = Number(m.time ?? content.time);
		const crn = String(content.requirements?.node?.node_hash ?? '');
		const payer = String(content.address ?? '');
		const name = content.metadata?.name;
		out.push({
			hash,
			createdAt: Number.isFinite(time) && time > 0 ? new Date(time * 1000).toISOString() : null,
			crn: HASH.test(crn) ? crn : null,
			payer: /^0x[0-9a-fA-F]{40}$/.test(payer) ? payer : null,
			name: typeof name === 'string' ? name.slice(0, 80) : null
		});
	}
	return out.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
}
