// Read shares for an assistant (issue #124): a snapshot of the books the app
// made – scoped, redacted by default – kept in memory only, readable by its
// random id until it expires or is revoked. A restart ends every share.
//
// The id is the capability: 128 random bits, base64url. It is never logged;
// the log gets counts.

import { randomBytes } from 'node:crypto';

export const MAX_SHARE_BYTES = 8 * 1024 * 1024;
export const MAX_SHARE_MINUTES = 24 * 60;
export const MAX_SHARES = 10;

/**
 * @typedef {object} Share
 * @property {string} id
 * @property {string} scope what it holds, as the app describes it (shown in lists)
 * @property {boolean} redacted
 * @property {string} createdAt ISO
 * @property {string} expiresAt ISO
 * @property {number} reads
 * @property {string} body the snapshot, as JSON text
 */

/**
 * @param {{ now?: () => number }} [options]
 */
export function createShares({ now = Date.now } = {}) {
	/** @type {Map<string, Share>} */
	const shares = new Map();

	const sweep = () => {
		const t = now();
		for (const [id, s] of shares) if (Date.parse(s.expiresAt) <= t) shares.delete(id);
	};

	return {
		/**
		 * @param {{ scope: string, redacted: boolean, minutes: number, data: unknown }} p
		 * @returns {Omit<Share, 'body'>}
		 */
		create({ scope, redacted, minutes, data }) {
			sweep();
			if (shares.size >= MAX_SHARES) {
				throw Object.assign(new Error('too many shares; revoke one first'), { status: 409 });
			}
			const body = JSON.stringify(data);
			if (Buffer.byteLength(body) > MAX_SHARE_BYTES) {
				throw Object.assign(new Error('share too large'), { status: 413 });
			}
			const t = now();
			const share = {
				id: randomBytes(16).toString('base64url'),
				scope: String(scope).slice(0, 200),
				redacted: Boolean(redacted),
				createdAt: new Date(t).toISOString(),
				expiresAt: new Date(
					t + Math.min(MAX_SHARE_MINUTES, Math.max(1, minutes)) * 60_000
				).toISOString(),
				reads: 0,
				body
			};
			shares.set(share.id, share);
			const { body: _body, ...meta } = share;
			return meta;
		},
		/** The snapshot, counting the read; null when unknown or expired. @param {string} id */
		read(id) {
			sweep();
			const s = shares.get(id);
			if (!s) return null;
			s.reads++;
			return s.body;
		},
		/** @returns {Omit<Share, 'body'>[]} */
		list() {
			sweep();
			return [...shares.values()].map(({ body: _body, ...meta }) => meta);
		},
		/** @param {string} id */
		revoke(id) {
			return shares.delete(id);
		}
	};
}
