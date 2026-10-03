// Monero, from the wallet's own export (CSV), read in the browser. Monero hides
// amounts, senders and receivers on its chain: nothing can be read by an
// address, as for the other chains. The wallet knows its history; it exports
// it, and the file goes no further than this page.
//
// Two exports are understood, recognised by their header (taken from the
// wallets' source, monero-gui `TransactionHistory::writeCSV` and monero
// `simple_wallet::export_transfers`):
//
//   Monero GUI  blockHeight,epoch,date,direction,amount,atomicAmount,fee,txid,
//               label,subaddrAccount,paymentId,description
//               amount without sign, `direction` in|out; `epoch` (Unix
//               seconds) is used, as `date` follows the language; the fee is
//               given for incoming transfers too – the sender paid it.
//   Monero CLI  block,direction,unlocked,timestamp,transaction amount,running
//               balance,hash,payment ID,fee,destination,destination amount,
//               index,note,tx key – fields padded to a width; `timestamp`
//               "YYYY-MM-DD HH:MM:SS" (UTC); further destinations of one
//               transfer in rows of their own, without a block.
//
// Only confirmed transfers count: in, out, and a mined block (CLI `block`);
// pool, pending and failed ones are left out. Every transfer becomes the
// entries the bridge's chains hand back (`WalletEntry`): received / sent, and
// for an outgoing one its fee as an entry of its own (`<hash>:fee`) – so it is
// valued, booked and paired like any wallet's (wallet-sync.js).

/** @typedef {import('../bridge/client.js').WalletEntry} WalletEntry */

const DECIMALS = 12;
const EXPLORER = 'https://xmrchain.net/tx/';

/** Fields of one CSV line: commas, quoted fields with `""` inside. @param {string} line */
export function csvFields(line) {
	/** @type {string[]} */
	const out = [];
	let field = '';
	let quoted = false;
	for (let i = 0; i < line.length; i++) {
		const c = line[i];
		if (quoted) {
			if (c === '"' && line[i + 1] === '"') {
				field += '"';
				i++;
			} else if (c === '"') quoted = false;
			else field += c;
		} else if (c === '"') quoted = true;
		else if (c === ',') {
			out.push(field);
			field = '';
		} else field += c;
	}
	out.push(field);
	return out.map((f) => f.trim());
}

/** `1.5` (XMR) → 1500000000000n (piconero); null when it is no amount. @param {string} text */
export function toPiconero(text) {
	const m = /^(\d+)(?:\.(\d{1,12}))?$/.exec(String(text ?? '').trim());
	if (!m) return null;
	return BigInt(m[1]) * 10n ** BigInt(DECIMALS) + BigInt((m[2] ?? '').padEnd(DECIMALS, '0'));
}

/** 1500000000000n → `1.5`, signed. @param {bigint} units */
export function fromPiconero(units) {
	const sign = units < 0n ? '-' : '';
	const abs = units < 0n ? -units : units;
	const whole = abs / 10n ** BigInt(DECIMALS);
	const frac = (abs % 10n ** BigInt(DECIMALS))
		.toString()
		.padStart(DECIMALS, '0')
		.replace(/0+$/, '');
	return `${sign}${whole}${frac ? `.${frac}` : ''}`;
}

/**
 * @typedef {object} MoneroTransfer one confirmed transfer, as read
 * @property {string} hash 64 hex
 * @property {number} height
 * @property {string} time ISO 8601
 * @property {'in' | 'out' | 'block'} direction
 * @property {bigint} amount piconero, without sign
 * @property {bigint} fee piconero; counted for an outgoing one only
 * @property {string} destination the first destination of an outgoing one, else ''
 * @property {string} note the wallet's note and label, as kept there
 */

const GUI = 'blockheight,epoch,date,direction,amount,atomicamount,fee,txid';
const CLI = 'block,direction,unlocked,timestamp,transaction amount,running balance,hash';

/**
 * The transfers of a Monero wallet export.
 *
 * @param {string} text the file's content
 * @returns {{ format: 'gui' | 'cli', transfers: MoneroTransfer[], skipped: number }}
 *   `skipped`: rows that were not a confirmed transfer (pending, pool, failed)
 */
