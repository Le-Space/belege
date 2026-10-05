// Akash as a vendor account (issue #305, step 3): the wallet's ACT, the
// compute credit deployments are paid in, as an account of its own. ACT is
// bought by burning AKT (Akash burn-mint, booked as a swap AKT → ACT, #304)
// and used up by the deployments (their escrow pays the providers). What has
// to add up, in ACT:
//
//   minted = held now + left in escrow + used by deployments
//
// The ACT a mint gave is known where the node still had its events; for an
// older one (the indexer has none) it is not. Then the identity gives what
// they minted together, and it is shared among them by the AKT they burnt.
//
// In euros, at cost: a top-up costs what its AKT was booked at; each ACT costs
// the average of all top-ups (total cost ÷ ACT minted). Usage and what is left
// are valued at that cost – a prepayment used up, not a new price. Whether a
// top-up is a prepayment and the usage the expense is for the tax adviser.
// Pure.

import { fromMicro, usageInMonth } from './usage.js';

/** @typedef {Record<string, any>} Rec */
/** @typedef {import('../bridge/client.js').AkashDeployment} AkashDeployment */

/** `1.5` → 1500000n. @param {string | null | undefined} text */
const micro = (text) => {
	const m = /^(-?)(\d+)(?:\.(\d{1,6}))?/.exec(String(text ?? '0'));
	if (!m) return 0n;
	const v = BigInt(m[2]) * 1_000_000n + BigInt((m[3] ?? '').padEnd(6, '0'));
	return m[1] ? -v : v;
};

/** `2026-07` → `2026-08`. @param {string} month */
const next = (month) => {
	const [y, m] = month.split('-').map(Number);
	return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
};

/**
 * @typedef {object} ActMonth
 * @property {string} month
 * @property {string} minted ACT
 * @property {string} used ACT
 * @property {string} balance ACT after the month (held + in escrow)
 * @property {number} costCents what the month's top-ups cost
 * @property {number} usedCents its usage at cost
 */

/**
 * @param {object} p
 * @param {string} p.address
 * @param {Rec[]} p.accounts
 * @param {Rec[]} p.transactions
 * @param {AkashDeployment[]} p.deployments
 * @param {string} p.actBalance ACT held now, decimal
 * @param {string} p.untilMonth the last month to show, YYYY-MM
 */
export function actAccount({
	address,
	accounts,
	transactions,
	deployments,
	actBalance,
	untilMonth
}) {
	const own = new Set(
		accounts.filter((a) => a.source === 'akash' && a.walletAddress === address).map((a) => a.id)
	);
	// The top-ups: the AKT legs of the burn-mint swaps.
	const topUps = transactions
		.filter(
			(t) =>
				!t.deleted &&
				own.has(t.accountId) &&
				t.movement === 'trade' &&
				/Akash BME/.test(String(t.swap?.via ?? '')) &&
				Number(t.amountCents ?? 0) < 0
		)
		.map((t) => {
			const act = (t.swap?.got ?? []).find((/** @type {any} */ g) => g.asset === 'ACT');
			const units = BigInt(String(t.quantity ?? '0').replace(/^-/, '') || '0');
			return {
				id: String(t.id),
				date: String(t.bookedOn),
				akt: units,
				act: act?.amount ? micro(act.amount) : null,
				costCents: Math.abs(Number(t.amountCents ?? 0))
			};
		})
		.sort((a, b) => a.date.localeCompare(b.date));

	const used = deployments.reduce((n, d) => n + micro(d.transferred), 0n);
	const escrow = deployments
		.filter((d) => d.state === 'active')
		.reduce((n, d) => n + (micro(d.funds) > 0n ? micro(d.funds) : 0n), 0n);
	const held = micro(actBalance);
	const minted = held + escrow + used;

	// What the mints without an amount gave together, shared by AKT burnt.
	const known = topUps.reduce((n, t) => n + (t.act ?? 0n), 0n);
	const unknown = topUps.filter((t) => t.act === null);
	const unknownAkt = unknown.reduce((n, t) => n + t.akt, 0n);
	const rest = minted - known;
	for (const t of unknown) {
		t.act = unknownAkt > 0n ? (rest * t.akt) / unknownAkt : 0n;
	}
	const derived = unknown.length > 0;

	const costCents = topUps.reduce((n, t) => n + t.costCents, 0);
	/** Cost of `units` micro-ACT at the average. @param {bigint} units */
	const atCost = (units) =>
		minted > 0n ? Number((units * BigInt(costCents) + minted / 2n) / minted) : 0;

	// Month by month, from the first top-up or deployment to `untilMonth`.
	const starts = [
		...topUps.map((t) => t.date.slice(0, 7)),
		...deployments.map((d) => String(d.createdAt ?? '').slice(0, 7)).filter(Boolean)
	].sort();
	/** @type {ActMonth[]} */
	const months = [];
	let balance = 0n;
	for (let m = starts[0]; m && m <= untilMonth; m = next(m)) {
		const mintedIn = topUps
			.filter((t) => t.date.startsWith(m))
			.reduce((n, t) => n + /** @type {bigint} */ (t.act), 0n);
		const usedIn = usageInMonth(deployments, m).reduce((n, u) => n + micro(u.inMonth), 0n);
		balance += mintedIn - usedIn;
		months.push({
			month: m,
			minted: fromMicro(mintedIn),
			used: fromMicro(usedIn),
			balance: fromMicro(balance),
			costCents: topUps.filter((t) => t.date.startsWith(m)).reduce((n, t) => n + t.costCents, 0),
			usedCents: atCost(usedIn)
		});
	}
	return {
		topUps: topUps.map((t) => ({
			id: t.id,
			date: t.date,
			akt: fromMicro(t.akt),
			act: fromMicro(/** @type {bigint} */ (t.act)),
			costCents: t.costCents
		})),
		months,
		minted: fromMicro(minted),
		used: fromMicro(used),
		held: fromMicro(held),
		escrow: fromMicro(escrow),
		derived,
		costCents,
		usedCents: atCost(used),
		leftCents: atCost(held + escrow),
		perActCents: minted > 0n ? Number((BigInt(costCents) * 1_000_000n * 100n) / minted) / 100 : null
	};
}
