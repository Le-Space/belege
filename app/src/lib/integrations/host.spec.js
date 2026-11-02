import { describe, expect, it } from 'vitest';
import { canHostBridge } from './host.js';

describe('where a bridge can run', () => {
	it('a Mac, a Windows or Linux computer: yes', () => {
		expect(
			canHostBridge({
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)',
				maxTouchPoints: 0
			})
		).toBe(true);
		expect(canHostBridge({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' })).toBe(true);
		expect(canHostBridge({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)' })).toBe(true);
	});

	it('a phone or tablet: no – Android, iPhone, and the iPad that calls itself a Macintosh', () => {
		expect(
			canHostBridge({ userAgent: 'Mozilla/5.0 (Linux; Android 15; SM-S938B)', maxTouchPoints: 5 })
		).toBe(false);
		expect(
			canHostBridge({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' })
		).toBe(false);
		expect(
			canHostBridge({
				userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
				maxTouchPoints: 5
			})
		).toBe(false);
	});
});
