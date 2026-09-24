import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { CONSENT_STORAGE_KEY, CONSENT_VERSION, createConsent } from './consent.js';

function memoryStorage(initial = /** @type {Record<string, string>} */ ({})) {
	const values = new Map(Object.entries(initial));
	return {
		values,
		/** @param {string} key */
		getItem: (key) => values.get(key) ?? null,
		/** @param {string} key @param {string} value */
		setItem: (key, value) => void values.set(key, value)
	};
}

const blocked = {
	getItem() {
		throw new DOMException('The operation is insecure.', 'SecurityError');
	},
	setItem() {
		throw new DOMException('The operation is insecure.', 'SecurityError');
	}
};

describe('the consent screen', () => {
	it('opens on a first visit', () => {
		const storage = memoryStorage();
		const consent = createConsent({ storage: () => storage });
		expect(get(consent.open)).toBe(true);
		expect(get(consent.accepted)).toBe(false);
	});

	it('remembers "Verstanden" as a versioned flag, and nothing else', () => {
		const storage = memoryStorage();
		const consent = createConsent({ storage: () => storage });
		consent.accept();
		expect(get(consent.open)).toBe(false);
		expect([...storage.values]).toEqual([[CONSENT_STORAGE_KEY, CONSENT_VERSION]]);
		expect(get(createConsent({ storage: () => storage }).open)).toBe(false);
	});

	it('opens again when the version changes', () => {
		const storage = memoryStorage({ [CONSENT_STORAGE_KEY]: '0' });
		expect(get(createConsent({ storage: () => storage }).open)).toBe(true);
	});

	it('cannot be closed without a decision, and can be once accepted', () => {
		const storage = memoryStorage();
		const consent = createConsent({ storage: () => storage });
		consent.close();
		expect(get(consent.open)).toBe(true);
		consent.accept();
		consent.reopen();
		expect(get(consent.open)).toBe(true);
		consent.close();
		expect(get(consent.open)).toBe(false);
	});

	it('shows itself when storage is blocked, and still lets the page go on', () => {
		const consent = createConsent({ storage: () => blocked });
		expect(get(consent.open)).toBe(true);
		expect(() => consent.accept()).not.toThrow();
		expect(get(consent.open)).toBe(false);
		consent.reopen();
		consent.close();
		expect(get(consent.open)).toBe(false);
	});
});
