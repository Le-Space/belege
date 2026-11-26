// SPDX-License-Identifier: AGPL-3.0-or-later
// Which movement needs an Eigenbeleg (eigenbeleg-agent#116 step 2): consumption
// only; fees, rewards, swaps, deposits and transfers stay on the statement.
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
	CONSUMPTION_CHAINS,
	CONSUMPTION_KINDS,
	STATEMENT_KINDS,
	consumptionDue,
	monthOver,
	needsEigenbeleg
} from '../src/index.js';

test('consumption on Aleph, Filecoin Pay and Akash needs an Eigenbeleg', () => {
	for (const chain of CONSUMPTION_CHAINS)
		assert.equal(needsEigenbeleg({ chain, kind: 'usage', type: 'sent', success: true }), true);
	assert.deepEqual(CONSUMPTION_KINDS, ['usage']);
});

test('fees, rewards, swaps, deposits and transfers are left to the statement', () => {
	for (const chain of [...CONSUMPTION_CHAINS, 'near', 'ethereum'])
		for (const kind of STATEMENT_KINDS)
			assert.equal(needsEigenbeleg({ chain, kind, type: 'sent', success: true }), false, kind);
	for (const kind of ['fee', 'reward', 'swap', 'escrow', 'storage', 'transfer'])
		assert.ok(STATEMENT_KINDS.includes(kind), kind);
});

test('usage elsewhere, received, or failed needs none', () => {
	assert.equal(needsEigenbeleg({ chain: 'near', kind: 'usage', type: 'sent' }), false);
	assert.equal(needsEigenbeleg({ chain: 'aleph', kind: 'usage', type: 'received' }), false);
	assert.equal(needsEigenbeleg({ chain: 'aleph', kind: 'usage', success: false }), false);
});

test('only a month that is over', () => {
	assert.equal(monthOver('2026-03', '2026-04-01'), true);
	assert.equal(monthOver('2026-04', '2026-04-30'), false);
	assert.equal(monthOver('2026-05', '2026-04-30'), false);
	assert.equal(monthOver('2026-13', '2027-01-01'), false);
	const entries = [
		{ chain: 'aleph', kind: 'swap', type: 'sent' },
		{ chain: 'aleph', kind: 'usage', type: 'sent' }
	];
	assert.equal(consumptionDue({ month: '2026-03', today: '2026-04-02', entries }), true);
	assert.equal(consumptionDue({ month: '2026-04', today: '2026-04-02', entries }), false);
	assert.equal(
		consumptionDue({ month: '2026-03', today: '2026-04-02', entries: entries.slice(0, 1) }),
		false
	);
});
