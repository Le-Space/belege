// SPDX-License-Identifier: AGPL-3.0-or-later
// The chain readers run the same in Chromium as in Node: no Buffer, no
// node:crypto, fetch and endpoints handed in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameInChromium } from '@le-space/browser-test';

test('addresses, transactions and a NEAR read are the same in Chromium and in Node', async (t) => {
	const r = await sameInChromium(t, new URL('./browser/scenario.js', import.meta.url));
	if (!r) return;
	assert.equal(r.tx.memo, 'Rechnung 2026-001 Wolkenfabrik');
	assert.equal(r.events[0].attributes[0].value, 'akash1example');
	assert.match(r.f410f, /^f410f[a-z2-7]+$/);
	assert.match(r.btc[1], /^bc1q/);
	assert.ok(r.near.count > 0 && r.near.explorer);
	assert.equal(r.near.first.schema, 'le-space.ledger/1');
});
