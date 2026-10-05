// An Akash wallet's deployments and what they cost (issue #305, step 2): for
// the monthly usage statement in the app.
//
// Deployments are paid in ACT (Akash's compute credit, minted from AKT by
// burn-mint, ~1 USD) through an escrow account per deployment. The node
// keeps every deployment of an owner, closed ones too, with its escrow state:
//   GET <rest>/akash/deployment/v1beta4/deployments/list?filters.owner=<a>
//     deployment.created_at   the block it was created in
//     escrow_account.state    transferred (paid to the providers so far),
//                             funds (left), settled_at (the last settlement;
//                             for a closed one, its end)
// Amounts are decimal coins in uact. The blocks' times come from the Akash
// Console indexer (`/v1/blocks/<height>`), as the node is pruned.
//
// What a deployment cost in a month is not kept per month on chain: the app
// spreads its transferred amount evenly over its time from creation to the
// last settlement, and says so on the statement.
//
// The log gets counts, never an address.

import { createJsonFetcher, WalletError } from './http.js';
import { unitsToDecimal } from './cosmos.js';

const LIMIT = 1000;

/**
 * `49.000000000000000000` (uact, a decimal coin) → 49n, rounded half up.
 *
 * @param {unknown} amount
 */
export function decUnits(amount) {
	const m = /^(\d+)(?:\.(\d+))?$/.exec(String(amount ?? '').trim());
	if (!m) return 0n;
	return BigInt(m[1]) + ((m[2] ?? '0')[0] >= '5' ? 1n : 0n);
}

/** @param {any} coins @param {string} denom */
const sumOf = (coins, denom) =>
	(Array.isArray(coins) ? coins : [])
		.filter((c) => c?.denom === denom)
		.reduce((n, c) => n + decUnits(c?.amount), 0n);

/**
 * @typedef {object} AkashDeployment
 * @property {string} dseq
 * @property {string} state active | closed
 * @property {number} createdHeight
 * @property {string | null} createdAt ISO, from the indexer
 * @property {number} settledHeight
 * @property {string | null} settledAt ISO, from the indexer
 * @property {string} transferred ACT paid to the providers, decimal
 * @property {string} funds ACT left in the escrow, decimal
 */

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs]
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createAkashDeploymentsClient({ fetch: f = fetch, timeoutMs, sleep } = {}) {
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep });
	/** @type {Map<string, string | null>} `<indexer>@<height>` → ISO time */
	const times = new Map();

	/** @param {string} indexer @param {number} height */
	async function timeOf(indexer, height) {
		const key = `${indexer}@${height}`;
		if (times.has(key)) return times.get(key) ?? null;
		const block = await getJson(`${indexer}/v1/blocks/${height}`).catch(() => null);
		const ms = Date.parse(String(block?.datetime ?? ''));
		const iso = Number.isNaN(ms) ? null : new Date(ms).toISOString();
		times.set(key, iso);
		return iso;
	}

	return {
		/**
		 * @param {{ address: string, rest: string, indexer: string }} p checked by the caller
		 * @returns {Promise<AkashDeployment[]>}
		 */
		async deployments({ address, rest, indexer }) {
			/** @type {any[]} */
			const raw = [];
			let key = '';
			for (let page = 0; page < 50; page++) {
				const q = new URLSearchParams({
					'filters.owner': address,
					'pagination.limit': String(LIMIT),
					...(key ? { 'pagination.key': key } : {})
				});
				const body = await getJson(`${rest}/akash/deployment/v1beta4/deployments/list?${q}`);
				if (!Array.isArray(body?.deployments)) {
					throw new WalletError('the node answered without deployments', 'WALLET_DATA');
				}
				raw.push(...body.deployments);
				key = String(body?.pagination?.next_key ?? '');
				if (!key) break;
			}
			/** @type {AkashDeployment[]} */
			const out = [];
			for (const d of raw) {
				const dseq = String(d?.deployment?.id?.dseq ?? '');
				const createdHeight = Number(d?.deployment?.created_at);
				const state = d?.escrow_account?.state ?? {};
				const settledHeight = Number(state.settled_at);
				if (!/^\d+$/.test(dseq) || !Number.isSafeInteger(createdHeight)) continue;
				out.push({
					dseq,
					state: String(d?.deployment?.state ?? ''),
					createdHeight,
					createdAt: await timeOf(indexer, createdHeight),
					settledHeight: Number.isSafeInteger(settledHeight) ? settledHeight : createdHeight,
					settledAt: Number.isSafeInteger(settledHeight)
						? await timeOf(indexer, settledHeight)
						: null,
					transferred: unitsToDecimal(sumOf(state.transferred, 'uact'), 6),
					funds: unitsToDecimal(sumOf(state.funds, 'uact'), 6)
				});
			}
			return out.sort((a, b) => a.createdHeight - b.createdHeight);
		}
	};
}
