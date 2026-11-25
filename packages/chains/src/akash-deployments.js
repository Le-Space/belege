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
// Console indexer (`/v1/blocks/<height>`), as the node is pruned. With them,
// the wallet's ACT held now (`/cosmos/bank/v1beta1/balances/<a>`, uact), for
// the ACT account (step 3): what was minted is what is held, in escrow and
// used up.
//
// What a deployment cost in a month is not kept per month on chain:
// `usageInMonth` spreads its transferred amount evenly over its time from
// creation to the last settlement, and the documents say so. Pure, shared by
// Belege's Akash usage statement and the Eigenbeleg API's monthly consumption
// Eigenbeleg (`akashUsageEntries`, Le-Space/eigenbeleg-agent#116).
//
// The log gets counts, never an address.

import { entry } from '@le-space/ledger';
import { createJsonFetcher, WalletError } from './core.js';
import { unitsToDecimal } from './cosmos.js';
import { AKASH_CHAIN } from './cosmos-chains.js';

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
		// Only an answer is kept: an indexer that did not answer this time is
		// asked again next time, not remembered as silent for the bridge's life.
		if (iso) times.set(key, iso);
		return iso;
	}

	return {
		/**
		 * The wallet's ACT held now, decimal.
		 *
		 * @param {{ address: string, rest: string }} p checked by the caller
		 */
		async actBalance({ address, rest }) {
			const body = await getJson(
				`${rest}/cosmos/bank/v1beta1/balances/${encodeURIComponent(address)}?pagination.limit=200`
			);
			if (!Array.isArray(body?.balances)) {
				throw new WalletError('the node answered without balances', 'WALLET_DATA');
			}
			const uact = body.balances.find((/** @type {any} */ b) => b?.denom === 'uact');
			return unitsToDecimal(decUnits(uact?.amount ?? '0'), 6);
		},

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

// ---- a month's share of each deployment (moved from Belege's app/src/lib/akash/usage.js)

/** `2026-07` → [start, end) in ms, UTC. @param {string} month */
export function monthRange(month) {
	const [y, m] = month.split('-').map(Number);
	return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

/** `0.123456` → 123456n (micro). @param {string} text */
export const micro = (text) => {
	const m = /^(-?)(\d+)(?:\.(\d{1,6}))?/.exec(String(text ?? '0'));
	if (!m) return 0n;
	const v = BigInt(m[2]) * 1_000_000n + BigInt((m[3] ?? '').padEnd(6, '0'));
	return m[1] ? -v : v;
};

/** 123456n → `0.123456`. @param {bigint} v */
export const fromMicro = (v) => {
	const sign = v < 0n ? '-' : '';
	const a = v < 0n ? -v : v;
	const frac = (a % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
	return `${sign}${a / 1_000_000n}${frac ? `.${frac}` : ''}`;
};

/**
 * @typedef {object} DeploymentUsage one deployment's share of a month
 * @property {string} dseq
 * @property {string} state
 * @property {string} from ISO, its creation
 * @property {string} until ISO, its last settlement (for a closed one, its end)
 * @property {string} total ACT paid to its providers in all, decimal
 * @property {string} inMonth the share that falls into the month, decimal ACT
 * @property {number} share of its time, 0…1
 */

/**
 * Each deployment's share of the month: its ACT spread evenly over its time,
 * from creation to its last settlement. A deployment that lived no measurable
 * time counts whole where it was created; one without times is left out.
 *
 * @param {Pick<AkashDeployment, 'dseq' | 'state' | 'createdAt' | 'settledAt' | 'transferred'>[]} deployments
 * @param {string} month YYYY-MM
 * @returns {DeploymentUsage[]}
 */
export function usageInMonth(deployments, month) {
	const [start, end] = monthRange(month);
	const out = [];
	for (const d of deployments) {
		const from = Date.parse(String(d.createdAt ?? ''));
		const until = Date.parse(String(d.settledAt ?? d.createdAt ?? ''));
		if (Number.isNaN(from) || Number.isNaN(until)) continue;
		const total = micro(d.transferred);
		const lo = Math.max(from, start);
		const hi = Math.min(Math.max(until, from), end);
		const span = Math.max(until - from, 0);
		const share = span === 0 ? (from >= start && from < end ? 1 : 0) : Math.max(hi - lo, 0) / span;
		if (share <= 0) continue;
		// Rounded to the micro-ACT, half up.
		const inMonth = (total * BigInt(Math.round(share * 1e9)) + 500_000_000n) / 1_000_000_000n;
		out.push({
			dseq: d.dseq,
			state: d.state,
			from: new Date(from).toISOString(),
			until: new Date(Math.max(until, from)).toISOString(),
			total: fromMicro(total),
			inMonth: fromMicro(inMonth),
			share
		});
	}
	return out;
}

/** What ACT is valued at: Akash's compute credit, minted from AKT at 1 USD (burn-mint). */
export const ACT_USD = '1';
export const ACT_PRICE_SOURCE = 'Akash ACT zu 1 USD je ACT (Burn-Mint)';

/**
 * A month's consumption of an Akash wallet's deployments as ledger entries: one `usage` entry per
 * deployment with a share in the month – what its escrow paid its providers (lease payouts), spread
 * over its time (usageInMonth). No transaction of its own, so no hash; dated the month's last day,
 * valued in USD per ACT (`unitPrice`) at that day's rate. These are no movements of the wallet: the
 * ACT left it when it was deposited into the escrow (kind `escrow`), so they belong on no
 * Kontoauszug of the wallet, only on the month's consumption Eigenbeleg.
 *
 * @param {{ address: string, month: string, deployments: Parameters<typeof usageInMonth>[0] }} p
 * @returns {import('@le-space/ledger').LedgerEntry[]}
 */
export function akashUsageEntries({ address, month, deployments }) {
	const [, end] = monthRange(month);
	const last = new Date(end - 1000).toISOString();
	const day = (/** @type {string} */ iso) => iso.slice(0, 10);
	return usageInMonth(deployments, month)
		.filter((u) => micro(u.inMonth) > 0n)
		.map((u) =>
			entry({
				id: `akash:${address}:usage:${month}:${u.dseq}`,
				chain: 'akash',
				network: 'mainnet',
				account: address,
				hash: '',
				height: 0,
				time: last,
				type: 'sent',
				kind: 'usage',
				asset: 'ACT',
				contract: 'native',
				decimals: 6,
				amount: `-${u.inMonth}`,
				counterparty: 'akash-providers',
				counterpartyLabel: `Deployment ${u.dseq}`,
				method: '',
				// What the share was taken from, as the documents print it (de; localizeLabel gives the English).
				memo: `Laufzeit ${day(u.from)} – ${day(u.until)}, gesamt ${u.total} ACT, Anteil ${(u.share * 100).toFixed(1)} %`,
				success: true,
				explorerUrl: AKASH_CHAIN.explorer.address.replace('{address}', address),
				priceAs: '',
				unitPrice: { currency: 'USD', amount: ACT_USD, source: ACT_PRICE_SOURCE }
			})
		);
}
