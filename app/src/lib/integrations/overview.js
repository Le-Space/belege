// The Integrationen overview (issue #152): one row per integration with its
// state, a line and when it last ran; what needs the person; the counts on
// top. Pure – the page gathers the facts, this decides what they mean.

/** @typedef {'ok' | 'warn' | 'err' | 'off'} Kind */

/**
 * @typedef {object} Row
 * @property {string} id the page's path under /integrationen, or '' for none
 * @property {string} group 'basis' | 'sources' | 'together'
 * @property {string} initials
 * @property {Kind} kind
 * @property {string} state i18n key under integrationen.overview.state
 * @property {Record<string, string | number>} [params] for the line
 * @property {string} line i18n key under integrationen.overview.line
 * @property {string | null} when ISO, the last run
 * @property {string} [href] elsewhere than /integrationen/<id>
 */

/**
 * @typedef {object} Need
 * @property {string} id the integration
 * @property {'err' | 'warn'} kind
 * @property {string} text i18n key under integrationen.overview.need
 * @property {Record<string, string | number>} [params]
 */

/**
 * @typedef {object} Facts
 * @property {{ token: string | null, state: string, via?: 'local' | 'device', health: { hibiscus: boolean, kraken: boolean, mail: boolean, llm: boolean } }} bridge
 * @property {{ flag: boolean, online: boolean, removed: boolean, error: string | null, connected: number }} devices
 * @property {Record<string, any>[]} accounts the books' accounts
 * @property {Record<string, any>[]} events newest first
 * @property {number} wallets own wallets kept
 * @property {number} aleph Aleph accounts found
 * @property {boolean} invoiceApp paired
 * @property {import('./alerts.js').Alerts} [alerts] what the last runs left
 * @property {(source: string) => boolean} isWalletSource
 */

/** The newest `bank-sync` event whose source passes. @param {Record<string, any>[]} events @param {(s: string) => boolean} test */
const lastSync = (events, test) =>
	events.find((e) => e.kind === 'bank-sync' && test(String(e.source ?? '')))?.at ?? null;

/**
 * @param {Facts} f
 * @returns {{ viaDevice: boolean, rows: Row[], needs: Need[], counts: { ok: number, needs: number, off: number } }}
 */
