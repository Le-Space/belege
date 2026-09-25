// Reading receipt mails over IMAP, read-only.
//
// Two tiers (docs/phase-0.md):
//   - `listMessages`: mails addressed to the accounting alias, in a date
//     window. The alias lands in the same mailbox as private mail, so the
//     server is asked for `To:` or `Received: … for <alias>` (Bcc), and every
//     hit is checked again here against the parsed headers before it leaves.
//     `X-Original-To` and `Delivered-To` are not set on this server.
//   - `search`: one targeted server-side search in the private mailbox (vendor
//     text, amount spellings, ± days), only on an explicit request. Only the
//     hits are read.
//
// Every folder is opened read-only (EXAMINE): nothing is marked as read,
// moved or deleted. Trash, Junk and Drafts are skipped for the listing; Sent
// stays in (forwarded receipts, outgoing invoices). The search skips Trash and
// Drafts but looks into Junk, where a real invoice sometimes lands.
//
// Of a mail, only headers, the MIME structure, the first bytes of each
// attachment (to tell a PDF by its bytes) and the first few KB of its text
// part are fetched. An attachment's bytes are fetched on request, PDFs and
// images only, up to a size cap.
//
// Nothing here logs a subject, an address or a body.

import { ImapFlow } from 'imapflow';

import { authVerdict, headerValues } from './auth-results.js';
import {
	amountVariants,
	aroundWindow,
	attachmentParts,
	decodeMailId,
	encodeMailId,
	excerpt,
	htmlToText,
	searchWindow,
	sniff,
	textPart
} from './mime.js';

export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
const MAX_LISTED = 500;
const SNIFF_BYTES = 1024;
const TEXT_BYTES = 16 * 1024;
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const SKIP_LISTING = new Set(['\\Trash', '\\Junk', '\\Drafts']);
const SKIP_SEARCH = new Set(['\\Trash', '\\Drafts']);
// Servers without SPECIAL-USE: the usual names.
const TRASH_NAMES =
	/^(trash|deleted( items| messages)?|papierkorb|gelöschte( elemente| objekte)?)$/i;
const JUNK_NAMES = /^(junk|spam|junk e-mail|unerwünscht)$/i;
const DRAFT_NAMES = /^(drafts|entwürfe)$/i;

export class MailError extends Error {
	/** @param {string} message @param {number} status @param {string} code */
	constructor(message, status, code) {
		super(message);
		this.name = 'MailError';
		this.status = status;
		this.code = code;
	}
}

/**
 * @typedef {object} MailAttachment
 * @property {string} part
 * @property {string} name
 * @property {string} type declared MIME type
 * @property {number} size encoded size
 * @property {'pdf' | 'image' | 'other'} kind by the bytes
 * @property {boolean} isPdf
 * @property {string | null} mime what the bytes say
 */

/**
 * @typedef {object} MailMessage
 * @property {string} id opaque, for /mail/attachment and /extract
 * @property {string} folder
 * @property {number} uid
 * @property {string | null} date the Date: header, ISO
 * @property {string | null} receivedAt when the server got it, ISO
 * @property {{ address: string, name: string }} from
 * @property {string} subject
 * @property {import('./auth-results.js').AuthResult} auth
 * @property {boolean} outgoing from the Sent folder
 * @property {MailAttachment[]} attachments
 * @property {string} excerpt up to about 2 KB of the text, HTML stripped
 * @property {'to' | 'received' | null} [addressedBy] how it reached the accounting address
 * @property {string[]} [matched] search only: which criteria matched
 * @property {boolean} bulk a newsletter or list mail (List-Unsubscribe, List-Id, Precedence: bulk)
 */

/**
 * @param {object} options
 * @param {import('../config.js').MailConfig} options.config
 * @param {() => Promise<string>} options.getPassword from the keychain
 * @param {typeof ImapFlow} [options.ImapClient]
 * @param {() => Date} [options.now]
 */
