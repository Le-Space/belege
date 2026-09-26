// A Kraken API on 127.0.0.1 for tests: /0/public/Assets and the private
// Balance and Ledgers, with Kraken's signature check, nonces that must grow,
// pages of 50 paged by `ofs`, and a rate limit on request. All data made up.
import http from 'node:http';
import { createHash, createHmac } from 'node:crypto';

export const FAKE_KRAKEN_KEY = 'fake-kraken-api-key-0000000000000000000000000000000000';
/** 64 bytes, base64, as Kraken hands out private keys. */
export const FAKE_KRAKEN_SECRET = Buffer.from(
	createHash('sha512').update('fake kraken secret').digest()
).toString('base64');

export const FAKE_ASSETS = {
	XXBT: { altname: 'XBT', decimals: 10 },
	XETH: { altname: 'ETH', decimals: 10 },
	ZEUR: { altname: 'EUR', decimals: 4 },
	AKT: { altname: 'AKT', decimals: 8 },
	'AKT.S': { altname: 'AKT.S', decimals: 8 },
	'XBT.M': { altname: 'XBT.M', decimals: 10 }
};

const t = (/** @type {string} */ iso) => Date.parse(iso) / 1000;

/** A month on a made-up Kraken account; ids and refids are invented. */
export function sampleLedger() {
	/** @type {Record<string, any>} */
	const ledger = {
		'L-DEP-1': {
			refid: 'R-DEP-1',
			time: t('2026-09-01T09:00:00Z'),
			type: 'deposit',
			subtype: '',
			asset: 'ZEUR',
			amount: '1000.0000',
			fee: '0.0000'
		},
		'L-TR1-EUR': {
			refid: 'R-TR1',
			time: t('2026-09-02T10:00:00Z'),
			type: 'trade',
			subtype: '',
			asset: 'ZEUR',
			amount: '-600.0000',
			fee: '1.5600'
		},
		'L-TR1-BTC': {
			refid: 'R-TR1',
			time: t('2026-09-02T10:00:00Z'),
			type: 'trade',
			subtype: '',
			asset: 'XXBT',
			amount: '0.0100000000',
			fee: '0.0000000000'
		},
		'L-TR2-BTC': {
			refid: 'R-TR2',
			time: t('2026-09-03T11:00:00Z'),
			type: 'trade',
			subtype: '',
			asset: 'XXBT',
			amount: '-0.0020000000',
			fee: '0.0000000000'
		},
		'L-TR2-ETH': {
			refid: 'R-TR2',
			time: t('2026-09-03T11:00:00Z'),
			type: 'trade',
			subtype: '',
			asset: 'XETH',
			amount: '0.0500000000',
			fee: '0.0001000000'
		},
		'L-EARN-OUT': {
			refid: 'R-EARN',
			time: t('2026-09-05T12:00:00Z'),
			type: 'transfer',
			subtype: 'spottostaking',
			asset: 'XXBT',
			amount: '-0.0010000000',
			fee: '0.0000000000'
		},
		'L-EARN-IN': {
			refid: 'R-EARN',
			time: t('2026-09-05T12:00:01Z'),
			type: 'transfer',
			subtype: 'stakingfromspot',
			asset: 'XBT.M',
			amount: '0.0010000000',
			fee: '0.0000000000'
		},
		'L-WD-1': {
			refid: 'R-WD-1',
			time: t('2026-09-12T08:00:00Z'),
			type: 'withdrawal',
			subtype: '',
			asset: 'ZEUR',
			amount: '-300.0000',
			fee: '0.0900'
		}
	};
	// Daily staking rewards, enough for more than one page.
	for (let day = 1; day <= 50; day++) {
		const d = String(day <= 30 ? day : day - 30).padStart(2, '0');
		const month = day <= 30 ? '08' : '09';
		ledger[`L-RW-${day}`] = {
			refid: `R-RW-${day}`,
			time: t(`2026-${month}-${d}T02:00:00Z`),
			type: 'staking',
			subtype: '',
			asset: 'AKT.S',
			amount: '0.12345678',
			fee: '0.00000000'
		};
	}
	return ledger;
}

