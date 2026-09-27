// Akash's older history from the Akash Console indexer (issue #105, part 4).
//
// Every public Akash node is pruned: it knows a few weeks or months of
// transactions. The indexer behind console.akash.network (run by the Akash
// team, open source: akash-network/console) knows every transaction since
// mainnet-2 (March 2021), without a key:
//   - `/v1/addresses/<address>/transactions/<skip>/<limit>`: the address's
//     transactions, newest first, with `count`;
//   - `/v1/transactions/<hash>`: one transaction with its decoded messages,
//     its signers and its fee (in uakt).
// It is used only for what the node no longer has: transactions below the
// node's lowest height (cosmos.js `history.earliestHeight`). The node stays
// the source for everything it knows, since its events are exact.
//
// What the indexer does not have are events, and so no amount that only an
// event carries: the rewards a withdrawal pays (the message has none), the
// rewards a delegation, undelegation or redelegation withdraws on the way,
// escrow refunds and lease payouts, whatever an authz MsgExec does. Those
// transactions are counted (`unknownAmounts`) and not booked; the balance
// check on the wallet card shows the gap. What is booked comes from the
// message: sends, multi-sends, IBC transfers out and in, delegations, escrow
// deposits from the balance, governance deposits – and the fee of every
// transaction the address signed first.
//
// Entry ids: the fee `<hash>:fee`, as cosmos.js; a message
// `<hash>:c<message>.<part>:<asset>`. When the node's window moves on, a
// transaction first read from the node is later read from here; the app
// keeps the id it was booked under (wallet-sync.js reconcileSourceIds).
//
// The log gets counts, never an address.

import { moduleAddress } from './bech32.js';
import { txUrl } from './registry.js';
import { createJsonFetcher, WalletError } from './http.js';
import { unitsToDecimal } from './cosmos.js';

const PER_PAGE = 100;
const HASH = /^[0-9A-F]{64}$/;

/** Messages whose effect on the balance only events tell. */
const AMOUNT_IN_EVENTS = new Set([
	'MsgWithdrawDelegatorReward',
	'MsgWithdrawValidatorCommission',
	'MsgUndelegate',
	'MsgBeginRedelegate',
	'MsgCancelUnbondingDelegation',
	'MsgExec',
	'MsgCloseDeployment',
	'MsgCloseGroup',
	'MsgCloseLease',
	'MsgWithdrawLease',
	'MsgCreateBid',
	'MsgCloseBid',
	'MsgAcknowledgement',
	'MsgTimeout'
]);

/** @param {unknown} v */
const str = (v) => (typeof v === 'string' ? v : '');

/** A coin as the indexer decodes it; null unless its amount is an integer. @param {any} c */
function coin(c) {
	const amount = str(c?.amount);
	const denom = str(c?.denom);
	return /^\d+$/.test(amount) && denom ? { denom, amount: BigInt(amount) } : null;
}

/** @param {any} list */
const coins = (list) => (Array.isArray(list) ? list : [list]).map(coin).filter((c) => c !== null);

/**
 * An IBC packet's fungible-token data: `{ denom, amount, sender, receiver }`.
 * A denom that starts with the packet's source port and channel is ours
 * coming home; any other is a voucher of another chain.
 *
 * @param {any} packet
 */
function packetTransfer(packet) {
	try {
		const data = JSON.parse(Buffer.from(str(packet?.data), 'base64').toString('utf8'));
		const prefix = `${str(packet?.sourcePort ?? packet?.source_port)}/${str(packet?.sourceChannel ?? packet?.source_channel)}/`;
		const denom = str(data?.denom);
		const amount = str(data?.amount);
		if (!denom || !/^\d+$/.test(amount)) return null;
		return {
			denom: denom.startsWith(prefix) ? denom.slice(prefix.length) : `ibc-voucher:${denom}`,
			amount: BigInt(amount),
			sender: str(data?.sender),
			receiver: str(data?.receiver)
		};
	} catch {
		return null;
	}
}

/**
 * One transaction as `/v1/transactions/<hash>` hands it out → the entries of
 * `address`.
 *
 * @param {any} tx
 * @param {{ address: string, chain: import('./registry.js').CosmosChain }} context
 * @returns {{ entries: import('./cosmos.js').WalletEntry[], unknownDenoms: string[], unknownAmount: boolean }}
 */
