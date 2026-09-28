// A swap across chains, read from an IBC transfer's memo (issue #170).
//
// A wallet's swap feature (Skip Go, used by Keplr and others) sends the
// tokens over IBC to a contract on Osmosis with a memo that is the whole plan:
// `wasm.msg.swap_and_action` with the pools to swap through, the least the
// swap must give (`min_asset`), and what to do with the result
// (`post_swap_action`): send it on over IBC to a receiver on another chain, or
// to an address on Osmosis itself. The receiver is the one that matters for
// the books: when it is an own wallet, the transfer is a swap, not a payment
// to someone else.
//
// The target asset's denom is Osmosis's (`ibc/…`) and says nothing without a
// lookup; its base units are those of the asset that arrives, so the least
// amount is compared with the arrival's quantity as it is.

/**
 * @typedef {object} CrossSwap
 * @property {'skip-go'} router
 * @property {string} receiver where the result goes (bech32)
 * @property {string} recover where it goes back to when a step fails ('' when not named)
 * @property {string} minAmount the least the swap gives, in the target asset's base units
 * @property {number} hops pools swapped through
 * @property {number} feeBps the front end's fees, in basis points
 */

/** @param {unknown} v @returns {Record<string, any> | null} */
const obj = (v) =>
	v && typeof v === 'object' && !Array.isArray(v) ? /** @type {any} */ (v) : null;

const BECH32 = /^[a-z]{1,20}1[02-9ac-hj-np-z]{38,90}$/;

/**
 * The swap an IBC transfer's memo describes; null for any other memo.
 *
 * @param {unknown} memo the memo as the chain keeps it
 * @returns {CrossSwap | null}
 */
export function crossSwapOf(memo) {
	if (typeof memo !== 'string' || memo.length > 20_000 || !memo.trimStart().startsWith('{')) {
		return null;
	}
	let parsed;
	try {
		parsed = JSON.parse(memo);
	} catch {
		return null;
	}
	const action = obj(obj(obj(obj(parsed)?.wasm)?.msg)?.swap_and_action);
	if (!action) return null;
	const post = obj(action.post_swap_action);
	const ibc = obj(obj(post?.ibc_transfer)?.ibc_info);
	const local = obj(post?.transfer);
	const receiver = String(ibc?.receiver ?? local?.to_address ?? '');
	if (!BECH32.test(receiver)) return null;
	const recover = String(ibc?.recover_address ?? '');
	const min = obj(obj(action.min_asset)?.native) ?? obj(obj(action.min_asset)?.cw20);
	const minAmount = String(min?.amount ?? '');
	if (!/^\d{1,40}$/.test(minAmount)) return null;
	const swap = obj(obj(action.user_swap)?.swap_exact_asset_in);
	const hops = Array.isArray(swap?.operations) ? swap.operations.length : 0;
	const feeBps = (Array.isArray(action.affiliates) ? action.affiliates : []).reduce(
		(/** @type {number} */ sum, /** @type {any} */ a) => {
			const bps = Number(a?.basis_points_fee);
			return Number.isFinite(bps) && bps >= 0 && bps <= 10_000 ? sum + bps : sum;
		},
		0
	);
	return {
		router: 'skip-go',
		receiver,
		recover: BECH32.test(recover) ? recover : '',
		minAmount,
		hops,
		feeBps
	};
}

/**
 * Whether two bech32 addresses are the same key on two chains: the same data
 * part, whatever the prefix (the checksum differs with it).
 *
 * @param {string} a
 * @param {string} b
 */
export function sameKey(a, b) {
	const body = (/** @type {string} */ s) => {
		const i = String(s).lastIndexOf('1');
		return i > 0 ? String(s).slice(i + 1, -6) : '';
	};
	const x = body(a);
	return x.length >= 32 && x === body(b);
}