export function createMailClient({
	config,
	getPassword,
	ImapClient = ImapFlow,
	now = () => new Date()
}) {
	const { host, port, user, tls } = config;
	if (!host || !user) throw new Error('Mail is not set up: run `pnpm setup:mail`.');
	if (tls === 'none' && !LOOPBACK.has(host)) {
		throw new Error('Unencrypted IMAP is only allowed to a server on this machine.');
	}
	const accounting = config.accountingAddress.toLowerCase();
	/** Verdicts of mails already listed, for /extract. Nothing else is kept. */
	/** @type {Map<string, { verdict: string, outgoing: boolean }>} */
	const verdicts = new Map();

	/** @template T @param {(client: ImapFlow) => Promise<T>} fn @returns {Promise<T>} */
	async function session(fn) {
		const pass = await getPassword();
		const client = new ImapClient({
			host,
			port,
			secure: tls === 'implicit',
			doSTARTTLS: tls === 'starttls' ? true : tls === 'none' ? false : undefined,
			auth: { user, pass },
			logger: false,
			// Never IDLE or hold the connection: one request, one session.
			disableAutoIdle: true
		});
		// imapflow emits 'error' on socket trouble; without a listener it would throw globally.
		client.on('error', () => {});
		try {
			await client.connect();
		} catch (/** @type {any} */ error) {
			if (error.authenticationFailed) {
				throw new MailError(
					'The mail server refused the login (check setup:mail).',
					502,
					'MAIL_AUTH'
				);
			}
			throw new MailError(
				`Cannot reach the mail server: ${error.code ?? error.message}`,
				502,
				'MAIL_UNREACHABLE'
			);
		}
		try {
			return await fn(client);
		} finally {
			await client.logout().catch(() => client.close());
		}
	}

	/** @param {ImapFlow} client @param {Set<string>} skipUse @param {boolean} skipJunkNames */
	async function folders(client, skipUse, skipJunkNames) {
		const list = await client.list();
		return list
			.filter((f) => !f.flags?.has('\\Noselect') && !f.flags?.has('\\NonExistent'))
			.filter((f) => !(f.specialUse && skipUse.has(f.specialUse)))
			.filter((f) => {
				const name = f.name ?? f.path;
				if (TRASH_NAMES.test(name) || DRAFT_NAMES.test(name)) return false;
				return !(skipJunkNames && JUNK_NAMES.test(name));
			})
			.map((f) => ({
				path: f.path,
				sent: f.specialUse === '\\Sent' || /^(sent|gesendet)/i.test(f.name ?? '')
			}));
	}

	/**
	 * How a mail reached the accounting address, from its own headers.
	 *
	 * @param {any} envelope
	 * @param {string} headers
	 * @returns {'to' | 'received' | null}
	 */
	function addressedBy(envelope, headers) {
		const direct = [...(envelope?.to ?? []), ...(envelope?.cc ?? [])].some(
			(/** @type {any} */ a) => String(a.address ?? '').toLowerCase() === accounting
		);
		if (direct) return 'to';
		for (const received of headerValues(headers, 'received')) {
			const m = /\bfor\s+<?([^\s<>;]+@[^\s<>;]+?)>?\s*(;|$)/i.exec(received);
			if (m && m[1].toLowerCase() === accounting) return 'received';
		}
		return null;
	}

	/**
	 * @param {ImapFlow} client
	 * @param {number} uid
	 * @param {string} part
	 * @param {number} maxBytes
	 */
	async function firstBytes(client, uid, part, maxBytes) {
		const { content } = await client.download(String(uid), part, { uid: true, maxBytes });
		/** @type {Buffer[]} */
		const chunks = [];
		let size = 0;
		for await (const chunk of content) {
			chunks.push(chunk);
			size += chunk.length;
			if (size >= maxBytes) break;
		}
		return Buffer.concat(chunks).subarray(0, maxBytes);
	}

	/**
	 * @param {ImapFlow} client
	 * @param {{ path: string, sent: boolean }} folder
	 * @param {bigint | number} uidValidity
	 * @param {any} msg a fetched message
	 * @returns {Promise<MailMessage>}
	 */
	async function describe(client, folder, uidValidity, msg) {
		const headers = msg.headers?.toString('utf8') ?? '';
		const fromAddr = msg.envelope?.from?.[0] ?? {};
		const from = {
			address: String(fromAddr.address ?? '').toLowerCase(),
			name: fromAddr.name ?? ''
		};
		const auth = authVerdict({ headers, from: from.address, authServId: config.authServId });

		/** @type {MailAttachment[]} */
		const attachments = [];
		for (const p of attachmentParts(msg.bodyStructure)) {
			let found = /** @type {ReturnType<typeof sniff>} */ ({ kind: 'other', mime: null });
			if (p.candidate) {
				try {
					found = sniff(await firstBytes(client, msg.uid, p.part, SNIFF_BYTES));
				} catch {
					// A part the server cannot hand out counts as "other".
				}
			}
			attachments.push({
				part: p.part,
				name: p.name,
				type: p.type,
				size: p.size,
				kind: found.kind,
				isPdf: found.kind === 'pdf',
				mime: found.mime
			});
		}

		let text = '';
		const tp = textPart(msg.bodyStructure);
		if (tp) {
			try {
				const raw = (await firstBytes(client, msg.uid, tp.part, TEXT_BYTES)).toString('utf8');
				text = excerpt(tp.html ? htmlToText(raw) : raw);
			} catch {
				text = '';
			}
		}

		const id = encodeMailId({ folder: folder.path, uidValidity, uid: msg.uid });
		verdicts.set(id, { verdict: auth.verdict, outgoing: folder.sent });
		return {
			id,
			folder: folder.path,
			uid: msg.uid,
			date: msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : null,
			receivedAt: msg.internalDate ? new Date(msg.internalDate).toISOString() : null,
			from,
			subject: msg.envelope?.subject ?? '',
			auth,
			outgoing: folder.sent,
			attachments,
			excerpt: text,
			addressedBy: addressedBy(msg.envelope, headers),
			bulk: /^(list-unsubscribe|list-id):|^precedence:\s*(bulk|list|junk)/im.test(headers)
		};
	}

	const FETCH = {
		uid: true,
		envelope: true,
		bodyStructure: true,
		internalDate: true,
		headers: [
			'authentication-results',
			'received',
			'to',
			'cc',
			'list-unsubscribe',
			'list-id',
			'precedence'
		]
	};

	/**
	 * @param {ImapFlow} client
	 * @param {number[]} uids
	 */
	async function fetchAll(client, uids) {
		const rows = [];
		if (!uids.length) return rows;
		for await (const msg of client.fetch(uids, FETCH, { uid: true })) rows.push(msg);
		return rows;
	}

	return {
		/**
		 * Mails to the accounting address, received in [since, until).
		 *
		 * @param {{ since: string, until?: string | null }} window YYYY-MM-DD
		 * @returns {Promise<MailMessage[]>}
		 */
		async listMessages({ since, until = null }) {
			const from = new Date(`${since}T00:00:00Z`);
			const to = until ? new Date(`${until}T00:00:00Z`) : null;
			const base = searchWindow(from, to, now());
			const addressed = { or: [{ to: accounting }, { header: { Received: accounting } }] };
			return session(async (client) => {
				/** @type {MailMessage[]} */
				const out = [];
				for (const folder of await folders(client, SKIP_LISTING, true)) {
					const box = await client.mailboxOpen(folder.path, { readOnly: true });
					if (!box.exists) continue;
					const uids = await client.search({ ...base, ...addressed }, { uid: true });
					if (!Array.isArray(uids))
						throw new MailError(`Search in a folder failed.`, 502, 'MAIL_SEARCH');
					for (const msg of await fetchAll(client, uids.slice(-MAX_LISTED))) {
						const d = await describe(client, folder, box.uidValidity, msg);
						// The server's search is a substring match; this is the check.
						if (!d.addressedBy) continue;
						const at = d.receivedAt ? new Date(d.receivedAt) : null;
						if (at && (at < from || (to && at >= to))) continue;
						out.push(d);
					}
				}
				return out.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
			});
		},

		/**
		 * The targeted search in the whole mailbox (Junk included): vendor text
		 * and every spelling of an amount, within ± days of a day.
		 *
		 * @param {{ text?: string | null, amount?: string | null, around?: string | null, days?: number }} query
		 * @returns {Promise<MailMessage[]>}
		 */
		async search({ text = null, amount = null, around = null, days = 14 }) {
			const range = aroundWindow(around, days);
			const base = searchWindow(range.since, range.before, now());
			/** @type {[string, Record<string, any>][]} */
			const criteria = [];
			if (text) criteria.push([`"${text}"`, { text }]);
			for (const a of amount ? amountVariants(amount) : []) criteria.push([a, { body: a }]);
			if (!criteria.length) throw new MailError('text or amount is required', 400, 'MAIL_QUERY');
			return session(async (client) => {
				/** @type {MailMessage[]} */
				const out = [];
				for (const folder of await folders(client, SKIP_SEARCH, false)) {
					const box = await client.mailboxOpen(folder.path, { readOnly: true });
					if (!box.exists) continue;
					/** @type {Map<number, string[]>} */
					const matched = new Map();
					for (const [label, q] of criteria) {
						const hits = await client.search({ ...base, ...q }, { uid: true });
						if (!Array.isArray(hits))
							throw new MailError('Search in a folder failed.', 502, 'MAIL_SEARCH');
						for (const uid of hits) matched.set(uid, [...(matched.get(uid) ?? []), label]);
					}
					const uids = [...matched.keys()].slice(-MAX_LISTED);
					for (const msg of await fetchAll(client, uids)) {
						const d = await describe(client, folder, box.uidValidity, msg);
						out.push({ ...d, matched: matched.get(msg.uid) ?? [] });
					}
				}
				return out.sort((a, b) => String(a.receivedAt).localeCompare(String(b.receivedAt)));
			});
		},

		/**
		 * One attachment's bytes: PDFs and images only, up to the cap.
		 *
		 * @param {string} id
		 * @param {string} part
		 * @returns {Promise<{ bytes: Buffer, mime: string, name: string }>}
		 */
		async attachment(id, part) {
			const ref = decodeMailId(id);
			if (!ref) throw new MailError('unknown mail', 404, 'MAIL_UNKNOWN');
			return session(async (client) => {
				const box = await client.mailboxOpen(ref.folder, { readOnly: true }).catch(() => null);
				if (!box || String(box.uidValidity) !== ref.uidValidity) {
					throw new MailError('unknown mail', 404, 'MAIL_UNKNOWN');
				}
				const msg = await client.fetchOne(
					String(ref.uid),
					{ uid: true, bodyStructure: true },
					{ uid: true }
				);
				const info = msg
					? attachmentParts(msg.bodyStructure).find((p) => p.part === part)
					: undefined;
				if (!info) throw new MailError('unknown attachment', 404, 'MAIL_UNKNOWN');
				// Encoded (base64) size is about 4/3 of the bytes; refuse early when far over.
				if (info.size > MAX_ATTACHMENT_BYTES * 1.4) {
					throw new MailError('attachment too large', 413, 'MAIL_TOO_LARGE');
				}
				const { content } = await client.download(String(ref.uid), part, { uid: true });
				/** @type {Buffer[]} */
				const chunks = [];
				let size = 0;
				for await (const chunk of content) {
					size += chunk.length;
					if (size > MAX_ATTACHMENT_BYTES) {
						throw new MailError('attachment too large', 413, 'MAIL_TOO_LARGE');
					}
					chunks.push(chunk);
				}
				const bytes = Buffer.concat(chunks);
				const found = sniff(bytes);
				if (found.kind === 'other' || !found.mime) {
					throw new MailError('only PDFs and images are handed out', 415, 'MAIL_TYPE');
				}
				return { bytes, mime: found.mime, name: info.name };
			});
		},

		/**
		 * The DKIM/SPF verdict of one mail, for /extract: from the last listing,
		 * or read from its headers now.
		 *
		 * @param {string} id
		 * @returns {Promise<{ verdict: string, outgoing: boolean }>}
		 */
		async verdictOf(id) {
			const known = verdicts.get(id);
			if (known) return known;
			const ref = decodeMailId(id);
			if (!ref) throw new MailError('unknown mail', 404, 'MAIL_UNKNOWN');
			return session(async (client) => {
				const box = await client.mailboxOpen(ref.folder, { readOnly: true }).catch(() => null);
				if (!box || String(box.uidValidity) !== ref.uidValidity) {
					throw new MailError('unknown mail', 404, 'MAIL_UNKNOWN');
				}
				const msg = await client.fetchOne(
					String(ref.uid),
					{ uid: true, envelope: true, headers: ['authentication-results'] },
					{ uid: true }
				);
				if (!msg) throw new MailError('unknown mail', 404, 'MAIL_UNKNOWN');
				const list = await client.list();
				const sent = list.some((f) => f.path === ref.folder && f.specialUse === '\\Sent');
				const { verdict } = authVerdict({
					headers: msg.headers?.toString('utf8') ?? '',
					from: msg.envelope?.from?.[0]?.address ?? '',
					authServId: config.authServId
				});
				const result = { verdict, outgoing: sent };
				verdicts.set(id, result);
				return result;
			});
		},

		/** For setup: log in, count folders, log out. */
		async check() {
			return session(async (client) => ({ folders: (await client.list()).length }));
		}
	};
}

/** @typedef {ReturnType<typeof createMailClient>} MailClient */
