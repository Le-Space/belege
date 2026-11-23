// SPDX-License-Identifier: AGPL-3.0-or-later
// The neutral shape a chain reader hands out (Le-Space/belege#264): one entry per value
// movement of a wallet, signed from the wallet's side, with the fee as an
// entry of its own. The readers in @le-space/chains return it; Belege books
// from it (wallet-sync.js) and a CSV import can produce it too (Monero, #262).

/**
 * @typedef {object} ChainAsset
 * @property {string} symbol as in the app's assets/registry.js and the bridge's rates.js
 * @property {number} decimals
 */

/**
 * @typedef {object} WalletEntry
 * @property {string} id unique and stable: `<hash>:m<msg_index>:e<event>.<triple>:<asset>`, the fee `<hash>:fee`
 * @property {string} hash
 * @property {number} height
 * @property {string} time ISO 8601
 * @property {string} date YYYY-MM-DD (UTC)
 * @property {'sent' | 'received' | 'fee'} type
 * @property {'transfer' | 'reward' | 'stake' | 'ibc' | 'fee' | 'swap'} kind
 * @property {{ gave: { asset: string, amount: string, listed: boolean }[], got: { asset: string, amount: string, listed: boolean }[], via: string, fee?: { asset: string, amount: string }, storage?: { asset: string, amount: string } }} [swap] EVM: what the wallet gave and got in a swap, and its gas (evm.js markSwaps); NEAR: also what the storage deposits made for it kept
 * @property {string} [partOf] NEAR: a storage deposit made for a swap in another transaction (and that transaction's gas), type `fee`: the swap's hash
 * @property {{ hash: string, kind: 'transfer' | 'receipt' }} [enables] NEAR: a storage deposit (and its transaction's gas), type `fee`,
 *   that registered an account at a token so that a transfer of it (to the account registered) or the wallet's first
 *   receipt of it could happen: that transaction's hash, and which of the two it was
 * @property {'storage'} [purpose] NEAR: a storage deposit, type `fee`, whatever it was for; one with neither `partOf`
 *   nor `enables` is a storage deposit of its own – a cost to the network's contracts, no payment for a service
 * @property {{ account: string, only?: boolean, tokens?: string[] }} [registration] NEAR: whom a storage deposit
 *   registered (`account_id`, the signer when not given), `registration_only` and a DEX's token list, as the call said
 * @property {string} asset symbol
 * @property {string} amount signed decimal: negative when it left the wallet
 * @property {number} decimals
 * @property {string} counterparty the other address ('' for a fee)
 * @property {string} counterpartyLabel a module's name, or ''
 * @property {string} memo
 * @property {boolean} success false for the fee of a failed transaction
 * @property {string} [ibcMemo] Cosmos: an IBC transfer's own memo (MsgTransfer.memo), e.g. a swap's plan (#170)
 * @property {boolean} [byOther] EVM: sent out in a transaction this address did not send (#162)
 * @property {string} [txFrom] EVM: who sent that transaction, where known
 * @property {string} explorerUrl
 * @property {string} [contract] EVM: a token not in the chain's list, by its contract (issue #115)
 * @property {boolean} [listed] false for such a token: its symbol is its own claim
 */

export {};
