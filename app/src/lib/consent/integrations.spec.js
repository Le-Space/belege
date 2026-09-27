// The consent screen's list of what Belege works with: complete for the
// chains a wallet can be on, every logo embedded, nothing loaded from outside.
import { describe, expect, it } from 'vitest';

import { INTEGRATION_GROUPS, LOGOS } from './integrations.js';
import { WALLET_CHAINS } from '../wallets/chains.js';

describe('integrations on the consent screen', () => {
	it('names every chain a wallet can be on', () => {
		const chains = INTEGRATION_GROUPS.find((g) => g.id === 'chains')?.items.map((i) => i.id) ?? [];
		for (const id of Object.keys(WALLET_CHAINS)) expect(chains, id).toContain(id);
	});

	it('every logo is embedded; every other entry has initials', () => {
		for (const group of INTEGRATION_GROUPS) {
			for (const item of group.items) {
				if (item.logo) expect(LOGOS[item.logo], item.id).toBeDefined();
				else expect(item.initials, item.id).toMatch(/^[A-Za-z]{1,3}$/);
			}
		}
		for (const [key, logo] of Object.entries(LOGOS)) {
			expect(logo.path, key).toMatch(/^[Mm][\d\s.,MLHVCSQTAZmlhvcsqtaz-]+$/);
			expect(logo.color === null || /^#[0-9A-F]{6}$/i.test(logo.color), key).toBe(true);
		}
	});
});
