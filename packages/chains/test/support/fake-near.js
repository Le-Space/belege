// A made-up NearBlocks and NEAR RPC as a `fetch`, for the tests of a NEAR
// account as an own wallet (near-wallet.js). Every account, hash and amount
// is made up.

export const NEAR = {
	wallet: 'wolkenfabrik.near',
	exchange: 'boerse-auszahlung.near',
	customer: 'stromwerk.near',
	/** Circle's USDC on NEAR, the one listed token (registry.js). */
	usdc: '17208628f84f5d6ad33f0da3bbbeb27ffcb398eac501a31bd6ad2011e36133a1',
	/** base58, 44 characters, as a NEAR transaction hash. */
	hashIn: '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin',
	hashOut: '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi1',
	hashToken: 'Us11111111111111111111111111111111111111112',
	hashAirdrop: 'So11111111111111111111111111111111111111112'
};

/** `1.5` → yoctoNEAR. @param {string} near */
export const yocto = (near) => (BigInt(Math.round(Number(near) * 1e6)) * 10n ** 18n).toString();
/** ISO → NearBlocks' nanosecond timestamp. @param {string} iso */
const ts = (iso) => (BigInt(Date.parse(iso)) * 1_000_000n).toString();

/** What NearBlocks lists for the wallet, newest first. */
export const NEAR_TXNS = [
	{
		transaction_hash: NEAR.hashOut,
		block_timestamp: ts('2026-11-15T10:00:00Z'),
		block: { block_height: '200' },
		signer_account_id: NEAR.wallet,
		receiver_account_id: NEAR.customer,
		actions: [{ action: 'TRANSFER', method: null }],
		actions_agg: { deposit: yocto('1.5') },
		outcomes: { status: true },
		outcomes_agg: { transaction_fee: '446365125000000000000' }
	},
	{
		transaction_hash: NEAR.hashIn,
		block_timestamp: ts('2026-11-14T08:22:00Z'),
		block: { block_height: '100' },
		signer_account_id: NEAR.exchange,
		receiver_account_id: NEAR.wallet,
		actions: [{ action: 'TRANSFER', method: null }],
		actions_agg: { deposit: yocto('21.25') },
		outcomes: { status: true },
		outcomes_agg: { transaction_fee: '446365125000000000000' }
	}
];

/** Its token movements: one of a token that only calls itself USDC, one of the listed USDC. */
export const NEAR_FT_TXNS = [
	{
		transaction_hash: NEAR.hashAirdrop,
		block_timestamp: ts('2026-11-14T09:00:00Z'),
		block: { block_height: '110' },
		affected_account_id: NEAR.wallet,
		involved_account_id: 'geschenk.near',
		delta_amount: '100000000',
		contract_account_id: 'usdc-gratis.near',
		meta: { symbol: 'USDC', decimals: 6 },
		receipt_id: 'r1',
		event_index: '0'
	},
	{
		transaction_hash: NEAR.hashToken,
		block_timestamp: ts('2026-11-14T09:30:00Z'),
		block: { block_height: '120' },
		affected_account_id: NEAR.wallet,
		involved_account_id: NEAR.customer,
		delta_amount: '12340000',
		contract_account_id: NEAR.usdc,
		meta: { symbol: 'USDC', decimals: 6 },
		receipt_id: 'r2',
		event_index: '0'
	}
];

/**
 * @param {object} [o]
 * @param {any[]} [o.txns]
 * @param {any[]} [o.ftTxns]
 * @param {{ amount: string, locked: string }} [o.account] yoctoNEAR, as view_account answers
 * @param {string} [o.usdc] the wallet's USDC in base units
 */
export function fakeNear({
	txns = NEAR_TXNS,
	ftTxns = NEAR_FT_TXNS,
	account = { amount: yocto('19.5'), locked: yocto('0.25') },
	usdc = '12340000'
} = {}) {
	const state = {
		/** @type {{ url: string, method: string }[]} */
		asked: [],
		/** NearBlocks' answer to everything, when not 200. */
		nearBlocksStatus: 200
	};
	const json = (/** @type {any} */ body, status = 200) =>
		new Response(JSON.stringify(body), {
			status,
			headers: { 'content-type': 'application/json' }
		});
	/**
	 * @param {RequestInfo | URL} url
	 * @param {RequestInit} [init]
	 */
	const answer = async (url, init) => {
		const u = new URL(String(url));
		state.asked.push({ url: String(url), method: init?.method ?? 'GET' });
		if (u.pathname.startsWith('/v3/accounts/')) {
			if (state.nearBlocksStatus !== 200) return json({ message: 'no' }, state.nearBlocksStatus);
			if (!u.pathname.startsWith(`/v3/accounts/${NEAR.wallet}/`)) return json({ data: [] });
			return json({ data: u.pathname.endsWith('/ft-txns') ? ftTxns : txns, meta: {} });
		}
		const call = JSON.parse(String(init?.body));
		if (call.params?.request_type === 'view_account') return json({ result: account });
		if (call.params?.request_type === 'call_function' && call.params.account_id === NEAR.usdc) {
			return json({ result: { result: [...new TextEncoder().encode(`"${usdc}"`)] } });
		}
		return json({ error: { message: 'unexpected' } });
	};
	return { fetch: /** @type {typeof fetch} */ (answer), state };
}
