// The question a restore asks on an empty device (#406), against the real
// Aleph: "is there a vault for this passkey?" A read, free of charge, for a
// passkey nobody has – the answer must be "none", in time. The E2E restore
// asks the same and fails when Aleph does not answer; this says whether
// Aleph or the app is to blame. Skipped unless ALEPH_LIVE=1 (aleph-smoke.yml,
// once a day): the unit tests never dial out.
import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';

import { alephEndpoints } from './keeper.js';
import { findVaultOnAleph } from './vault-index.js';

describe.skipIf(process.env.ALEPH_LIVE !== '1')('the vault index on the real Aleph', () => {
	it('answers "none" for a passkey nobody has, within 20 s', async () => {
		const prfOutput = webcrypto.getRandomValues(new Uint8Array(32));
		const started = Date.now();
		const found = await findVaultOnAleph({
			prfOutput,
			endpoints: alephEndpoints(),
			fetch: (url) => fetch(url, { signal: AbortSignal.timeout(20_000) })
		});
		expect(found).toBeNull();
		expect(Date.now() - started).toBeLessThan(20_000);
	}, 30_000);
});