export function parseMoneroExport(text) {
	const lines = String(text ?? '')
		.replace(/^\uFEFF/, '')
		.split(/\r?\n/)
		.filter((l) => l.trim());
	const head = csvFields(lines[0] ?? '')
		.map((h) => h.toLowerCase())
		.join(',');
	const format = head.startsWith(GUI) ? 'gui' : head.startsWith(CLI) ? 'cli' : null;
	if (!format) {
		throw new Error(
			'Not a Monero export: expected the history CSV of the Monero GUI or of `export_transfers` (CLI).'
		);
	}
	/** @type {MoneroTransfer[]} */
	const transfers = [];
	let skipped = 0;
	for (const line of lines.slice(1)) {
		const f = csvFields(line);
		if (format === 'gui') {
			const [height, epoch, , direction, , atomic, fee, txid, label, , , description] = f;
			if (!/^(in|out)$/.test(direction) || !/^[0-9a-f]{64}$/i.test(txid) || !Number(height)) {
				skipped++;
				continue;
			}
			transfers.push({
				hash: txid.toLowerCase(),
				height: Number(height),
				time: new Date(Number(epoch) * 1000).toISOString(),
				direction: /** @type {'in' | 'out'} */ (direction),
				amount: BigInt(atomic),
				fee: toPiconero(fee) ?? 0n,
				destination: '',
				note: [description, label].filter(Boolean).join(' · ')
			});
			continue;
		}
		const [block, direction, , timestamp, amount, , hash, , fee, destination, , , note] = f;
		// A further destination of the transfer above: kept with it as the first only.
		if (!block) continue;
		const at = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/.exec(timestamp);
		if (!/^(in|out|block)$/.test(direction) || !/^[0-9a-f]{64}$/i.test(hash) || !at) {
			skipped++;
			continue;
		}
		transfers.push({
			hash: hash.toLowerCase(),
			height: Number(block),
			time: new Date(`${at[1]}T${at[2]}Z`).toISOString(),
			direction: /** @type {'in' | 'out' | 'block'} */ (direction),
			amount: toPiconero(amount) ?? 0n,
			fee: toPiconero(fee) ?? 0n,
			destination: destination && destination !== '-' ? destination : '',
			note: note ?? ''
		});
	}
	return { format, transfers, skipped };
}

/**
 * The transfers as the entries a wallet sync books (wallet-sync.js), and the
 * balance they leave.
 *
 * @param {MoneroTransfer[]} transfers
 * @returns {{ entries: WalletEntry[], balance: string }}
 */
export function moneroEntries(transfers) {
	/** @type {WalletEntry[]} */
	const entries = [];
	/** @type {Map<string, number>} */
	const seen = new Map();
	let balance = 0n;
	for (const t of [...transfers].sort(
		(a, b) => a.height - b.height || (a.hash < b.hash ? -1 : 1)
	)) {
		const type = t.direction === 'out' ? 'sent' : 'received';
		const key = `${t.hash}:${type}`;
		const n = seen.get(key) ?? 0;
		seen.set(key, n + 1);
		const base = {
			hash: t.hash,
			height: t.height,
			time: t.time,
			date: t.time.slice(0, 10),
			asset: 'XMR',
			decimals: DECIMALS,
			counterpartyLabel: '',
			memo: t.note,
			success: true,
			explorerUrl: `${EXPLORER}${t.hash}`
		};
		const signed = t.direction === 'out' ? -t.amount : t.amount;
		balance += signed;
		entries.push({
			...base,
			id: `${t.hash}:${type}:${n}`,
			type,
			kind: t.direction === 'block' ? 'mining' : 'transfer',
			amount: fromPiconero(signed),
			counterparty: t.destination
		});
		if (t.direction === 'out' && t.fee > 0n) {
			balance -= t.fee;
			entries.push({
				...base,
				id: `${t.hash}:fee`,
				type: 'fee',
				kind: 'fee',
				amount: fromPiconero(-t.fee),
				counterparty: '',
				memo: ''
			});
		}
	}
	return { entries, balance: fromPiconero(balance) };
}

/**
 * "Verlauf importieren": a Monero wallet's export into the books, through the
 * same booking as every wallet sync (wallet-sync.js `bookWalletHistory`): one
 * account for XMR, each entry valued at its day's rate (the bridge asks
 * CoinGecko), the known ones skipped – importing the same file twice adds
 * nothing.
 *
 * @param {object} params
 * @param {{ rate: (asset: string, date: string, options?: any) => Promise<any> }} params.client
 * @param {any} params.store
 * @param {import('./wallet-sync.js').Wallet} params.wallet chain `monero`
 * @param {string} params.text the export file's content
 * @param {Date} [params.now]
 */
export async function importMoneroExport({ client, store, wallet, text, now = new Date() }) {
	const { bookWalletHistory } = await import('./wallet-sync.js');
	const { format, transfers, skipped } = parseMoneroExport(text);
	const { entries, balance } = moneroEntries(transfers);
	const booked = await bookWalletHistory({
		client,
		store,
		wallet,
		result: {
			entries,
			balances: [{ asset: 'XMR', amount: balance, decimals: DECIMALS }],
			source: `monero-${format}`,
			// The whole history the wallet knows: nothing pruned, nothing unread.
			unknownAssets: 0,
			history: {
				earliestHeight: transfers.length ? Math.min(...transfers.map((t) => t.height)) : 0,
				earliestTime: entries[0]?.time ?? null,
				pruned: false
			},
			endpoints: {}
		},
		now
	});
	return { ...booked, format, transfers: transfers.length, skipped };
}
