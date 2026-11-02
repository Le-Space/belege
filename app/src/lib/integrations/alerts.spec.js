import { describe, expect, it } from 'vitest';

import { memoryCollection } from '../bank/test-support.js';
import { krakenKeyProblem, loadAlerts, rememberConsents, updateAlerts } from './alerts.js';

describe('what the last runs left', () => {
	it('kept in the settings, cleared by the next run; nothing odd kept', async () => {
		const settings = memoryCollection('settings').collection;
		expect(await loadAlerts(settings)).toEqual({ kraken: null, wallets: {}, enablebanking: [] });
		await updateAlerts(settings, (a) => ({
			...a,
			kraken: { raw: 'EAPI:Invalid nonce' },
			wallets: { w1: 2 }
		}));
		expect(await loadAlerts(settings)).toEqual({
			kraken: { raw: 'EAPI:Invalid nonce' },
			wallets: { w1: 2 },
			enablebanking: []
		});
		await updateAlerts(settings, (a) => ({ ...a, kraken: null, wallets: { ...a.wallets, w1: 0 } }));
		expect(await loadAlerts(settings)).toEqual({ kraken: null, wallets: {}, enablebanking: [] });
	});

	it('a Kraken error that means the key', () => {
		expect(krakenKeyProblem('Kraken: EAPI:Invalid nonce')).toBe(true);
		expect(krakenKeyProblem('EGeneral:Permission denied')).toBe(true);
		expect(krakenKeyProblem('Die Bridge ist nicht erreichbar')).toBe(false);
	});

	it('the consents’ ends: the bank and the day, nothing else, and replaced as a whole', async () => {
		const settings = memoryCollection('settings').collection;
		await updateAlerts(settings, (a) => ({ ...a, kraken: { raw: 'EAPI:Invalid key' } }));
		await rememberConsents(settings, [
			{
				bank: 'Beispielbank',
				country: 'DE',
				psuType: 'business',
				validUntil: '2027-03-30T00:00:00Z'
			},
			{ bank: 'Musterbank Privat', country: 'DE', psuType: 'personal', validUntil: null }
		]);
		expect(await loadAlerts(settings)).toMatchObject({
			kraken: { raw: 'EAPI:Invalid key' },
			enablebanking: [
				{
					bank: 'Beispielbank',
					country: 'DE',
					psuType: 'business',
					validUntil: '2027-03-30T00:00:00Z'
				}
			]
		});
		await rememberConsents(settings, []);
		expect((await loadAlerts(settings)).enablebanking).toEqual([]);
	});
});