export function integrationsOverview(f) {
	const paired = Boolean(f.bridge.token);
	const online = f.bridge.state === 'online';
	// A phone using the Mac's bridge (#142): working, not a pairing to fix here.
	const viaDevice = online && f.bridge.via === 'device';
	/** Needs the bridge and something set up on it. @param {boolean} setUp */
	const viaBridge = (setUp) => (!paired ? 'off' : !online ? 'off' : setUp ? 'ok' : 'off');
	const hibiscus = f.accounts.filter((a) => a.source === 'hibiscus' && !a.deleted);
	const camt = f.accounts.filter(
		(a) => (a.source === 'camt' || a.source === 'enablebanking') && !a.deleted
	);
	const bankWhen = lastSync(f.events, (s) => s === 'hibiscus' || s === 'enablebanking');
	const krakenWhen = lastSync(f.events, (s) => s === 'kraken');
	const walletWhen = lastSync(f.events, f.isWalletSource);

	/** @type {Row[]} */
	const rows = [
		{
			id: 'bridge',
			group: 'basis',
			initials: 'Br',
			kind: viaDevice
				? 'ok'
				: !paired
					? 'warn'
					: online
						? 'ok'
						: f.bridge.state === 'offline'
							? 'err'
							: 'off',
			state: viaDevice
				? 'viaDevice'
				: !paired
					? 'unpaired'
					: online
						? 'connected'
						: f.bridge.state === 'offline'
							? 'error'
							: 'checking',
			line: viaDevice ? 'bridgeViaDevice' : 'bridge',
			when: null
		},
		{
			id: 'ki',
			group: 'basis',
			initials: 'KI',
			kind: viaBridge(f.bridge.health.llm),
			state: f.bridge.health.llm && paired ? 'setUp' : 'notSetUp',
			line: 'ki',
			when: f.events.find((e) => e.kind === 'extract')?.at ?? null
		},
		{
			id: 'geraete',
			group: 'basis',
			initials: 'Ge',
			kind: f.devices.removed || f.devices.error ? 'warn' : f.devices.online ? 'ok' : 'off',
			state: f.devices.removed
				? 'removed'
				: f.devices.online
					? 'on'
					: f.devices.flag
						? 'pending'
						: 'off',
			params: { count: f.devices.connected },
			line: f.devices.online ? 'devicesOn' : 'devicesOff',
			when: null
		},
		{
			id: 'bank',
			group: 'sources',
			initials: 'Ba',
			kind: hibiscus.length || camt.length ? 'ok' : viaBridge(f.bridge.health.hibiscus),
			state:
				hibiscus.length || camt.length
					? 'connected'
					: f.bridge.health.hibiscus
						? 'setUp'
						: 'notSetUp',
			params: { count: hibiscus.length + camt.length },
			line: hibiscus.length + camt.length ? 'bankAccounts' : 'bankNone',
			when: bankWhen
		},
		{
			id: 'kraken',
			group: 'sources',
			initials: 'Kr',
			kind: f.alerts?.kraken ? 'err' : viaBridge(f.bridge.health.kraken),
			state: f.alerts?.kraken ? 'error' : f.bridge.health.kraken && paired ? 'setUp' : 'notSetUp',
			line: 'kraken',
			when: krakenWhen
		},
		{
			id: 'wallets',
			group: 'sources',
			initials: 'Wa',
			kind: Object.values(f.alerts?.wallets ?? {}).some((n) => n > 0)
				? 'warn'
				: f.wallets
					? 'ok'
					: 'off',
			state: f.wallets ? 'connected' : 'none',
			params: { count: f.wallets },
			line: f.wallets ? 'wallets' : 'walletsNone',
			when: walletWhen
		},
		{
			id: 'aleph',
			group: 'sources',
			initials: 'Al',
			kind: f.aleph ? 'ok' : 'off',
			state: f.aleph ? 'connected' : 'none',
			params: { count: f.aleph },
			line: f.aleph ? 'aleph' : 'alephNone',
			when: null
		},
		{
			id: '',
			href: '/belege',
			group: 'sources',
			initials: 'Po',
			kind: viaBridge(f.bridge.health.mail),
			state: f.bridge.health.mail && paired ? 'setUp' : 'notSetUp',
			line: 'mail',
			when: f.events.find((e) => e.kind === 'mail-fetch')?.at ?? null
		},
		{
			id: 'portale',
			group: 'sources',
			initials: 'KP',
			kind: paired ? 'ok' : 'off',
			state: paired ? 'onDemand' : 'notSetUp',
			line: 'portals',
			when: null
		},
		{
			id: 'rechnungs-app',
			group: 'together',
			initials: 'Re',
			kind: f.invoiceApp ? 'ok' : 'off',
			state: f.invoiceApp ? 'paired' : 'notPaired',
			line: 'invoiceApp',
			when: null
		},
		{
			id: 'assistent',
			group: 'together',
			initials: 'As',
			kind: 'off',
			state: 'onDemand',
			line: 'assistant',
			when: null
		}
	];

	/** @type {Need[]} */
	const needs = [];
	if (f.alerts?.kraken) needs.push({ id: 'kraken', kind: 'err', text: 'krakenRefused' });
	const walletHints = Object.values(f.alerts?.wallets ?? {}).filter((n) => n > 0).length;
	if (walletHints)
		needs.push({
			id: 'wallets',
			kind: 'warn',
			text: 'walletHints',
			params: { count: walletHints }
		});
	if (paired && f.bridge.state === 'offline')
		needs.push({
			id: 'bridge',
			kind: 'err',
			text: f.devices.online ? 'bridgeOfflineDevices' : 'bridgeOffline'
		});
	if (f.devices.removed) needs.push({ id: 'geraete', kind: 'warn', text: 'deviceRemoved' });
	else if (f.devices.error) needs.push({ id: 'geraete', kind: 'warn', text: 'deviceError' });
	if (paired && online && f.bridge.health.hibiscus && !bankWhen)
		needs.push({ id: 'bank', kind: 'warn', text: 'neverSynced', params: { name: 'Hibiscus' } });
	if (paired && online && f.bridge.health.kraken && !krakenWhen)
		needs.push({ id: 'kraken', kind: 'warn', text: 'neverSynced', params: { name: 'Kraken' } });

	return {
		viaDevice,
		rows,
		needs,
		counts: {
			ok: rows.filter((r) => r.kind === 'ok').length,
			needs: needs.length,
			off: rows.filter((r) => r.kind === 'off').length
		}
	};
}
