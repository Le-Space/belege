// Made-up addresses and a Skip Go memo for the tests of issue #170.

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
export const bech = (/** @type {string} */ prefix, /** @type {number} */ seed) =>
	`${prefix}1${Array.from({ length: 38 }, (_, i) => CHARSET[(seed * 7 + i * 3) % 32]).join('')}`;

/** A Skip Go memo as a wallet's swap sends it. */
export const skipMemo = ({
	receiver = bech('akash', 2),
	recover = bech('osmo', 2),
	min = '15000000'
} = {}) =>
	JSON.stringify({
		wasm: {
			contract: bech('osmo', 5),
			msg: {
				swap_and_action: {
					user_swap: {
						swap_exact_asset_in: {
							swap_venue_name: 'osmosis-poolmanager',
							operations: [
								{ pool: '1', denom_in: 'ibc/AAA', denom_out: 'ibc/BBB' },
								{ pool: '2', denom_in: 'ibc/BBB', denom_out: 'ibc/CCC' }
							]
						}
					},
					min_asset: { native: { denom: 'ibc/CCC', amount: min } },
					timeout_timestamp: 1,
					post_swap_action: {
						ibc_transfer: {
							ibc_info: {
								source_channel: 'channel-1',
								receiver,
								memo: '',
								recover_address: recover
							}
						}
					},
					affiliates: [
						{ basis_points_fee: '57', address: bech('osmo', 7) },
						{ basis_points_fee: '18', address: bech('osmo', 8) }
					]
				}
			}
		}
	});
