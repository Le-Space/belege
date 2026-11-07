// SPDX-License-Identifier: AGPL-3.0-or-later
//
// The bridge contract on NEAR, as the launcher sees it: the open requests,
// whether a key belongs to the books, and the two calls it makes
// (register_bridge, ack_request), signed with the launcher's own account.

import { Account } from '@near-js/accounts';
import { JsonRpcProvider } from '@near-js/providers';
import { KeyPairSigner } from '@near-js/signers';

const TGAS = 1_000_000_000_000n;

/**
 * @param {{ rpcUrl: string, contractId: string, accountId: string, secretKey: string }} o
 */
export function nearClient({ rpcUrl, contractId, accountId, secretKey }) {
	const provider = new JsonRpcProvider({ url: rpcUrl });
	const account = new Account(
		accountId,
		provider,
		KeyPairSigner.fromSecretKey(/** @type {any} */ (secretKey))
	);
	return {
		contractId,
		accountId,
		/** @returns {Promise<{ books: string, request: { kind: 'Start' | 'Stop', by: string, at_ms: string } }[]>} */
		async requests() {
			return /** @type {any} */ (
				(await provider.callFunction(contractId, 'get_requests', {})) ?? []
			);
		},
		/** @param {string} books */
		async books(books) {
			return /** @type {any} */ (await provider.callFunction(contractId, 'get_books', { books }));
		},
		/**
		 * Does this key belong to `accountId` (full access, or a function-call key for the contract)?
		 *
		 * @param {string} owner
		 * @param {string} publicKey ed25519:…
		 */
		async keyBelongsTo(owner, publicKey) {
			try {
				const key = /** @type {any} */ (await provider.viewAccessKey(owner, publicKey));
				const p = key?.permission;
				return p === 'FullAccess' || p?.FunctionCall?.receiver_id === contractId;
			} catch {
				return false;
			}
		},
		/** @param {{ books: string, attestation: any, intakeKeyHash: string }} o */
		async registerBridge({ books, attestation, intakeKeyHash }) {
			return account.callFunction({
				contractId,
				methodName: 'register_bridge',
				args: { books, attestation, intake_key_hash: intakeKeyHash },
				gas: 300n * TGAS
			});
		},
		/** @param {{ books: string, atMs: string, outcome: string }} o */
		async ack({ books, atMs, outcome }) {
			return account.callFunction({
				contractId,
				methodName: 'ack_request',
				args: { books, at_ms: atMs, outcome },
				gas: 30n * TGAS
			});
		}
	};
}
