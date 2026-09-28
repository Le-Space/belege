import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { krakenKeyProblem, loadAlerts, updateAlerts } from './alerts.js';

describe('what the last runs left', () => {
	it('kept in the settings, cleared by the next run; nothing odd kept', async () => {
		const settings = memoryCollection('settings').collection;
		expect(await loadAlerts(settings)).toEqual({ kraken: null, wallets: {} });
		await updateAlerts(settings, (a) => ({
			...a,
			kraken: { raw: 'EAPI:Invalid nonce' },
			wallets: { w1: 2 }
		}));
		expect(await loadAlerts(settings)).toEqual({
			kraken: { raw: 'EAPI:Invalid nonce' },
			wallets: { w1: 2 }
		});
		await updateAlerts(settings, (a) => ({ ...a, kraken: null, wallets: { ...a.wallets, w1: 0 } }));
		expect(await loadAlerts(settings)).toEqual({ kraken: null, wallets: {} });
	});

	it('a Kraken error that means the key', () => {
		expect(krakenKeyProblem('Kraken: EAPI:Invalid nonce')).toBe(true);
		expect(krakenKeyProblem('EGeneral:Permission denied')).toBe(true);
		expect(krakenKeyProblem('Die Bridge ist nicht erreichbar')).toBe(false);
	});
});
