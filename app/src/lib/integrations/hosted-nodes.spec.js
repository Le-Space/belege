import { describe, expect, it } from 'vitest';
import {
	isUnverifiableNode,
	nodeHistoryOf,
	noteUnlocked,
	noteUnverifiable,
	preferredNode
} from './hosted-nodes.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);
const T1 = '2026-01-01T10:00:00.000Z';
const T2 = '2026-01-02T10:00:00.000Z';
const nodes = [
	{ hash: A, fits: true },
	{ hash: B, fits: true },
	{ hash: C, fits: false }
];
const empty = nodeHistoryOf(null);

describe('isUnverifiableNode', () => {
	it('AMD’s key server without a certificate for the node’s processor and firmware', () => {
		expect(
			isUnverifiableNode(
				new Error('AMD KDS answered 404 for the VCEK: https://kdsintf.amd.com/vcek/v1/Example/00')
			)
		).toBe(true);
		expect(isUnverifiableNode('attest: AMD KDS answered 404 for the VCEK: https://…')).toBe(true);
	});

	it('not a key server that is down, a wrong measurement or anything else', () => {
		expect(isUnverifiableNode(new Error('AMD KDS answered 503 for the VCEK'))).toBe(false);
		expect(isUnverifiableNode(new Error('measurement does not match: no secret goes out'))).toBe(
			false
		);
		expect(isUnverifiableNode(null)).toBe(false);
	});
});

describe('nodeHistoryOf', () => {
	it('keeps only node hashes with a time', () => {
		expect(
			nodeHistoryOf({
				unverifiable: { [A]: T1, nope: T1, [B]: 'when' },
				lastUnlocked: { crn: C, at: T2 }
			})
		).toEqual({ unverifiable: { [A]: T1 }, lastUnlocked: { crn: C, at: T2 } });
		expect(nodeHistoryOf({ lastUnlocked: { crn: 'x', at: T1 } })).toEqual(empty);
		expect(nodeHistoryOf('junk')).toEqual(empty);
	});
});

describe('preferredNode', () => {
	it('without a history: the best with room, as before', () => {
		expect(preferredNode(nodes, empty)).toBe(A);
		expect(preferredNode([{ hash: C, fits: false }], empty)).toBe(C);
		expect(preferredNode([], empty)).toBe('');
	});

	it('a node that could not be checked last time is not preselected', () => {
		expect(preferredNode(nodes, noteUnverifiable(empty, A, T1))).toBe(B);
	});

	it('the node the last unlock held on comes first, while it has room', () => {
		expect(preferredNode(nodes, noteUnlocked(empty, B, T1))).toBe(B);
		expect(preferredNode(nodes, noteUnlocked(empty, C, T1))).toBe(A);
		// It left the list: the best of the rest.
		expect(preferredNode(nodes, noteUnlocked(empty, 'd'.repeat(64), T1))).toBe(A);
	});

	it('a tight node that can be checked before one with room that could not', () => {
		const history = noteUnverifiable(noteUnverifiable(empty, A, T1), B, T1);
		expect(preferredNode(nodes, history)).toBe(C);
	});

	it('only uncheckable nodes left: still one to start on, by hand', () => {
		const history = noteUnverifiable(empty, A, T1);
		expect(preferredNode([{ hash: A, fits: true }], history)).toBe(A);
	});
});

describe('noteUnverifiable and noteUnlocked', () => {
	it('an unlock that holds clears the mark and is remembered', () => {
		const failed = noteUnverifiable(empty, A, T1);
		expect(failed.unverifiable).toEqual({ [A]: T1 });
		expect(noteUnlocked(failed, A, T2)).toEqual({
			unverifiable: {},
			lastUnlocked: { crn: A, at: T2 }
		});
	});

	it('a failure keeps where the last unlock held', () => {
		const history = noteUnverifiable(noteUnlocked(empty, B, T1), A, T2);
		expect(history).toEqual({ unverifiable: { [A]: T2 }, lastUnlocked: { crn: B, at: T1 } });
	});

	it('remembers a bounded number of nodes, the latest', () => {
		let history = empty;
		for (let i = 0; i < 40; i++) {
			const crn = i.toString(16).padStart(64, '0');
			history = noteUnverifiable(history, crn, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
		}
		expect(Object.keys(history.unverifiable)).toHaveLength(32);
		expect(history.unverifiable[(39).toString(16).padStart(64, '0')]).toBeTruthy();
		expect(history.unverifiable['0'.repeat(64)]).toBeUndefined();
	});

	it('ignores what is no node hash', () => {
		expect(noteUnverifiable(empty, 'x', T1)).toEqual(empty);
		expect(noteUnlocked(empty, '', T1)).toEqual(empty);
	});
});
