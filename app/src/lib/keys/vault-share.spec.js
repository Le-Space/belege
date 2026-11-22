// The vault's record for every own device (#962): written when it says
// something new, and not again because another device wrote after it.
// Made-up values.
import { describe, expect, it } from 'vitest';

import { shareVault, VAULT_RECORD_SETTING } from './vault-share.js';

const BOOKS = 'did:key:z6MkBooksExample';

/** One settings log both devices write to, as sync makes it. */
function sharedSettings() {
	/** @type {{ payload: { op: string, value: any } }[]} */
	const entries = [];
	let id = 0;
	const latest = (/** @type {string} */ key) =>
		[...entries].reverse().find((e) => e.payload.value.key === key)?.payload.value ?? null;
	const settings = /** @type {any} */ ({
		/** @param {{ where?: (record: any) => boolean }} [o] */
		async list({ where } = {}) {
			const keys = [...new Set(entries.map((e) => e.payload.value.key))];
			return keys.map(latest).filter((r) => r && (!where || where(r)));
		},
		async put(/** @type {any} */ record) {
			const value = { ...record, id: record.id ?? `rec-${++id}` };
			entries.push({ payload: { op: 'PUT', value } });
			return value;
		}
	});
	const settingsDb = {
		log: {
			async *iterator() {
				for (const e of [...entries].reverse()) yield e;
			}
		},
		access: { writerOf: async () => BOOKS }
	};
	const writes = () => entries.filter((e) => e.payload.value.key === VAULT_RECORD_SETTING).length;
	return { settings, settingsDb, writes };
}

/** @param {string} vaultId */
const recordOf = (vaultId) =>
	/** @type {any} */ ({
		vault: { id: vaultId, payload: 'sealed', slots: [{ kid: 'kid-a', sealed: 'x' }] },
		slots: [
			{ kid: 'kid-a', label: 'E2E', credentialId: 'cred-a', addedAt: '2026-01-05T10:00:00.000Z' }
		],
		removed: []
	});

describe('shareVault', () => {
	it('writes a record once, and not when it is already the newest', async () => {
		const { settings, settingsDb, writes } = sharedSettings();
		const mine = recordOf('vault-a');
		expect(await shareVault(settings, mine, { settingsDb, booksId: BOOKS })).toBe(true);
		expect(await shareVault(settings, mine, { settingsDb, booksId: BOOKS })).toBe(false);
		expect(writes()).toBe(1);
	});

	it('two devices with two vaults of the same books each write theirs once, not back and forth', async () => {
		const { settings, settingsDb, writes } = sharedSettings();
		const mac = recordOf('vault-a');
		const phone = recordOf('vault-b');
		// Each device shares again whenever a record came by sync: ten rounds.
		for (let round = 0; round < 10; round++) {
			await shareVault(settings, mac, { settingsDb, booksId: BOOKS });
			await shareVault(settings, phone, { settingsDb, booksId: BOOKS });
		}
		expect(writes()).toBe(2);
	});

	it('without the log, compared with the newest record only, as before', async () => {
		const { settings, writes } = sharedSettings();
		const mac = recordOf('vault-a');
		const phone = recordOf('vault-b');
		for (let round = 0; round < 3; round++) {
			await shareVault(settings, mac);
			await shareVault(settings, phone);
		}
		// What #962 did: every round, each wrote its own back.
		expect(writes()).toBe(6);
	});
});
