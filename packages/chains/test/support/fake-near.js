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
 * @param {string} [o.wnear] the wallet's wNEAR in base units
 * @param {Record<string, { transaction?: any, receipts?: any[] }>} [o.txStatus] what
 *   EXPERIMENTAL_tx_status answers per hash: the call (with its arguments, see `storageCall`)
 *   and the receipts; a hash not named here has neither, nothing sent back
 */
export function fakeNear({
	txns = NEAR_TXNS,
	ftTxns = NEAR_FT_TXNS,
	account = { amount: yocto('19.5'), locked: yocto('0.25') },
	usdc = '12340000',
	wnear = '0',
	txStatus = {}
} = {}) {
	const state = {
		/** @type {{ url: string, method: string, rpc?: string, tx?: string }[]} what was asked, an RPC call by its method and hash */
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
		Object.assign(state.asked[state.asked.length - 1], {
			rpc: call.method,
			...(call.params?.tx_hash ? { tx: call.params.tx_hash } : {})
		});
		// What a storage deposit kept (near.js storageKept), whom it registered, where a swap went.
		if (call.method === 'EXPERIMENTAL_tx_status') {
			const known = txStatus[call.params?.tx_hash];
			return json({ result: { receipts: [], ...known } });
		}
		if (call.params?.request_type === 'view_account') return json({ result: account });
		if (call.params?.request_type === 'call_function' && call.params.account_id === NEAR.usdc) {
			return json({ result: { result: [...new TextEncoder().encode(`"${usdc}"`)] } });
		}
		if (call.params?.request_type === 'call_function' && call.params.account_id === 'wrap.near') {
			return json({ result: { result: [...new TextEncoder().encode(`"${wnear}"`)] } });
		}
		return json({ error: { message: 'unexpected' } });
	};
	return { fetch: /** @type {typeof fetch} */ (answer), state };
}

/**
 * A storage deposit's call as the RPC gives it (EXPERIMENTAL_tx_status `transaction`):
 * `account_id` the account it registers (left out: the signer).
 *
 * @param {{ account_id?: string, registration_only?: boolean, token_ids?: string[] }} args
 * @param {string} [method]
 */
export const storageCall = (args, method = 'storage_deposit') => ({
	actions: [
		{
			FunctionCall: {
				method_name: method,
				args: btoa(JSON.stringify(args)),
				gas: 30_000_000_000_000,
				deposit: yocto('0.00125')
			}
		}
	]
});

/**
 * A swap of 2 NEAR (as wNEAR) for 5.67 USDC at a made-up DEX, and the two
 * storage deposits the wallet sent a minute before it, at the USDC contract
 * and at the DEX (#968), each in a transaction of its own.
 */
export function storageBeforeSwap() {
	const dex = 'dex.example.near';
	const hashes = {
		swap: 'Swap333333333333333333333333333333333333333',
		atToken: 'Reg1111111111111111111111111111111111111111',
		atDex: 'Reg2222222222222222222222222222222222222222'
	};
	const swapAt = Date.parse('2026-11-20T14:05:00Z');
	const signed = (
		/** @type {string} */ hash,
		/** @type {string} */ receiver,
		/** @type {number} */ before,
		/** @type {string} */ method,
		/** @type {string} */ deposit
	) => ({
		transaction_hash: hash,
		block_timestamp: (BigInt(swapAt - before) * 1_000_000n).toString(),
		block: { block_height: String(300 - before / 1000) },
		signer_account_id: NEAR.wallet,
		receiver_account_id: receiver,
		actions: [{ action: 'FUNCTION_CALL', method }],
		actions_agg: { deposit },
		outcomes: { status: true },
		outcomes_agg: { transaction_fee: '446365125000000000000' }
	});
	const moved = (/** @type {Record<string, string>} */ over) => ({
		transaction_hash: hashes.swap,
		block_timestamp: (BigInt(swapAt) * 1_000_000n).toString(),
		block: { block_height: '301' },
		affected_account_id: NEAR.wallet,
		involved_account_id: dex,
		cause: 'TRANSFER',
		event_index: '0',
		...over
	});
	const { fetch } = fakeNear({
		txns: [
			signed(hashes.swap, 'wrap.near', 0, 'ft_transfer_call', '1'),
			signed(hashes.atToken, NEAR.usdc, 60_000, 'storage_deposit', yocto('0.00125')),
			signed(hashes.atDex, dex, 60_000, 'tokens_storage_deposit', yocto('0.00125'))
		],
		ftTxns: [
			moved({ contract_account_id: NEAR.usdc, delta_amount: '5670000', receipt_id: 's2' }),
			moved({ contract_account_id: 'wrap.near', delta_amount: `-${yocto('2')}`, receipt_id: 's1' })
		],
		account: { amount: yocto('7'), locked: '0' },
		usdc: '5670000'
	});
	return { fetch, dex, hashes };
}