/**
 * @param {object} [options]
 * @param {Record<string, any>} [options.ledger]
 * @param {Record<string, string>} [options.balance]
 * @param {number} [options.rateLimitedCalls] this many private calls answer "Rate limit exceeded" first
 * @param {{ deposit: any[], withdrawals: any[] } | null} [options.transfers] DepositStatus / WithdrawStatus; null: permission denied
 */
export async function startFakeKraken({
	ledger = sampleLedger(),
	balance = {
		ZEUR: '98.3500',
		XXBT: '0.0070000000',
		XETH: '0.0499000000',
		'XBT.M': '0.0010000000',
		'AKT.S': '6.17283900',
		XDG: '0'
	},
	rateLimitedCalls = 0,
	transfers = {
		deposit: [{ refid: 'R-DEP-1', asset: 'ZEUR', txid: 'BANKREF-0001', status: 'Success' }],
		withdrawals: [
			{ refid: 'R-WD-1', asset: 'ZEUR', txid: 'BANKREF-0002', status: 'Success' },
			{ refid: 'R-OTHER', asset: 'XXBT', txid: '00'.repeat(32), status: 'Success' }
		]
	}
} = {}) {
	let lastNonce = 0n;
	let limited = rateLimitedCalls;
	/** @type {{ method: string, params: Record<string, string> }[]} */
	const calls = [];

	const server = http.createServer((req, res) => {
		let raw = '';
		req.on('data', (c) => (raw += c));
		req.on('end', () => {
			const reply = (/** @type {unknown} */ body) => {
				res.writeHead(200, { 'Content-Type': 'application/json' });
				res.end(JSON.stringify(body));
			};
			const path = String(req.url ?? '').split('?')[0];
			if (path === '/0/public/Assets') return reply({ error: [], result: FAKE_ASSETS });
			if (!path.startsWith('/0/private/')) return reply({ error: ['EGeneral:Unknown method'] });

			const params = Object.fromEntries(new URLSearchParams(raw));
			const digest = createHash('sha256')
				.update(params.nonce + raw)
				.digest();
			const expected = createHmac('sha512', Buffer.from(FAKE_KRAKEN_SECRET, 'base64'))
				.update(Buffer.concat([Buffer.from(path), digest]))
				.digest('base64');
			if (req.headers['api-key'] !== FAKE_KRAKEN_KEY) return reply({ error: ['EAPI:Invalid key'] });
			if (req.headers['api-sign'] !== expected) return reply({ error: ['EAPI:Invalid signature'] });
			const nonce = BigInt(params.nonce);
			if (nonce <= lastNonce) return reply({ error: ['EAPI:Invalid nonce'] });
			lastNonce = nonce;

			const method = path.slice('/0/private/'.length);
			calls.push({ method, params });
			if (limited > 0) {
				limited--;
				return reply({ error: ['EAPI:Rate limit exceeded'] });
			}
			if (method === 'Balance') return reply({ error: [], result: balance });
			if (method === 'DepositStatus' || method === 'WithdrawStatus') {
				if (!transfers) return reply({ error: ['EGeneral:Permission denied'] });
				const list = method === 'DepositStatus' ? transfers.deposit : transfers.withdrawals;
				// With a cursor, one item a page, to exercise the paging.
				if (params.cursor === undefined) return reply({ error: [], result: list });
				const at = params.cursor === 'true' ? 0 : Number(params.cursor);
				const next = at + 1 < list.length ? String(at + 1) : false;
				const key = method === 'DepositStatus' ? 'deposits' : 'withdrawals';
				return reply({ error: [], result: { [key]: list.slice(at, at + 1), next_cursor: next } });
			}
			if (method === 'Ledgers') {
				const start = Number(params.start ?? 0);
				const all = Object.entries(ledger)
					.filter(([, e]) => e.time > start)
					.sort(([, a], [, b]) => b.time - a.time); // newest first, as Kraken
				const ofs = Number(params.ofs ?? 0);
				const page = Object.fromEntries(all.slice(ofs, ofs + 50));
				return reply({ error: [], result: { ledger: page, count: all.length } });
			}
			return reply({ error: ['EGeneral:Unknown method'] });
		});
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
	const { port } = /** @type {import('node:net').AddressInfo} */ (server.address());
	return {
		url: `http://127.0.0.1:${port}`,
		calls,
		close: () => new Promise((resolve) => server.close(() => resolve(undefined)))
	};
}
