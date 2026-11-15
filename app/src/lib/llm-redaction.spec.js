import { describe, expect, it } from 'vitest';
import { llmFromStatus, redactionFromStatus } from './llm-redaction.js';

describe('redactionFromStatus', () => {
	it('blacked out, local, or not known', () => {
		expect(redactionFromStatus({ configured: true, redaction: { active: true } })).toBe(true);
		expect(
			redactionFromStatus({ configured: true, redaction: { active: false, local: true } })
		).toBe(false);
	});

	it('never "unredacted, stays here" without the bridge saying local', () => {
		// An older bridge (no `local`), or no model set up.
		expect(redactionFromStatus({ configured: true, redaction: { active: false } })).toBe(null);
		expect(
			redactionFromStatus({
				configured: true,
				redaction: { active: false, local: false, enclave: true }
			})
		).toBe('enclave');
		expect(
			redactionFromStatus({ configured: false, redaction: { active: false, local: true } })
		).toBe(null);
		expect(redactionFromStatus(null)).toBe(null);
	});
});

describe('llmFromStatus', () => {
	it('host, model and whether it runs on the bridge’s computer', () => {
		expect(
			llmFromStatus({
				configured: true,
				provider: 'api.example.com',
				models: { primary: 'model-a', fallback: null },
				redaction: { active: true, local: false }
			})
		).toEqual({ provider: 'api.example.com', model: 'model-a', local: false });
		expect(
			llmFromStatus({ configured: true, provider: null, models: {}, redaction: { local: true } })
		).toEqual({ provider: null, model: null, local: true });
	});

	it('null without a model set up', () => {
		expect(llmFromStatus({ configured: false, provider: 'api.example.com' })).toBeNull();
		expect(llmFromStatus(null)).toBeNull();
	});
});