export function normalizeConsoleTx(tx, { address, chain }) {
	const hash = str(tx?.hash).toUpperCase();
	if (!HASH.test(hash)) throw new WalletError('a transaction without a hash', 'WALLET_DATA');
	const height = Number(tx?.height);
	const ms = Date.parse(str(tx?.datetime));
	if (!Number.isSafeInteger(height) || height <= 0 || Number.isNaN(ms)) {
		throw new WalletError('a transaction without a height or time', 'WALLET_DATA');
	}
	const time = new Date(ms).toISOString();
	const date = time.slice(0, 10);
	const memo = str(tx?.memo);
	const explorerUrl = txUrl(chain.explorer, hash);
	const bonded = moduleAddress(chain.bech32Prefix, 'bonded_tokens_pool');
	/** @type {import('./cosmos.js').WalletEntry[]} */
	const entries = [];
	/** @type {string[]} */
	const unknownDenoms = [];
	let unknownAmount = false;

	/** @param {{ denom: string, amount: bigint }} c */
	const assetOf = (c) => {
		const asset = Object.hasOwn(chain.denoms, c.denom) ? chain.denoms[c.denom] : null;
		if (!asset) unknownDenoms.push(c.denom);
		return asset;
	};

	/**
	 * @param {string} id
	 * @param {{ denom: string, amount: bigint }} c
	 * @param {{ out: boolean, kind: import('./cosmos.js').WalletEntry['kind'], counterparty: string, counterpartyLabel?: string }} how
	 */
	const push = (id, c, { out, kind, counterparty, counterpartyLabel = '' }) => {
		const asset = assetOf(c);
		if (!asset || c.amount === 0n) return;
		entries.push({
			id: `${id}:${asset.symbol}`,
			hash,
			height,
			time,
			date,
			type: out ? 'sent' : 'received',
			kind,
			asset: asset.symbol,
			amount: unitsToDecimal(out ? -c.amount : c.amount, asset.decimals),
			decimals: asset.decimals,
			counterparty,
			counterpartyLabel,
			memo,
			success: true,
			explorerUrl
		});
	};

	// The fee: in uakt, paid by the first signer.
	const signers = Array.isArray(tx?.signers) ? tx.signers.map(str) : [];
	const fee = Number(tx?.fee);
	if (signers[0] === address && Number.isSafeInteger(fee) && fee > 0) {
		const asset = chain.denoms[chain.nativeDenom];
		entries.push({
			id: `${hash}:fee`,
			hash,
			height,
			time,
			date,
			type: 'fee',
			kind: 'fee',
			asset: asset.symbol,
			amount: unitsToDecimal(-BigInt(fee), asset.decimals),
			decimals: asset.decimals,
			counterparty: '',
			counterpartyLabel: '',
			memo,
			success: tx?.isSuccess !== false,
			explorerUrl
		});
	}
	if (tx?.isSuccess === false) return { entries, unknownDenoms, unknownAmount };

	const messages = Array.isArray(tx?.messages) ? tx.messages : [];
	messages.forEach((/** @type {any} */ m, /** @type {number} */ index) => {
		const type = str(m?.type).split('.').pop() ?? '';
		const d = m?.data ?? {};
		const at = `${hash}:c${index}`;
		switch (type) {
			case 'MsgSend': {
				const from = str(d.from_address ?? d.fromAddress);
				const to = str(d.to_address ?? d.toAddress);
				if ((from === address) === (to === address)) return;
				coins(d.amount).forEach((c, part) =>
					push(`${at}.${part}`, c, {
						out: from === address,
						kind: 'transfer',
						counterparty: from === address ? to : from
					})
				);
				return;
			}
			case 'MsgMultiSend': {
				const inputs = Array.isArray(d.inputs) ? d.inputs : [];
				const outputs = Array.isArray(d.outputs) ? d.outputs : [];
				const only = (/** @type {any[]} */ list) =>
					list.length === 1 ? str(list[0]?.address) : '';
				let part = 0;
				for (const input of inputs) {
					if (str(input?.address) !== address) continue;
					for (const c of coins(input.coins))
						push(`${at}.${part++}`, c, {
							out: true,
							kind: 'transfer',
							counterparty: only(outputs)
						});
				}
				for (const output of outputs) {
					if (str(output?.address) !== address) continue;
					for (const c of coins(output.coins))
						push(`${at}.${part++}`, c, {
							out: false,
							kind: 'transfer',
							counterparty: only(inputs)
						});
				}
				return;
			}
			case 'MsgTransfer': {
				if (str(d.sender) !== address) return;
				const c = coin(d.token);
				if (c)
					push(`${at}.0`, c, {
						out: true,
						kind: 'ibc',
						counterparty: str(d.receiver),
						counterpartyLabel: 'IBC-Transfer'
					});
				return;
			}
			case 'MsgRecvPacket': {
				const t = packetTransfer(d.packet);
				if (!t || t.receiver !== address) return;
				push(`${at}.0`, t, {
					out: false,
					kind: 'transfer',
					counterparty: t.sender,
					counterpartyLabel: 'IBC-Transfer'
				});
				return;
			}
			case 'MsgDelegate': {
				if (str(d.delegator_address ?? d.delegatorAddress) !== address) return;
				const c = coin(d.amount);
				if (c)
					push(`${at}.0`, c, {
						out: true,
						kind: 'stake',
						counterparty: bonded,
						counterpartyLabel: 'Staking (gebunden)'
					});
				// Rewards withdrawn on the way are in the events only.
				unknownAmount = true;
				return;
			}
			case 'MsgCreateDeployment':
			case 'MsgDepositDeployment': {
				const owner = str(d.depositor) || str(d.id?.owner);
				if (owner !== address) return;
				const c = coin(d.deposit ?? d.amount);
				if (c)
					push(`${at}.0`, c, {
						out: true,
						kind: 'transfer',
						counterparty: '',
						counterpartyLabel: 'Akash-Escrow (Deployment)'
					});
				return;
			}
			case 'MsgAccountDeposit': {
				if (str(d.signer) !== address) return;
				const sources = Array.isArray(d.deposit?.sources) ? d.deposit.sources.map(str) : [];
				// From a grant, the granter paid; only a deposit from the balance is ours.
				if (sources.length && !sources.includes('balance')) return;
				const c = coin(d.deposit?.amount);
				if (c)
					push(`${at}.0`, c, {
						out: true,
						kind: 'transfer',
						counterparty: '',
						counterpartyLabel: 'Akash-Escrow (Deployment)'
					});
				return;
			}
			case 'MsgDeposit':
			case 'MsgSubmitProposal': {
				const who = str(d.depositor) || str(d.proposer);
				if (who !== address) return;
				coins(d.amount ?? d.initial_deposit ?? d.initialDeposit).forEach((c, part) =>
					push(`${at}.${part}`, c, {
						out: true,
						kind: 'transfer',
						counterparty: moduleAddress(chain.bech32Prefix, 'gov'),
						counterpartyLabel: 'Governance-Einlage'
					})
				);
				return;
			}
			default:
				if (AMOUNT_IN_EVENTS.has(type)) unknownAmount = true;
		}
	});
	return { entries, unknownDenoms, unknownAmount };
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.timeoutMs] the indexer is slow for long histories
 * @param {number} [options.maxTransactions] beyond that the older history is not read
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createAkashConsoleClient({
	fetch: f = fetch,
	timeoutMs = 45_000,
	maxTransactions = 5000,
	sleep
} = {}) {
	const getJson = createJsonFetcher({ fetch: f, timeoutMs, sleep });
	return {
		/**
		 * The address's transactions below `beforeHeight`, as entries.
		 *
		 * @param {object} p
		 * @param {import('./registry.js').CosmosChain} p.chain
		 * @param {string} p.address checked by cosmos.js already
		 * @param {string} p.indexer base URL, checked
		 * @param {number} p.beforeHeight the node's lowest height
		 */
		async history({ chain, address, indexer, beforeHeight }) {
			const base = `${indexer}/v1`;
			/** @type {{ hash: string, height: number }[]} */
			const older = [];
			let count = Infinity;
			for (let skip = 0; skip < count; skip += PER_PAGE) {
				const page = await getJson(
					`${base}/addresses/${encodeURIComponent(address)}/transactions/${skip}/${PER_PAGE}`
				);
				if (!Array.isArray(page?.results) || !Number.isSafeInteger(page?.count)) {
					throw new WalletError('the indexer answered without transactions', 'WALLET_INDEXER');
				}
				count = page.count;
				if (count > maxTransactions) {
					throw new WalletError(
						`more than ${maxTransactions} transactions in the indexer; older history not read`,
						'WALLET_TOO_MANY'
					);
				}
				for (const r of page.results) {
					const hash = str(r?.hash).toUpperCase();
					const height = Number(r?.height);
					if (HASH.test(hash) && height < beforeHeight) older.push({ hash, height });
				}
				if (!page.results.length) break;
			}

			/** @type {import('./cosmos.js').WalletEntry[]} */
			const entries = [];
			/** @type {Set<string>} */
			const unknown = new Set();
			let unknownAmounts = 0;
			/** @type {Set<string>} */
			const seen = new Set();
			older.sort((a, b) => a.height - b.height);
			for (const { hash } of older) {
				if (seen.has(hash)) continue;
				seen.add(hash);
				const tx = await getJson(`${base}/transactions/${hash}`);
				const result = normalizeConsoleTx(tx, { address, chain });
				entries.push(...result.entries);
				for (const d of result.unknownDenoms) unknown.add(d);
				if (result.unknownAmount) unknownAmounts++;
			}
			return {
				entries,
				transactions: seen.size,
				unknownAssets: unknown.size,
				unknownAmounts,
				earliestTime: entries[0]?.time ?? null
			};
		}
	};
}
