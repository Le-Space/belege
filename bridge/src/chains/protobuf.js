// Just enough protobuf to read a Cosmos transaction's memo and fee from the
// bytes CometBFT's tx_search hands out (base64 of a `TxRaw`). The events
// carry neither the memo nor, before cosmos-sdk 0.46, the fee.
//
//   TxRaw    { 1 body_bytes, 2 auth_info_bytes, 3 signatures }
//   TxBody   { 1 messages (Any { 1 type_url, 2 value }), 2 memo, … }
//   AuthInfo { 1 signer_infos, 2 fee }
//   Fee      { 1 amount (Coin { 1 denom, 2 amount }), 2 gas_limit, 3 payer, 4 granter }
//
// Unknown fields are skipped by wire type; anything malformed yields null
// rather than a half-read value.

/**
 * @param {Uint8Array} bytes
 * @returns {Map<number, Uint8Array[]> | null} length-delimited fields by number; varints are skipped
 */
function fields(bytes) {
	/** @type {Map<number, Uint8Array[]>} */
	const out = new Map();
	let i = 0;
	const varint = () => {
		let value = 0n;
		let shift = 0n;
		for (;;) {
			if (i >= bytes.length || shift > 63n) throw new Error('bad varint');
			const b = bytes[i++];
			value |= BigInt(b & 0x7f) << shift;
			if (!(b & 0x80)) return value;
			shift += 7n;
		}
	};
	try {
		while (i < bytes.length) {
			const key = varint();
			const field = Number(key >> 3n);
			const wire = Number(key & 7n);
			if (wire === 0) varint();
			else if (wire === 1) i += 8;
			else if (wire === 5) i += 4;
			else if (wire === 2) {
				const length = Number(varint());
				if (i + length > bytes.length) return null;
				out.set(field, [...(out.get(field) ?? []), bytes.subarray(i, i + length)]);
				i += length;
			} else return null;
			if (i > bytes.length) return null;
		}
	} catch {
		return null;
	}
	return out;
}

const text = (/** @type {Uint8Array | undefined} */ b) =>
	b ? new TextDecoder('utf-8', { fatal: false }).decode(b) : '';

/**
 * @param {string} base64 the `tx` of a tx_search result
 * @returns {{ memo: string, messageTypes: string[], fee: { denom: string, amount: string }[] } | null}
 */
export function decodeTx(base64) {
	if (typeof base64 !== 'string' || !base64) return null;
	const raw = fields(Buffer.from(base64, 'base64'));
	const bodyBytes = raw?.get(1)?.[0];
	const authBytes = raw?.get(2)?.[0];
	if (!raw || !bodyBytes) return null;
	const body = fields(bodyBytes);
	if (!body) return null;
	const messageTypes = (body.get(1) ?? []).map((any) => text(fields(any)?.get(1)?.[0]));
	const auth = authBytes ? fields(authBytes) : null;
	const fee = auth?.get(2)?.[0] ? fields(/** @type {Uint8Array} */ (auth.get(2)?.[0])) : null;
	const coins = (fee?.get(1) ?? []).map((c) => {
		const coin = fields(c);
		return { denom: text(coin?.get(1)?.[0]), amount: text(coin?.get(2)?.[0]) };
	});
	return {
		memo: text(body.get(2)?.[0]),
		messageTypes,
		fee: coins.filter((c) => c.denom && /^\d+$/.test(c.amount))
	};
}

// For the fake chain in the tests: the same structure, written.

/** @param {number} n */
function writeVarint(n) {
	/** @type {number[]} */
	const out = [];
	let v = BigInt(n);
	do {
		let b = Number(v & 0x7fn);
		v >>= 7n;
		if (v) b |= 0x80;
		out.push(b);
	} while (v);
	return out;
}

/** @param {number} field @param {Uint8Array | string} value */
function lengthDelimited(field, value) {
	const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
	return Uint8Array.from([
		...writeVarint((field << 3) | 2),
		...writeVarint(bytes.length),
		...bytes
	]);
}

/** @param {Uint8Array[]} parts */
const concat = (parts) => Uint8Array.from(parts.flatMap((p) => [...p]));

/**
 * @param {{ memo?: string, messageTypes?: string[], fee?: { denom: string, amount: string }[] }} tx
 * @returns {string} base64 of a TxRaw
 */
export function encodeTx({ memo = '', messageTypes = [], fee = [] }) {
	const body = concat([
		...messageTypes.map((type) => lengthDelimited(1, lengthDelimited(1, type))),
		...(memo ? [lengthDelimited(2, memo)] : [])
	]);
	const feeBytes = concat(
		fee.map((c) =>
			lengthDelimited(1, concat([lengthDelimited(1, c.denom), lengthDelimited(2, c.amount)]))
		)
	);
	const auth = lengthDelimited(2, feeBytes);
	return Buffer.from(concat([lengthDelimited(1, body), lengthDelimited(2, auth)])).toString(
		'base64'
	);
}
