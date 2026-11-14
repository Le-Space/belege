// The areas a device may use at the bridge (#579): the protocol's scope
// names, labelled from the catalogue, ticked one at a time; and a refusal
// for a missing scope says which area, with no other way tried. Made-up
// answers only.
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEVICE_SCOPES } from '@le-space/bridge-protocol';
import { createBridgeClient } from './client.js';
import { scopeChoices, scopeLabel, toggled } from './scopes.js';

afterEach(() => vi.unstubAllGlobals());

describe('the areas of the bridge a device may use', () => {
	it('every scope the protocol defines has a label of its own', () => {
		for (const scope of DEVICE_SCOPES) {
			expect(scopeLabel(scope)).not.toBe(scope);
			expect(scopeLabel(scope)).not.toMatch(/^devices\./);
		}
		expect(scopeLabel('bridge:mail:read')).toBe('Mails lesen');
		// A scope a newer bridge offers and this app does not know: its name.
		expect(scopeLabel('bridge:future:read')).toBe('bridge:future:read');
	});

	it('the choices are what the bridge says a set is made of, in the protocol’s order', () => {
		expect(
			scopeChoices({
				scopes: ['bridge:llm', 'bridge:grants:manage', 'bridge:bank:read'],
				settable: ['bridge:llm', 'bridge:future:read', 'bridge:bank:read']
			})
		).toEqual(['bridge:bank:read', 'bridge:llm', 'bridge:future:read']);
		// An older bridge without `settable`: the protocol's scopes among those offered.
		expect(
			scopeChoices({ scopes: ['bridge:llm', 'bridge:grants:manage', 'bridge:settings:export'] })
		).toEqual(['bridge:llm']);
	});

	it('a box ticked or not changes that scope only, of the choices', () => {
		const choices = ['bridge:bank:read', 'bridge:llm', 'bridge:mail:read'];
		const held = ['bridge:bank:read', 'bridge:llm', 'bridge:mail:read', 'bridge:grants:manage'];
		expect(toggled(held, choices, 'bridge:mail:read', false)).toEqual([
			'bridge:bank:read',
			'bridge:llm'
		]);
		expect(toggled(['bridge:llm'], choices, 'bridge:mail:read', true)).toEqual([
			'bridge:llm',
			'bridge:mail:read'
		]);
	});

	it('a missing scope is said as the area it is, and no other way is tried', async () => {
		const fetch = vi.fn(
			async () =>
				new Response(JSON.stringify({ error: 'bridge:mail:read', code: 'BRIDGE_SCOPE_MISSING' }), {
					status: 403,
					headers: { 'content-type': 'application/json' }
				})
		);
		vi.stubGlobal('fetch', fetch);
		const error = await createBridgeClient({ token: 't' })
			.mailSearch({ text: 'Rechnung' })
			.catch((/** @type {any} */ e) => e);
		expect(error.code).toBe('BRIDGE_SCOPE_MISSING');
		expect(error.status).toBe(403);
		expect(error.message).toContain('Mails lesen');
		expect(fetch).toHaveBeenCalledTimes(1);
	});
});
