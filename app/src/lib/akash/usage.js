// What an Akash wallet cost in one month (issue #305, step 2), from its
// bookings and its deployments (bridge `/akash/deployments`), for the
// monthly usage statement (statement.js). Pure.
//
//   - network fees: the wallet's fee bookings in the month, each with its
//     hash, AKT and euro amount as booked;
//   - top-ups: AKT burnt for ACT (Akash burn-mint, booked as a swap, #304);
//   - usage: what each deployment paid its providers in ACT. The chain keeps
//     the total per deployment, not per month: it is spread evenly over the
//     deployment's time from creation to its last settlement, and the share
//     that falls into the month is counted. ACT is a compute credit at about
//     1 USD (Akash burn-mint); its euro value is that dollar at the ECB's
//     rate of the month's last day.

/** @typedef {Record<string, any>} Rec */
/** @typedef {import('../bridge/client.js').AkashDeployment} AkashDeployment */

/** `2026-07` → [start, end) in ms, UTC. @param {string} month */
export function monthRange(month) {
	const [y, m] = month.split('-').map(Number);
	return [Date.UTC(y, m - 1, 1), Date.UTC(y, m, 1)];
}

/** `0.123456` → 123456n (micro). @param {string} text */
const micro = (text) => {
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
 * Each deployment's share of the month: its ACT spread evenly over its time.
 *
 * @param {AkashDeployment[]} deployments
 * @param {string} month YYYY-MM
 * @returns {{ dseq: string, state: string, from: string, until: string, total: string, inMonth: string, share: number }[]}
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
		// A deployment that lived no measurable time: all of it where it was created.
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

/**
 * @typedef {object} AkashMonth
 * @property {string} month
 * @property {string} address
 * @property {{ id: string, date: string, hash: string, akt: string, eurCents: number, memo: string }[]} fees
 * @property {{ id: string, date: string, hash: string, akt: string, act: string | null, eurCents: number }[]} topUps
 * @property {ReturnType<typeof usageInMonth>} usage
 * @property {{ feesAkt: string, feesEurCents: number, topUpsAkt: string, usageAct: string, usageEurCents: number | null }} totals
 * @property {string | null} eurPerUsd the ECB's, for ACT at ~1 USD
 * @property {string | null} rateDate
 */

/**
 * The month of one Akash wallet.
 *
 * @param {object} p
 * @param {string} p.month YYYY-MM
 * @param {string} p.address
 * @param {Rec[]} p.accounts
 * @param {Rec[]} p.transactions
 * @param {AkashDeployment[]} p.deployments
 * @param {{ rate: string, date: string } | null} p.eurPerUsd
 * @returns {AkashMonth}
 */
export function akashMonth({ month, address, accounts, transactions, deployments, eurPerUsd }) {
	const own = new Set(
		accounts.filter((a) => a.source === 'akash' && a.walletAddress === address).map((a) => a.id)
	);
	const mine = transactions
		.filter((t) => !t.deleted && own.has(t.accountId) && String(t.bookedOn ?? '').startsWith(month))
		.sort((a, b) =>
			String(a.bookedAt ?? a.bookedOn).localeCompare(String(b.bookedAt ?? b.bookedOn))
		);
	// The booked quantity, in the asset's smallest unit (AKT: 6 decimals).
	const qty = (/** @type {Rec} */ t) => {
		const units = BigInt(String(t.quantity ?? '0').replace(/^-/, '') || '0');
		const decimals = Number.isInteger(t.decimals) ? t.decimals : 6;
		return fromMicro(
			decimals >= 6 ? units / 10n ** BigInt(decimals - 6) : units * 10n ** BigInt(6 - decimals)
		);
	};
	const fees = mine
		.filter((t) => t.movement === 'fee')
		.map((t) => ({
			id: String(t.id),
			date: String(t.bookedOn),
			hash: String(t.txRef ?? ''),
			akt: qty(t),
			eurCents: Math.abs(Number(t.amountCents ?? 0)),
			memo:
				String(t.purpose ?? '')
					.split(' · ')
					.find((p) => p.startsWith('Memo: '))
					?.slice(6) ?? ''
		}));
	const topUps = mine
		.filter((t) => t.movement === 'trade' && /Akash BME/.test(String(t.swap?.via ?? '')))
		.filter((t) => Number(t.amountCents ?? 0) < 0)
		.map((t) => {
			const act = (t.swap?.got ?? []).find((/** @type {any} */ g) => g.asset === 'ACT');
			return {
				id: String(t.id),
				date: String(t.bookedOn),
				hash: String(t.txRef ?? ''),
				akt: qty(t),
				act: act?.amount ? String(act.amount) : null,
				eurCents: Math.abs(Number(t.amountCents ?? 0))
			};
		});
	const usage = usageInMonth(deployments, month);
	const sum = (/** @type {string[]} */ list) => fromMicro(list.reduce((n, v) => n + micro(v), 0n));
	const usageAct = sum(usage.map((u) => u.inMonth));
	const usageEurCents = eurPerUsd
		? Math.round((Number(micro(usageAct)) * Number(eurPerUsd.rate)) / 10_000)
		: null;
	return {
		month,
		address,
		fees,
		topUps,
		usage,
		totals: {
			feesAkt: sum(fees.map((f) => f.akt)),
			feesEurCents: fees.reduce((n, f) => n + f.eurCents, 0),
			topUpsAkt: sum(topUps.map((t) => t.akt)),
			usageAct,
			usageEurCents
		},
		eurPerUsd: eurPerUsd?.rate ?? null,
		rateDate: eurPerUsd?.date ?? null
	};
}
