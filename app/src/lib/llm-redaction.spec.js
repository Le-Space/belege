import { describe, expect, it } from 'vitest';
import { redactionFromStatus } from './llm-redaction.js';

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
