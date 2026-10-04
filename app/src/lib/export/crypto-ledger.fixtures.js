// Made-up books for the crypto-ledger specs (issue #267): wallet and exchange
// accounts, the bookings their syncs would write, and a bank account that is
// not crypto. Every address, hash, amount and name is made up. The bookings
// carry the German labels the syncs store (see the follow-up on #192).
/* eslint-disable belege/no-german */

export const h = (/** @type {string} */ c) => c.repeat(64);
export const EVM = '0x1111111111111111111111111111111111111111';
export const OTHER = '0x2222222222222222222222222222222222222222';
export const XMR = `4${'A'.repeat(94)}`;
const at = (/** @type {string} */ d) => ({
	rate: '1600',
	currency: 'EUR',
	source: 'coingecko',
	at: `${d}T00:00:00Z`
});

export const accounts = [
	{
		id: 'a-eth',
		source: 'base',
		sourceAccountId: `${EVM}:ETH`,
		kind: 'wallet',
		asset: 'ETH',
		decimals: 18,
		walletAddress: EVM
	},
	{
		id: 'a-usdc',
		source: 'base',
		sourceAccountId: `${EVM}:USDC`,
		kind: 'wallet',
		asset: 'USDC',
		decimals: 6,
		walletAddress: EVM
	},
	{
		id: 'a-tok',
		source: 'base',
		sourceAccountId: `${EVM}:XYZ`,
		kind: 'wallet',
		asset: 'XYZ',
		decimals: 18,
		walletAddress: EVM,
		tokenContract: '0x4444444444444444444444444444444444444444'
	},
	{
		id: 'a-xmr',
		source: 'monero',
		sourceAccountId: `${XMR}:XMR`,
		kind: 'wallet',
		asset: 'XMR',
		decimals: 12,
		walletAddress: XMR
	},
	{
		id: 'k-btc',
		source: 'kraken',
		sourceAccountId: 'BTC',
		kind: 'exchange',
		asset: 'BTC',
		decimals: 10
	},
	{
		id: 'k-eur',
		source: 'kraken',
		sourceAccountId: 'EUR',
		kind: 'exchange',
		asset: 'EUR',
		decimals: 4
	},
	{
		id: 'k-earn',
		source: 'kraken',
		sourceAccountId: 'BTC.earn',
		kind: 'exchange',
		asset: 'BTC',
		decimals: 10
	},
	{ id: 'bank', source: 'hibiscus', sourceAccountId: '0042', ibanLast4: '0042', currency: 'EUR' }
];