/**
 * Three storage deposits that are no swap's (near-storage.js): one registering
 * another own account at the USDC contract a minute before 12.34 USDC go to it
 * (`forTransfer`), one registering the wallet itself two hours before an
 * exchange pays 50 USDC out to it (`forReceipt`), and one at a made-up token
 * with nothing after it (`alone`). Each in a transaction of its own.
 */
export function storageWithoutSwap() {
	const other = 'konto-b.near';
	const token = 'token-a.example.near';
	const hashes = {
		forTransfer: 'RegT111111111111111111111111111111111111111',
		transfer: 'PayT111111111111111111111111111111111111111',
		forReceipt: 'RegR111111111111111111111111111111111111111',
		receipt: 'GotR111111111111111111111111111111111111111',
		alone: 'RegA111111111111111111111111111111111111111'
	};
	const t0 = Date.parse('2026-11-20T09:00:00Z');
	const time = (/** @type {number} */ ms) => (BigInt(t0 + ms) * 1_000_000n).toString();
	const signed = (
		/** @type {string} */ hash,
		/** @type {string} */ receiver,
		/** @type {number} */ ms,
		method = 'storage_deposit',
		deposit = yocto('0.00125')
	) => ({
		transaction_hash: hash,
		block_timestamp: time(ms),
		block: { block_height: String(400 + ms / 60_000) },
		signer_account_id: NEAR.wallet,
		receiver_account_id: receiver,
		actions: [{ action: 'FUNCTION_CALL', method }],
		actions_agg: { deposit },
		outcomes: { status: true },
		outcomes_agg: { transaction_fee: '446365125000000000000' }
	});
	const usdc = (
		/** @type {string} */ hash,
		/** @type {string} */ delta,
		/** @type {string} */ other,
		/** @type {number} */ ms
	) => ({
		transaction_hash: hash,
		block_timestamp: time(ms),
		block: { block_height: String(400 + ms / 60_000) },
		affected_account_id: NEAR.wallet,
		involved_account_id: other,
		contract_account_id: NEAR.usdc,
		delta_amount: delta,
		cause: 'TRANSFER',
		receipt_id: 'r0',
		event_index: '0'
	});
	const { fetch } = fakeNear({
		txns: [
			signed(hashes.alone, token, 600 * 60_000),
			signed(hashes.transfer, NEAR.usdc, 181 * 60_000, 'ft_transfer', '1'),
			signed(hashes.forTransfer, NEAR.usdc, 180 * 60_000),
			signed(hashes.forReceipt, NEAR.usdc, 0)
		],
		ftTxns: [
			usdc(hashes.transfer, '-12340000', other, 181 * 60_000),
			usdc(hashes.receipt, '50000000', NEAR.exchange, 120 * 60_000)
		],
		txStatus: {
			[hashes.forTransfer]: { transaction: storageCall({ account_id: other }) },
			[hashes.forReceipt]: { transaction: storageCall({ registration_only: true }) },
			[hashes.alone]: { transaction: storageCall({}) }
		},
		account: { amount: yocto('7'), locked: '0' },
		usdc: '37660000'
	});
	return { fetch, other, token, hashes };
}
