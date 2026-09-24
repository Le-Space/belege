// Ported from Le-Space/simple-todo packages/todo (src/moment.spec.js) at f0d3df4. Changed: nothing
// but this header.
import { describe, expect, it } from 'vitest';
import { describeMoment, localStamp, utcStamp } from './moment.js';

/** Whitespace as a reader sees it: ICU puts narrow no-break spaces before AM/PM. */
// eslint-disable-next-line no-irregular-whitespace -- the spaces ICU writes are the point
const plain = (/** @type {string} */ text) => text.replace(/[\s  ]+/g, ' ').trim();

// The convention's own example: one instant, the 20th in Berlin and the 19th
// everywhere west of it.
const instant = new Date('2026-09-19T22:48:00Z');

describe('a moment, in the reader’s terms', () => {
	it('reads as the 20th in Berlin, with the zone named', () => {
		expect(plain(localStamp(instant, 'de-DE', 'Europe/Berlin'))).toBe('20.09.2026, 00:48 MESZ');
	});

	it('reads as the 19th in New York, on a 12-hour clock', () => {
		expect(plain(localStamp(instant, 'en-US', 'America/New_York'))).toBe(
			'09/19/2026, 06:48 PM EDT'
		);
	});

	it('is the same instant in UTC on hover', () => {
		expect(utcStamp(instant)).toBe('2026-09-19 22:48 UTC');
	});
});

describe('describeMoment', () => {
	it('gives the <time> element all three', () => {
		const moment = describeMoment('2026-09-19T22:48:00Z', 'de-DE', 'Europe/Berlin');
		expect(moment?.datetime).toBe('2026-09-19T22:48:00.000Z');
		expect(plain(moment?.local ?? '')).toBe('20.09.2026, 00:48 MESZ');
		expect(moment?.utc).toBe('2026-09-19 22:48 UTC');
	});

	it('accepts a commit date with its offset, as git writes it', () => {
		expect(describeMoment('2026-09-20T00:48:00+02:00')?.datetime).toBe('2026-09-19T22:48:00.000Z');
	});

	it('says nothing for a value that is no moment, instead of throwing', () => {
		expect(describeMoment('')).toBeNull();
		expect(describeMoment(undefined)).toBeNull();
		expect(describeMoment('next tuesday')).toBeNull();
	});
});