export const transactions = [
	{
		id: 't1',
		accountId: 'a-eth',
		sourceId: `0x${h('b')}:value`,
		bookedOn: '2025-05-03',
		bookedAt: '2025-05-03T09:30:00Z',
		amountCents: -8000,
		currency: 'EUR',
		counterparty: OTHER,
		counterpartyAddress: OTHER,
		purpose: `Überweisung · Memo: rent, May · Tx 0xbbbb…bbbb`,
		movement: 'transfer',
		txRef: `0x${h('b')}`,
		explorerUrl: `https://base.blockscout.com/tx/0x${h('b')}`,
		asset: 'ETH',
		quantity: '-50000000000000000',
		decimals: 18,
		valuation: at('2025-05-03'),
		rateMissing: null
	},
	{
		id: 't2',
		accountId: 'a-eth',
		sourceId: `0x${h('b')}:fee`,
		bookedOn: '2025-05-03',
		bookedAt: '2025-05-03T09:30:00Z',
		amountCents: -3,
		currency: 'EUR',
		counterparty: 'Netzwerkgebühr',
		purpose: 'Netzwerkgebühr · Tx 0xbbbb…bbbb',
		movement: 'fee',
		txRef: `0x${h('b')}`,
		asset: 'ETH',
		quantity: '-21000000000000',
		decimals: 18,
		valuation: at('2025-05-03'),
		rateMissing: null
	},
	{
		id: 't3',
		accountId: 'a-usdc',
		sourceId: `0x${h('c')}:erc20:0`,
		bookedOn: '2025-05-04',
		bookedAt: '2025-05-04T10:00:00Z',
		amountCents: 105600,
		counterparty: 'MetaMask Swap (Router)',
		counterpartyAddress: '0x881d40237659c251811cec9c364ef91dc08d300c',
		purpose: 'Tausch',
		movement: 'trade',
		swap: { gave: [], got: [] },
		txRef: `0x${h('c')}`,
		asset: 'USDC',
		quantity: '1200000000',
		decimals: 6,
		valuation: at('2025-05-04'),
		rateMissing: null
	},
	{
		id: 't4',
		accountId: 'a-tok',
		sourceId: `0x${h('d')}:erc20:1`,
		bookedOn: '2025-05-05',
		amountCents: 0,
		movement: 'transfer',
		txRef: `0x${h('d')}`,
		asset: 'XYZ',
		quantity: '5000000000000000000',
		decimals: 18,
		valuation: null,
		rateMissing: { reason: 'no rate' }
	},
	{
		id: 't5',
		accountId: 'a-xmr',
		sourceId: `${h('e')}:received:0`,
		bookedOn: '2024-12-30',
		bookedAt: '2024-12-30T08:00:00Z',
		amountCents: 15000,
		bookingType: 'Mining-Ertrag',
		purpose: `Mining-Ertrag · Tx ${h('e').slice(0, 6)}…`,
		movement: 'reward',
		txRef: h('e'),
		asset: 'XMR',
		quantity: '1000000000000',
		decimals: 12,
		valuation: { ...at('2024-12-30'), rate: '150' },
		rateMissing: null
	},
	{
		id: 't6',
		accountId: 'k-eur',
		sourceId: 'LEXAMP-AAAAA-AAAAAA',
		bookedOn: '2025-01-05',
		bookedAt: '2025-01-05T10:00:00Z',
		amountCents: -50000,
		currency: 'EUR',
		counterparty: 'Kraken',
		movement: 'trade',
		txRef: 'TEXAMP-BBBBB-BBBBBB',
		exchangeType: 'trade'
	},
	{
		id: 't7',
		accountId: 'k-btc',
		sourceId: 'LEXAMP-CCCCC-CCCCCC',
		bookedOn: '2025-01-05',
		bookedAt: '2025-01-05T10:00:00Z',
		amountCents: 50000,
		counterparty: 'Kraken',
		movement: 'trade',
		txRef: 'TEXAMP-BBBBB-BBBBBB',
		exchangeType: 'trade',
		asset: 'BTC',
		quantity: '62500000',
		decimals: 10,
		valuation: { rate: '80000', currency: 'EUR', source: 'trade', at: '2025-01-05T10:00:00Z' },
		rateMissing: null
	},
	{
		id: 't8',
		accountId: 'k-btc',
		sourceId: 'LEXAMP-DDDDD-DDDDDD',
		bookedOn: '2025-01-20',
		bookedAt: '2025-01-20T09:00:00Z',
		amountCents: -48000,
		counterparty: 'Kraken',
		movement: 'transfer',
		txRef: 'FEXAMP-EEEEE-EEEEEE',
		exchangeType: 'withdrawal',
		chainTxRef: h('f'),
		chainMethod: 'Bitcoin',
		asset: 'BTC',
		quantity: '-60000000',
		decimals: 10,
		valuation: { ...at('2025-01-20'), rate: '80000' },
		rateMissing: null
	},
	{
		id: 't9',
		accountId: 'k-earn',
		sourceId: 'LEXAMP-GGGGG-GGGGGG',
		bookedOn: '2025-02-01',
		amountCents: 80,
		movement: 'reward',
		txRef: 'STEXAMP',
		exchangeType: 'earn/reward',
		asset: 'BTC',
		quantity: '100000',
		decimals: 10,
		valuation: { ...at('2025-02-01'), rate: '80000' },
		rateMissing: null
	},
	{
		id: 't10',
		accountId: 'a-eth',
		sourceId: 'gone',
		bookedOn: '2025-05-06',
		amountCents: 1,
		deleted: true,
		asset: 'ETH',
		quantity: '1',
		decimals: 18,
		valuation: at('2025-05-06')
	},
	{
		id: 't11',
		accountId: 'bank',
		sourceId: 'b1',
		bookedOn: '2025-05-06',
		amountCents: -1999,
		counterparty: 'Muster GmbH',
		purpose: 'Rechnung'
	}
];

export const wallets = [{ id: `base:${EVM}`, chain: 'base', address: EVM, name: 'Project wallet' }];
export const now = new Date('2025-06-30T12:00:00Z');
