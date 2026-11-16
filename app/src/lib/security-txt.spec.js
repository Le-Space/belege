// /.well-known/security.txt (RFC 9116): the contacts SECURITY.md names, and an
// Expires that is neither past nor more than a year ahead. This test failing
// after a year is the reminder to renew it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const text = readFileSync(
	new URL('../../static/.well-known/security.txt', import.meta.url),
	'utf8'
);
/** @param {string} name */
const fields = (name) =>
	text
		.split('\n')
		.filter((l) => l.startsWith(`${name}: `))
		.map((l) => l.slice(name.length + 2).trim());

describe('security.txt', () => {
	it('names both contacts, the policy and itself', () => {
		expect(fields('Contact')).toEqual([
			'mailto:security@le-space.de',
			'https://github.com/Le-Space/belege/security/advisories/new'
		]);
		expect(fields('Policy')).toEqual(['https://github.com/Le-Space/belege/blob/main/SECURITY.md']);
		expect(fields('Canonical')).toEqual(['https://belege.le-space.de/.well-known/security.txt']);
		expect(fields('Preferred-Languages')).toEqual(['de, en']);
	});

	it('expires in the future, at most a year ahead', () => {
		const at = Date.parse(fields('Expires')[0]);
		expect(at).toBeGreaterThan(Date.now());
		expect(at - Date.now()).toBeLessThanOrEqual(366 * 24 * 3600 * 1000);
	});
});
