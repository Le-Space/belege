// Every collection an unlock opens has a name in both catalogues, so the
// progress line never shows a raw key such as onboarding.progress.collection.x.
import { describe, expect, it } from 'vitest';

import de from './i18n/de.js';
import en from './i18n/en.js';
import { COLLECTIONS } from './store/repository.js';

describe('the unlock progress', () => {
	it('names every collection in German and English', () => {
		for (const name of COLLECTIONS) {
			expect(de.onboarding.progress.collection, name).toHaveProperty(name);
			expect(en.onboarding.progress.collection, name).toHaveProperty(name);
		}
	});
});
