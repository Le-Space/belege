import { describe, expect, it } from 'vitest';
import { memoryCollection } from './bank/test-support.js';
import { CONSENT_VERSION } from './consent.js';
import {
	ACK_KEEP,
	ACK_TEXTS,
	ackKey,
	addAcknowledgment,
	isCurrent,
	readAcknowledgment,
	recordAcknowledgment
} from './acknowledgments.js';

const at = new Date('2026-10-31T09:15:00Z');

describe('acknowledgments (#1053)', () => {
	it('keeps the text version and the time in the settings collection', async () => {
		const { collection: settings } = memoryCollection('settings');
		const { entry } = await recordAcknowledgment(
			settings,
			'export',
			{ month: '2026-10', app: 'v0.64.0' },
			at
		);
		expect(entry).toEqual({
			text: ACK_TEXTS.export,
			at: '2026-10-31T09:15:00.000Z',
			month: '2026-10',
			app: 'v0.64.0'
		});
		const [record] = await settings.list({ where: (r) => r.key === ackKey('export') });
		expect(record.value.entries).toEqual([entry]);
		expect((await readAcknowledgment(settings, 'export')).entries).toEqual([entry]);
	});

	it('adds every confirmation, newest first, and keeps a bounded number', async () => {
		const { collection: settings } = memoryCollection('settings');
		await recordAcknowledgment(settings, 'export', { month: '2026-09' }, new Date('2026-10-01'));
		await recordAcknowledgment(settings, 'export', { month: '2026-10' }, new Date('2026-11-01'));
		const { entries } = await readAcknowledgment(settings, 'export');
		expect(entries.map((e) => e.month)).toEqual(['2026-10', '2026-09']);

		let value = null;
		for (let i = 0; i < ACK_KEEP + 5; i++) value = addAcknowledgment(value, 'export').record;
		expect(value?.entries).toHaveLength(ACK_KEEP);
	});

	it('takes only the month and the app – nothing of the books', () => {
		const { entry } = addAcknowledgment(
			null,
			'export',
			{ app: 'v0.64.0', amount: '-12,34', name: 'Wolkenfabrik Hosting GmbH', month: 7 },
			at
		);
		expect(Object.keys(entry).sort()).toEqual(['app', 'at', 'text']);
	});

	it('is current only for the text as it is now', () => {
		expect(isCurrent(null, 'recovery-words')).toBe(false);
		const old = { entries: [{ text: 'keys-0', at: at.toISOString() }] };
		expect(isCurrent(old, 'recovery-words')).toBe(false);
		const { record } = addAcknowledgment(old, 'recovery-words', {}, at);
		expect(isCurrent(record, 'recovery-words')).toBe(true);
		expect(ACK_TEXTS.consent).toBe(`consent-${CONSENT_VERSION}`);
	});

	it('refuses a kind it does not know', () => {
		expect(() => addAcknowledgment(null, /** @type {any} */ ('other'))).toThrow();
	});
});
