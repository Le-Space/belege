import { describe, expect, it } from 'vitest';
import { sharedOrigin } from './shared-origin.js';

describe('sharedOrigin', () => {
	it('is a path-style gateway under /ipfs/ or /ipns/', () => {
		expect(sharedOrigin('/ipfs/bafybeiexample/')).toBe(true);
		expect(sharedOrigin('/ipns/belege.le-space.de/zahlungen')).toBe(true);
	});

	it('is an origin of its own on the domain or a subdomain gateway', () => {
		for (const path of ['/', '/zahlungen', '/integrationen/ipfs/', '/ipfs']) {
			expect(sharedOrigin(path)).toBe(false);
		}
	});
});
