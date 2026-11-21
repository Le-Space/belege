// App-wide state: who is signed in, and the records the pages show.
import { networkPause } from './network-pause.js';
import { OTHER_BOOKS_KEY, asksAtUnlock, describeOther, worthOffering } from './keys/other-vault.js';
import {
	createPasskeyCredential,
	loadStoredPasskeyCredential,
	restorePasskeyCredential
} from './passkey-identity.js';
import { getSetting, setSetting } from './store/settings.js';
import { passkeyStepsFor } from './passkey-steps.svelte.js';
import { sharedOrigin } from './shared-origin.js';
import { t } from './i18n/index.js';
import { requestPersistence } from './storage/safety.js';
import {
	applyStoredMode,
	bindSession as bindNetwork,
	forgetLanRelayAsked,
	startUcepIfPaired
} from './session/network.js';
import {
	bindSession as bindDevices,
	currentDeviceSync,
	currentFilePrefetch,
	deviceLabel,
	startDeviceSyncIfOn,
	stopFilePrefetch,
	watchQrConnections,
	watchSync
} from './session/devices.js';
import {
	bindSession as bindLocalBridge,
	currentBridgeConsumer,
	startLoopbackBridge
} from './bridge-connection/local.js';
import {
	bindSession as bindPairedClient,
	pairedClient,
	refreshLlmRedaction
} from './bridge-connection/paired-client.js';
import {
	bindSession as bindRefresh,
	fillExchangeRates,
	refresh,
	runMatchingNow,
	scheduleRefresh
} from './session/refresh.js';
import { bindSession as bindJobs, checkFolderNow } from './session/jobs.js';

/** @typedef {import('./node.js').Session} Session */
/** @typedef {import('./store/repository.js').StoredRecord} StoredRecord */

export const app = $state({
	/** @type {'locked' | 'starting' | 'ready' | 'error'} */
	status: 'locked',
	/** @type {string | null} */
	error: null,
	/**
	 * Where an unlock is, while `status` is 'starting' after the passkey answered
	 * (unlock-progress.js): the step, a collection, a move's count, its start.
	 * @type {(import('./unlock-progress.js').Status & { since: number, stepSince: number }) | null}
	 */
	unlock: null,
	/** @type {string | null} */
	did: null,
	/**
	 * Whether the browser keeps this site's storage for good (storage/safety.js),
	 * asked on every unlock; null: not asked yet, or it cannot say.
	 * @type {boolean | null}
	 */
	persisted: null,
	/**
	 * Whether the paired bridge blacks out what goes to its language model
	 * (#423): false for a model on its own computer, which gets the text as it
	 * is. null: not known (no bridge, no model, not asked yet) – the hints then
	 * say "geschwärzt", as for a provider on the internet (ai-text.js); 'enclave':
	 * unredacted into an attested enclave (#416).
	 * @type {boolean | 'enclave' | null}
	 */
	llmRedaction: null,
	/**
	 * The paired bridge's model, for the cost hints beside the AI buttons
	 * (stats/ai-estimate.js): host, model, on its own computer. null: not known.
	 * @type {{ provider: string | null, model: string | null, local: boolean } | null}
	 */
	llmModel: null,
	/**
	 * The books' passkeys (#406): one slot each in the vault, this browser's
	 * name for it, and whether it is the one that unlocked. `indexOn`: the
	 * vault is published on Aleph for empty devices (backup/vault-index.js).
	 * `words`: the recovery words' slot, when there is one (stage 2).
	 * @type {{ slots: { kid: string, label: string, addedAt: string, mine: boolean }[], indexOn: boolean, words: { addedAt: string } | null }}
	 */
	vault: { slots: [], indexOn: false, words: null },
	/** Books just made: recovery words are offered once (keys/WordsOffer.svelte). */
	offerWords: false,
	/**
	 * The other books this passkey has on Aleph (#524, keys/other-vault.js):
	 * a vault of other books that it opens, offered in place of the ones this
	 * device founded. null: none known, or not asked.
	 * @type {{ passkeys: number, words: boolean, since: string } | null}
	 */
	otherBooks: null,
	/**
	 * After the person took that offer and the passkey answered: `opened` –
	 * these are those books; `none` – they could not be opened, these are the
	 * books of before.
	 * @type {'' | 'opened' | 'none'}
	 */
	otherBooksOpened: '',
	/**
	 * New keys for the books (#627): `left` – this passkey has no slot in the
	 * new vault, these are the old books; `done` – the books were taken over
	 * under the new keys; `taking` – that is going on now.
	 * @type {'' | 'left' | 'done' | 'taking'}
	 */
	rekey: '',
	/**
	 * How long the Aleph account's credits keep the backups (backup/credits-watch.js):
	 * days left at what the kept backups cost; null when it cannot be told.
	 * @type {{ days: number, credits: number } | null}
	 */
	backupCredits: null,
	/**
	 * Receipt files this device does not have yet, and those on their way
	 * from an own device (receipts/prefetch.js): root CIDs.
	 */
	files: {
		/** whether this device has looked at every file yet: off without device sync */
		checked: false,
		/** files the receipts name */
		total: 0,
		/** @type {string[]} */
		missing: [],
		/** @type {string[]} */
		fetching: [],
		/** @type {string[]} missing, too large to fetch unasked: they come when opened */
		tooLarge: []
	},
	/** Device sync (#123): off, or this device's id and the devices it knows. */
	sync: {
		online: false,
		/** @type {import('./sync/device-sync.js').SyncState | null} */
		state: null,
		/** @type {import('./sync/device-sync.js').SyncPulse | null} the last ping an own device answered */
		pulse: null,
		/** @type {import('./sync/sync-log.js').SyncLine | null} the last entry that came or went (sync/sync-log.js) */
		data: null,
		/** @type {import('./sync/sync-log.js').SyncLine[]} the sync log, newest first */
		log: [],
		/** @type {Record<string, number>} when each own device last sent something, by peer id */
		lastIn: {},
		/** @type {string | null} */
		error: null,
		/** Another device removed this one; its sync is switched off. */
		removed: false,
		/** This desktop serves its bridge to own devices (#142). */
		bridgeServed: false,
		/**
		 * How the bridge answered last: over the stream to its own node (#573),
		 * here over HTTP, or through an own device's (#142).
		 * @type {'stream' | 'local' | 'device'}
		 */
		bridgeRoute: 'local',
		/** When the bridge's node last took the books' device list (#579): its grants are read again. */
		bridgeDevicesAt: 0
	},
	/** @type {StoredRecord[]} */
	transactions: [],
	/** @type {StoredRecord[]} */
	receipts: [],
	/** @type {StoredRecord[]} */
	partners: [],
	/** @type {StoredRecord[]} */
	accounts: [],
	/** @type {StoredRecord[]} */
	matches: [],
	/** @type {StoredRecord[]} */
	questions: [],
	/** @type {StoredRecord[]} the Verlauf, newest first */
	events: [],
	/** @type {StoredRecord[]} travellers, trips and statements (travel/records.js, #213) */
	travel: [],
	/** @type {Record<string, import('./matching/classify.js').Classification>} bookings that need no receipt, by id */
	classifications: {},
	/** @type {any} the stored "Eigene Anweisungen" (settings key `matching`) */
	matchingSettings: null,
	/** @type {any} the stored DATEV values (settings key `datev`, booking/settings.js) */
	datevSettings: null,
	/** @type {import('./booking/chart.js').StoredChart | null} the person's chart of accounts (settings key `chart`) */
	chart: null,
	/** whether an "Abgleich" is running */
	matching: false,
	/** @type {import('./matching/engine.js').MatchingProgress | null} where the running "Abgleich" is */
	matchingProgress: null,
	/** The header's network menu (network-pause.js): paused, or a reload needed to go online. */
	network: {
		paused: Boolean(networkPause()),
		reloadNeeded: false,
		/** this session's node went online at unlock: device sync can go on and off at once */
		syncCapable: false,
		/**
		 * Where own devices meet (sync/network-mode.js, #148): as this session's
		 * node was built, and as the books say now – a change applies at the next unlock.
		 * @type {import('./sync/network-mode.js').NetworkMode}
		 */
		mode: 'public',
		/** @type {import('./sync/network-mode.js').NetworkMode} */
		modeWanted: 'public',
		/** @type {string | null} the relay in the own bridge, as the books know it (#148) */
		lanRelay: null,
		/** @type {string | null} a QR invite that came by link, waiting for the books to open (sync/qr-link-url.js) */
		qrInvite: null
	},
	/** @type {{ books: string, writer: string, role: 'bookkeeping' | 'reader' } | null} the books open are someone else's, as their member (#612), who writes as `writer` – or reads only (#641) */
	member: null,
	/** Belege as a UCEP consumer (ucep/): the invoicing app it is paired with. */
	ucep: {
		/** @type {'off' | 'starting' | 'running' | 'failed'} */
		status: 'off',
		/** @type {string | null} */
		peerId: null,
		/** @type {string | null} */
		error: null,
		/** @type {import('./ucep/consumer.js').PairedApp | null} */
		app: null
	}
});

/** @type {Session | null} */
let session = null;

/** @returns {Session['store'] | null} */
export function currentStore() {
	return session?.store ?? null;
}

/** @returns {Session['blobs'] | null} receipt files, sealed */
export function currentBlobs() {
	return session?.blobs ?? null;
}

/**
 * Everything this browser keeps, as one sealed backup (backup/archive.js, #77).
 *
 * @param {{ appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }} meta
 */
export async function makeBackup(meta) {
	if (!session) throw new Error('The books are not open.');
	return session.makeBackup(meta);
}

/**
 * What is new since the chain's last backup, sealed (backup/archive.js, #454);
 * null when nothing is.
 *
 * @param {{ chain: import('./backup/archive.js').BackupChain, appVersion: string, onProgress?: (p: import('./backup/archive.js').BackupProgress) => void }} meta
 */
export async function makeIncrement(meta) {
	if (!session) throw new Error('The books are not open.');
	return session.makeIncrement(meta);
}

/**
 * Whether a chain of backups goes on in these databases: an increment names
 * the databases its chain began in, and books that moved to their own
 * identity (#496) are in others – their next backup is a full one.
 *
 * @param {import('./backup/archive.js').BackupChain | null | undefined} chain
 */
export function chainFitsBooks(chain) {
	if (!session || !chain) return false;
	return Object.values(session.store.databases()).every((db) =>
		Object.hasOwn(chain.heads, String(db.address))
	);
}

/**
 * The collections that changed since the chain's last backup: their heads
 * are not the ones it shipped. Settings do not count – every backup writes
 * them (its history, the chain), as in `buildIncrement`. Comparing heads
 * walks nothing, so it is cheap enough to ask after every write.
 *
 * @param {import('./backup/archive.js').BackupChain} chain
 * @returns {Promise<string[]>}
 */
export async function unsavedCollections(chain) {
	if (!session) return [];
	/** @type {string[]} */
	const changed = [];
	for (const [name, db] of Object.entries(session.store.databases())) {
		if (name === 'settings') continue;
		/** @type {string[]} */
		const now = (await /** @type {any} */ (db).log.heads()).map((/** @type {any} */ h) =>
			String(h.hash)
		);
		const shipped = chain.heads[String(db.address)] ?? [];
		if (now.length !== shipped.length || now.some((h) => !shipped.includes(h))) changed.push(name);
	}
	return changed;
}

/**
 * Put a sealed backup back into these books (backup/archive.js, #77), with its
 * increments (#454). The books are closed for it: reload the page afterwards.
 *
 * @param {import('./backup/archive.js').SealedSource} sealed its bytes, or a function that
 *   starts a stream of them: then it is opened as it arrives (#512)
 * @param {(p: import('./backup/archive.js').RestoreProgress) => void} [onProgress]
 * @param {{ increments?: import('./backup/archive.js').SealedSource[], base?: string, fetchBytes?: (cid: string) => Promise<Uint8Array> }} [chain] its increments (#454), and where a
 *   head the backup does not carry may still be found
 */
export async function restoreBackup(sealed, onProgress, chain) {
	if (!session) throw new Error('The books are not open.');
	return session.restoreBackup(sealed, onProgress, chain);
}

// Reading the lists again, matching and the day's rates live in session/refresh.js,
// what a click starts over the books in session/jobs.js (#844); both read the
// session through what is handed to them here.
bindRefresh({
	get session() {
		return session;
	},
	app,
	readOnly: () => readOnly(),
	pairedClient: () => pairedClient()
});
bindJobs({
	get session() {
		return session;
	},
	pairedClient: () => pairedClient(),
	currentStore,
	currentBlobs
});
export {
	REFRESH_MAX_WAIT_MS,
	REFRESH_QUIET_MS,
	fillExchangeRates,
	refreshNow,
	runMatchingNow
} from './session/refresh.js';
export { checkFolderNow, dropPendingJob, extractAgain, resumeJob } from './session/jobs.js';

/** @type {(() => void) | null} */
let stopFolderWatch = null;

// The network (the invoicing app's node, the header's menu, where devices meet)
// lives in session/network.js, the own devices (QR, device sync, the list) in
// session/devices.js (#844); both read the session through what is handed to
// them here.
bindNetwork({
	get session() {
		return session;
	},
	app,
	readOnly: () => readOnly(),
	get filePrefetch() {
		return currentFilePrefetch();
	}
});
bindDevices({
	get session() {
		return session;
	},
	app
});
export {
	currentUcep,
	pauseNetwork,
	refreshUcep,
	resumeNetwork,
	setDevicesNetwork,
	setNetworkMode,
	startUcep,
	stopUcep
} from './session/network.js';
export {
	addSyncDevice,
	answerAskingDevice,
	clearSyncLog,
	ownDevicesConnected,
	qrInvite,
	qrScanned,
	removeSyncDevice,
	setNewDeviceBridgeScopes
} from './session/devices.js';

// The bridge on a computer lives in bridge-connection/local.js, the client for
// the paired bridge in bridge-connection/paired-client.js (#844); both read the
// session through what is handed to them here.
bindLocalBridge({
	get session() {
		return session;
	},
	app,
	get deviceSync() {
		return currentDeviceSync();
	},
	deviceLabel: () => deviceLabel()
});
bindPairedClient({
	get session() {
		return session;
	},
	app
});
export { pairedClient, refreshLlmRedaction } from './bridge-connection/paired-client.js';
export {
	bridgeGrants,
	bridgeOnThisMachine,
	forgetBridgeNode,
	pairBridgeNode,
	renewBridgeDevice,
	setBridgeDeviceScopes
} from './bridge-connection/local.js';

// The hosted bridge on Phala and the settings kept for a hosted bridge live in
// bridge-connection/hosted-near.js and kept-settings.js (#844): loaded when first
// asked for, and handed what they need of the open session (`hostedContext` below).
async function hostedNear() {
	const module = await import('./bridge-connection/hosted-near.js');
	module.bindSession(hostedContext);
	return module;
}

async function keptSettings() {
	const module = await import('./bridge-connection/kept-settings.js');
	module.bindSession(hostedContext);
	return module;
}

/** @typedef {typeof import('./bridge-connection/hosted-near.js')} HostedNear */
/** @typedef {typeof import('./bridge-connection/kept-settings.js')} KeptSettings */

/** @type {HostedNear['nearHostedRecord']} */
export const nearHostedRecord = async (...args) => (await hostedNear()).nearHostedRecord(...args);
/** @type {HostedNear['nearBridgeStatus']} */
export const nearBridgeStatus = async (...args) => (await hostedNear()).nearBridgeStatus(...args);
/** @type {HostedNear['startNearHostedBridge']} */
export const startNearHostedBridge = async (...args) =>
	(await hostedNear()).startNearHostedBridge(...args);
/** @type {HostedNear['stopNearHostedBridge']} */
export const stopNearHostedBridge = async (...args) =>
	(await hostedNear()).stopNearHostedBridge(...args);
/** @type {KeptSettings['hostedSettingsNames']} */
export const hostedSettingsNames = async (...args) =>
	(await keptSettings()).hostedSettingsNames(...args);
/** @type {KeptSettings['hostedSettingsView']} */
export const hostedSettingsView = async (...args) =>
	(await keptSettings()).hostedSettingsView(...args);
/** @type {KeptSettings['keepHostedSettings']} */
export const keepHostedSettings = async (...args) =>
	(await keptSettings()).keepHostedSettings(...args);
/** @type {KeptSettings['forgetHostedSettings']} */
export const forgetHostedSettings = async (...args) =>
	(await keptSettings()).forgetHostedSettings(...args);
/** @type {KeptSettings['takeOverBridgeSettings']} */
export const takeOverBridgeSettings = async (...args) =>
	(await keptSettings()).takeOverBridgeSettings(...args);

// The hosted bridge on Aleph lives in bridge-connection/hosted-aleph.js (#844): loaded when
// first asked for, and handed what it needs of the open session.
async function hostedAleph() {
	const module = await import('./bridge-connection/hosted-aleph.js');
	module.bindSession(hostedContext);
	return module;
}

/** @type {import('./bridge-connection/hosted-aleph.js').SessionContext} */
const hostedContext = {
	get session() {
		return session;
	},
	app,
	get deviceSync() {
		return currentDeviceSync();
	},
	get bridgeConsumer() {
		return currentBridgeConsumer();
	},
	keptHostedSettings: async () => (await keptSettings()).keptHostedSettings()
};

/** @typedef {typeof import('./bridge-connection/hosted-aleph.js')} HostedAleph */

/** @type {HostedAleph['hostedBridgeRecord']} */
export const hostedBridgeRecord = async (...args) =>
	(await hostedAleph()).hostedBridgeRecord(...args);
/** @type {HostedAleph['unlockHostedBridge']} */
export const unlockHostedBridge = async (...args) =>
	(await hostedAleph()).unlockHostedBridge(...args);
/** @type {HostedAleph['hostedVmRecord']} */
export const hostedVmRecord = async (...args) => (await hostedAleph()).hostedVmRecord(...args);
/** @type {HostedAleph['hostedOwnImage']} */
export const hostedOwnImage = async (...args) => (await hostedAleph()).hostedOwnImage(...args);
/** @type {HostedAleph['forgetLeftHostedBuilder']} */
export const forgetLeftHostedBuilder = async (...args) =>
	(await hostedAleph()).forgetLeftHostedBuilder(...args);
/** @type {HostedAleph['hostedBuildReserve']} */
export const hostedBuildReserve = async (...args) =>
	(await hostedAleph()).hostedBuildReserve(...args);
/** @type {HostedAleph['buildHostedImage']} */
export const buildHostedImage = async (...args) => (await hostedAleph()).buildHostedImage(...args);
/** @type {HostedAleph['hostedNodeHistory']} */
export const hostedNodeHistory = async (...args) =>
	(await hostedAleph()).hostedNodeHistory(...args);
/** @type {HostedAleph['hostedNodes']} */
export const hostedNodes = async (...args) => (await hostedAleph()).hostedNodes(...args);
/** @type {HostedAleph['hostedCredits']} */
export const hostedCredits = async (...args) => (await hostedAleph()).hostedCredits(...args);
/** @type {HostedAleph['chooseHostedPlan']} */
export const chooseHostedPlan = async (...args) => (await hostedAleph()).chooseHostedPlan(...args);
/** @type {HostedAleph['startHostedBridge']} */
export const startHostedBridge = async (...args) =>
	(await hostedAleph()).startHostedBridge(...args);
/** @type {HostedAleph['continueHostedStart']} */
export const continueHostedStart = async (...args) =>
	(await hostedAleph()).continueHostedStart(...args);
/** @type {HostedAleph['stopHostedBridge']} */
export const stopHostedBridge = async (...args) => (await hostedAleph()).stopHostedBridge(...args);
/** @type {HostedAleph['hostedInstances']} */
export const hostedInstances = async (...args) => (await hostedAleph()).hostedInstances(...args);
/** @type {HostedAleph['stopHostedInstance']} */
export const stopHostedInstance = async (...args) =>
	(await hostedAleph()).stopHostedInstance(...args);

// Members of the books live in members/session-members.js (#844): loaded when first asked
// for, and handed what it needs of the open session.
/** @type {typeof import('./members/session-members.js') | null} */
let membersModule = null;

async function members() {
	membersModule ??= await import('./members/session-members.js');
	membersModule.bindSession({
		get session() {
			return session;
		},
		app,
		get deviceSync() {
			return currentDeviceSync();
		},
		ownerVault: () => ownerVault()
	});
	return membersModule;
}

/** @typedef {typeof import('./members/session-members.js')} SessionMembers */

/** @type {SessionMembers['startJoining']} */
export const startJoining = async (...args) => (await members()).startJoining(...args);
/** @type {SessionMembers['finishJoining']} */
export const finishJoining = async (...args) => (await members()).finishJoining(...args);
/** @type {SessionMembers['readJoinAnswer']} */
export const readJoinAnswer = async (...args) => (await members()).readJoinAnswer(...args);
/** @type {SessionMembers['readJoinCode']} */
export const readJoinCode = async (...args) => (await members()).readJoinCode(...args);
/** @type {SessionMembers['admitMember']} */
export const admitMember = async (...args) => (await members()).admitMember(...args);
/** @type {SessionMembers['removeMember']} */
export const removeMember = async (...args) => (await members()).removeMember(...args);
/**
 * At once, as before: a join that was started has loaded the module; without one
 * there is nothing to forget.
 * @type {SessionMembers['cancelJoining']}
 */
export const cancelJoining = (...args) => membersModule?.cancelJoining(...args);

/** The books are open to read only: a member in the role `reader` (#641). */
export const readOnly = () => session?.member?.role === 'reader';

/**
 * @typedef {{ opened: import('./books-vault.js').OpenedVault, owner: string, label: string }} Recovered
 *   the vault the recovery words opened, for a new passkey (#406, stage 2)
 */

/**
 * @param {any} credential
 * @param {ReturnType<typeof import('./unlock-progress.js').createUnlockProgress>} [progress]
 * @param {(purpose: 'prf') => Promise<void>} [beforePrompt] what the next touch is for (#429)
 * @param {{ lookupVault?: boolean, otherVault?: boolean, recovered?: Recovered, memberOf?: string }} [options] `lookupVault`: an empty
 *   device – ask Aleph's index for the vault (#406); `otherVault`: the other books this
 *   passkey has there, as the person chose (#524); `recovered`: opened with recovery words;
 *   `memberOf`: a member's books, by the member vault's id (#612)
 */
async function unlockWith(
	credential,
	progress,
	beforePrompt,
	{ lookupVault = false, otherVault = false, recovered, memberOf } = {}
) {
	// Loaded lazily: Helia, libp2p and OrbitDB are most of the bundle, and the
	// onboarding screen needs none of them.
	const { startSession } = await import('./node.js');
	session = await startSession(credential, {
		onStatus: (s) => progress?.status(s),
		beforePrompt,
		lookupVault,
		...(otherVault ? { otherVault } : {}),
		...(recovered ? { recovered } : {}),
		...(memberOf ? { memberOf } : {})
	});
	app.otherBooks = null;
	app.otherBooksOpened = otherVault ? (session.vault?.switched ? 'opened' : 'none') : '';
	// The books have new keys (#627): this passkey took the new vault – the
	// page opens it at once, with one more answer of the passkey – or has no
	// slot in it, and stays in the old books, which say so.
	if (session.moved && 'peers' in session.moved) {
		const { DIAL_STORAGE_KEY } = await import('./move/rekey.js');
		globalThis.localStorage.setItem(DIAL_STORAGE_KEY, JSON.stringify(session.moved.peers));
		await session.stop().catch(() => {});
		session = null;
		location.reload();
		return new Promise(() => {});
	}
	app.rekey = session.moved ? 'left' : '';
	app.member = session.member
		? {
				books: session.member.books.label,
				writer: session.member.writer,
				role: session.member.role
			}
		: null;
	await showVault();
	app.network.syncCapable = Boolean(session.online);
	app.network.reloadNeeded = false;
	app.network.mode = session.mode;
	app.network.modeWanted = session.mode;
	forgetLanRelayAsked();
	app.did = session.did;
	for (const name of /** @type {const} */ ([
		'transactions',
		'receipts',
		'partners',
		'accounts',
		'matches',
		'questions',
		'events',
		'settings',
		'travel'
	])) {
		session.store[name].onChange(scheduleRefresh);
	}
	session.store.settings.onChange(() => {
		applyStoredMode().catch(() => {});
	});
	await watchSync();
	await applyStoredMode();
	progress?.status({ step: 'books' });
	await refresh();
	installE2EHooks();
	// Books that look empty, on a device that is online: this passkey may have
	// others on Aleph (#524). Not awaited, and no reason for an unlock to fail.
	if (
		!otherVault &&
		asksAtUnlock({
			paused: Boolean(networkPause()),
			online: Boolean(session.online),
			mode: session.mode,
			member: Boolean(session.member),
			empty: app.transactions.length === 0 && app.receipts.length === 0
		})
	) {
		lookForOtherBooks('unlock').catch((e) => console.warn('other books on Aleph:', e));
	}
	// New keys made on this device (#627): the books packed before the reload come in.
	await takeOverAfterNewKeys().catch((e) => console.error('new keys:', e));
	// Changed elsewhere while this device was locked: one run, in the background (#473).
	{
		const { fingerprint, lastRunOf } = await import('./matching/catch-up.js');
		if (app.did && lastRunOf(globalThis.localStorage, app.did) !== fingerprint(app)) {
			runMatchingNow();
		}
	}
	// Not awaited: the browser's answer, for Home's warning (storage/safety.js).
	requestPersistence().then((kept) => (app.persisted = kept));
	// Not awaited: rates for instalments of invoices in another currency.
	fillExchangeRates();
	// Not awaited: whether the AI hints may say "geschwärzt" (ai-text.js).
	refreshLlmRedaction();
	// Not awaited: the books are open, whatever the relay does.
	startUcepIfPaired();
	// Not awaited: how long the credits keep the backups, for the header.
	import('./backup/credits-watch.js')
		.then(({ checkBackupCredits }) => checkBackupCredits())
		.catch(() => {});
	{
		// The bridge's calls wait until device sync has set up the stream to its node (#575).
		const { holdBridgeTransport, setExpectedBridge } = await import('./bridge/client.js');
		// Which bridge these books expect, for what the client says when none answers (#844).
		const { expectedBridgeOf } = await import('./bridge-connection/expected.js');
		setExpectedBridge(() => (session ? expectedBridgeOf(session.store.settings) : null));
		const release = holdBridgeTransport();
		// With device sync off, the bridge on this machine over a stream of its own (#580).
		(session?.online ? startDeviceSyncIfOn() : startLoopbackBridge())
			.finally(release)
			.then(watchQrConnections)
			.then(dialAfterNewKeys)
			.catch((e) => console.warn('device sync:', e));
	}
	const { folderSupported } = await import('./receipts/folder.js');
	if (folderSupported() && !stopFolderWatch) {
		const { watchFolder } = await import('./receipts/folder-watch.js');
		stopFolderWatch = watchFolder(() => checkFolderNow());
	}
}

/**
 * @param {() => Promise<any>} getCredential
 * @param {string} nothingFound shown when the credential step finds nothing
 * @param {'create' | 'restore' | 'unlock'} flow which prompts follow, and what is said before each (#429)
 * @param {{ recovered?: () => Recovered | undefined }} [options]
 *   the vault the recovery words opened, once `getCredential` has opened it
 */
async function run(getCredential, nothingFound, flow, { recovered } = {}) {
	// Never on an origin other CIDs share (shared-origin.js); the screen offers no button there.
	if (sharedOrigin()) return;
	app.status = 'starting';
	app.error = null;
	/** @type {ReturnType<typeof import('./unlock-progress.js').createUnlockProgress> | null} */
	let progress = null;
	let letSleep = () => {};
	let letQuiet = () => {};
	try {
		const credential = await getCredential();
		if (!credential) throw new Error(nothingFound);
		// After the passkey answered: from here on the books open, and that is shown.
		const { createUnlockProgress } = await import('./unlock-progress.js');
		const { holdAlive } = await import('./keep-alive.js');
		const { t } = await import('./i18n/index.js');
		let moving = false;
		progress = createUnlockProgress({
			onChange: (s) => {
				app.unlock = s;
				// A move of the books after an update takes minutes: a tone keeps
				// the tab from being frozen when a phone switches apps (#525). Only
				// then, not for every unlock; the click on "Öffnen" still counts.
				if (s.step === 'move' && !moving) {
					moving = true;
					letQuiet = holdAlive({ title: t('keepAlive.moving') });
				}
			}
		});
		// Opening may move the books after an update, for minutes: a phone must
		// not darken its screen meanwhile (#512).
		const { keepAwake } = await import('./wake-lock.js');
		letSleep = keepAwake();
		// A restore is an empty device: its passkey's vault may be on Aleph (#406),
		// asked unless the network is paused.
		const opened = recovered?.();
		// The books chosen on the unlock screen (#612): the own, or a member's.
		const { chosenBooks } = await import('./members/open-choice.js');
		const memberOf = flow === 'unlock' ? chosenBooks() : '';
		// The person chose the other books of this passkey (#524): this one unlock.
		// Read in every case, so it never waits for a later unlock.
		const chosen = takeOtherBooksChoice();
		const otherVault = flow === 'unlock' && !memberOf && chosen;
		await unlockWith(credential, progress, passkeyStepsFor(flow), {
			lookupVault: flow === 'restore' && !networkPause(),
			...(otherVault && !networkPause() ? { otherVault } : {}),
			...(opened ? { recovered: opened } : {}),
			...(memberOf ? { memberOf } : {})
		});
		progress.finish('ready');
		app.unlock = null;
		app.offerWords = flow === 'create' && !opened;
		app.status = 'ready';
	} catch (error) {
		progress?.finish('failed');
		app.unlock = null;
		console.error('unlock failed:', error);
		app.status = 'error';
		app.error = error instanceof Error ? error.message : String(error);
	} finally {
		letSleep();
		letQuiet();
	}
}

/**
 * The books' vault, open – the owner's only: a member's session has none
 * (#612), and what changes the books' passkeys or words is the owner's.
 */
function ownerVault() {
	if (!session?.vault) throw new Error(t('members.ownerOnly'));
	return session.vault;
}

/** The setting that says the vault is published on Aleph (#406). */
const VAULT_INDEX_SETTING = 'vault/index';

/** What the keys page shows of the open vault. */
async function showVault() {
	// A member's session has no books' vault to show (#612).
	if (!session?.vault) return;
	const { record, kid } = ownerVault();
	const { wordsSlotId } = await import('./books-vault.js');
	const wordsKid = await wordsSlotId();
	// Every slot in the vault, named where this browser knows the name.
	const known = new Map(record.slots.map((s) => [s.kid, s]));
	const words = record.vault.slots.some((/** @type {{ kid: string }} */ v) => v.kid === wordsKid);
	app.vault = {
		slots: record.vault.slots
			.filter((/** @type {{ kid: string }} */ v) => v.kid !== wordsKid)
			.map((/** @type {{ kid: string }} */ v) => ({
				kid: v.kid,
				label: known.get(v.kid)?.label ?? '',
				addedAt: known.get(v.kid)?.addedAt ?? '',
				mine: v.kid === kid
			})),
		indexOn: (await getSetting(session.store.settings, VAULT_INDEX_SETTING)) === true,
		words: words ? { addedAt: known.get(wordsKid)?.addedAt ?? '' } : null
	};
}

/** The choice `openOtherBooks` left for this unlock, read once. */
function takeOtherBooksChoice() {
	try {
		const chosen = globalThis.sessionStorage?.getItem(OTHER_BOOKS_KEY) === '1';
		globalThis.sessionStorage?.removeItem(OTHER_BOOKS_KEY);
		return chosen;
	} catch {
		return false;
	}
}

/**
 * Ask this passkey's index on Aleph whether it has other books than the ones
 * open (#524), and offer them (`app.otherBooks`). Never while the network is
 * paused, never for a member's books. What the index names is checked with
 * the passkey's own slot before anything is said (books-vault.js `otherBooks`).
 *
 * @param {'restore' | 'asked' | 'unlock'} why a backup was refused, the person asked, or books that look empty
 * @returns {Promise<boolean>} whether there are such books to offer
 */
export async function lookForOtherBooks(why) {
	if (!session?.vault || session.member || networkPause()) return false;
	const asked = session;
	const { wordsSlotId } = await import('./books-vault.js');
	const there = await asked.otherVault();
	// The books were closed, or others opened, while Aleph answered.
	if (session !== asked || !asked.vault) return false;
	app.otherBooks =
		there && worthOffering(why, asked.vault.record, there)
			? describeOther(there, await wordsSlotId())
			: null;
	return Boolean(app.otherBooks);
}

/**
 * The person's yes to the offer: the page reloads, and the next unlock asks
 * the index again and opens those books with the passkey's answer – or the
 * ones here, when that fails. The books this device founded stay in this
 * browser, set aside for this passkey (books-vault.js `openBooksVault`).
 */
export async function openOtherBooks() {
	if (!session) throw new Error('The books are not open.');
	if (networkPause()) throw new Error(t('settings.keys.paused'));
	globalThis.sessionStorage.setItem(OTHER_BOOKS_KEY, '1');
	await session.stop().catch(() => {});
	session = null;
	location.reload();
	return new Promise(() => {});
}

/**
 * Publish the vault on Aleph (#406): index M with the pointer to the paying
 * account, and index P of this passkey and of `extraKeys`. Never while the
 * network is paused. Switches publishing on for later backups.
 *
 * @param {Uint8Array[]} [extraKeys] index keys of passkeys just added
 */
export async function publishBooksVault(extraKeys = []) {
	if (!session) throw new Error('The books are not open.');
	if (networkPause()) throw new Error(t('settings.keys.paused'));
	const [{ publishVault }, { loadOwner }, { setSetting }] = await Promise.all([
		import('./backup/vault-index.js'),
		import('./backup/keeper.js'),
		import('./store/settings.js')
	]);
	await publishVault({
		root: ownerVault().root,
		record: ownerVault().record,
		passkeyKeys: [session.ownIndexKey, ...extraKeys],
		owner: await loadOwner(session.store.settings)
	});
	await setSetting(session.store.settings, VAULT_INDEX_SETTING, true);
	await showVault();
}

/**
 * The paying account a member's index on Aleph named (#613): what the backup
 * card shows until the books' own settings have come by sync.
 */
export const pointedOwner = () => session?.pointedOwner || null;

/**
 * "Neue Schlüssel für die Bücher" (#627), on the owner's device: a new root
 * and a new vault for the passkeys in `stay` – each answers once –, the books
 * packed for it and kept in this browser, their successor written into the
 * old books, and the page reloaded into the new books (move/rekey.js).
 *
 * @param {string[]} stay the slot ids of the passkeys that stay; this one among them
 */
export async function renewBooksKeys(stay) {
	if (!session) throw new Error('The books are not open.');
	const opened = ownerVault();
	if (!stay.includes(opened.kid)) throw new Error(t('settings.keys.rekey.thisOne'));
	const [
		vaultModule,
		{ readPrfOutput },
		{ WebAuthnDIDProvider },
		{ packBooks },
		rekey,
		keys,
		sync,
		{ releaseName }
	] = await Promise.all([
		import('./books-vault.js'),
		import('./passkey-identity.js'),
		import('@le-space/orbitdb-identity-provider-webauthn-did'),
		import('./move/book-move.js'),
		import('./move/rekey.js'),
		import('./database-keys.js'),
		import('./sync/device-sync.js'),
		import('./build-info.js')
	]);
	const wordsKid = await vaultModule.wordsSlotId();
	/** @type {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} */
	const answers = [];
	for (const slot of opened.record.slots.filter(
		(x) => stay.includes(x.kid) && x.kid !== wordsKid
	)) {
		const rawCredentialId = new Uint8Array(
			WebAuthnDIDProvider.base64urlToArrayBuffer(slot.credentialId)
		);
		answers.push({
			prfOutput: await readPrfOutput({ credentialId: slot.credentialId, rawCredentialId }),
			rawCredentialId
		});
	}
	const root = crypto.getRandomValues(new Uint8Array(32));
	try {
		const next = await vaultModule.newBooksVault(opened, answers, root);
		const byOthers = await session.settingsByOthers([...rekey.KEPT]);
		const blobs = currentBlobs();
		if (!blobs) throw new Error('The books are not open.');
		const { file } = await packBooks({
			store: /** @type {any} */ (session.store),
			blobs,
			seal: { to: rekey.rekeyMoveKey(root).publicKey },
			appVersion: releaseName() || 'dev',
			// What only the owner sets comes along only as the owner set it.
			kept: [...rekey.KEPT].filter((k) => !byOthers.includes(k)),
			dropped: [...rekey.DROPPED]
		});
		await rekey.keepRekeyFile(file);
		// Whom another device dials in the new books: this one, under its new id.
		const { generateKeyPairFromSeed } = await import('@libp2p/crypto/keys');
		const { peerIdFromPrivateKey } = await import('@libp2p/peer-id');
		const peer = peerIdFromPrivateKey(
			await generateKeyPairFromSeed(
				'Ed25519',
				await keys.deriveDevicePeerSeed(root, sync.deviceSalt())
			)
		).toString();
		const successor = { vault: next.record.vault, removed: next.record.removed, peers: [peer] };
		await setSetting(session.store.settings, rekey.SUCCESSOR_SETTING, successor);
		// For a device offline now: the old books' index on Aleph names it too,
		// when the vault is kept there.
		if (app.vault.indexOn && !networkPause()) {
			const { publishRootSuccessor } = await import('./backup/vault-index.js');
			await publishRootSuccessor({ root: opened.root, successor }).catch((e) =>
				console.warn('vault index:', e)
			);
		}
		// Devices connected now get it through the old books: a moment for that.
		if ((app.sync.state?.devices ?? []).some((d) => d.connected)) {
			await session.store.resync().catch(() => {});
			await new Promise((resolve) => setTimeout(resolve, 10_000));
		}
		// This browser takes the new vault now, so the reload opens the new books.
		vaultModule.replaceVaultRecord(opened.record.vault.id, next.record, globalThis.localStorage);
	} finally {
		root.fill(0);
		for (const a of answers) a.prfOutput.fill(0);
	}
	stopFilePrefetch();
	await session.stop().catch(() => {});
	session = null;
	location.reload();
}

/** The books packed for new keys (#627), taken over into the new books once. */
async function takeOverAfterNewKeys() {
	if (!session?.vault) return;
	const rekey = await import('./move/rekey.js');
	const file = await rekey.rekeyFile();
	if (!file) return;
	const { MoveError, openMoveFile, takeOverBooks } = await import('./move/book-move.js');
	/** @type {Awaited<ReturnType<typeof openMoveFile>>} */
	let opened;
	try {
		opened = await openMoveFile(file, rekey.rekeyMoveKey(session.vault.root));
	} catch (e) {
		// Sealed for other books: not for these, and kept for the ones it is for.
		if (e instanceof MoveError && e.code === 'key') return;
		throw e;
	}
	const blobs = currentBlobs();
	if (!blobs) return;
	app.rekey = 'taking';
	await takeOverBooks({ store: /** @type {any} */ (session.store), blobs, opened });
	await rekey.dropRekeyFile();
	app.rekey = 'done';
	await refresh();
	if (app.vault.indexOn && !networkPause()) {
		publishBooksVault().catch((e) => console.warn('vault index:', e));
	}
}

/** Another device of the owner, in the new books (#627): it dials the one that made them. */
async function dialAfterNewKeys() {
	const { DIAL_STORAGE_KEY } = await import('./move/rekey.js');
	const raw = globalThis.localStorage.getItem(DIAL_STORAGE_KEY);
	const deviceSync = currentDeviceSync();
	if (!raw || !deviceSync) return;
	/** @type {unknown} */
	let peers;
	try {
		peers = JSON.parse(raw);
	} catch {
		peers = [];
	}
	for (const peer of Array.isArray(peers) ? peers : []) {
		if (typeof peer === 'string' && peer) await deviceSync.addDevice(peer).catch(() => {});
	}
	globalThis.localStorage.removeItem(DIAL_STORAGE_KEY);
}

/**
 * A member's vault on Aleph (#613), with the account the books' backups are
 * kept for: an empty device with the member's passkey finds the books' keys
 * there, and with them the backups. Never while the network is paused.
 */
export async function publishMemberVault() {
	if (!session?.member) throw new Error('The books open are not a member’s.');
	if (networkPause()) throw new Error(t('settings.keys.paused'));
	const { loadOwner } = await import('./backup/keeper.js');
	await session.publishMembership(
		(await loadOwner(session.store.settings)) ?? (session.pointedOwner || null)
	);
}

/**
 * Give the books one more passkey (#406): it is made now, answers once, and
 * gets its own slot in the vault. This browser goes on unlocking with its own.
 *
 * @param {string} label
 * @param {{ publish?: boolean }} [options] publish the vault on Aleph as well
 */
export async function addBooksPasskey(label, { publish = false } = {}) {
	if (!session) throw new Error('The books are not open.');
	const name = label.trim() || 'Le Space Belege';
	const [{ createAdditionalPasskey, readPrfOutput }, { addPasskey }, { passkeyIndexKey }] =
		await Promise.all([
			import('./passkey-identity.js'),
			import('./books-vault.js'),
			import('./backup/vault-index.js')
		]);
	const credential = await createAdditionalPasskey({ displayName: name });
	const prfOutput = await readPrfOutput(credential);
	session.vault = await addPasskey(
		ownerVault(),
		{
			prfOutput,
			rawCredentialId: credential.rawCredentialId,
			credentialId: String(credential.credentialId ?? ''),
			label: name
		},
		globalThis.localStorage
	);
	const key = await passkeyIndexKey(prfOutput);
	prfOutput.fill(0);
	await showVault();
	if (publish || app.vault.indexOn) await publishBooksVault([key]);
}

/**
 * Take a passkey's slot out (#406). With `renew`, the vault gets a new key and
 * a slot for every passkey that stays – each answers once, this one too – for
 * a passkey that may be in other hands.
 *
 * @param {string} kid
 * @param {{ renew?: boolean }} [options]
 */
export async function removeBooksPasskey(kid, { renew = false } = {}) {
	if (!session) throw new Error('The books are not open.');
	const vaultModule = await import('./books-vault.js');
	if (!renew) {
		session.vault = vaultModule.removePasskey(ownerVault(), kid, globalThis.localStorage);
	} else {
		const { readPrfOutput } = await import('./passkey-identity.js');
		const { WebAuthnDIDProvider } = await import(
			'@le-space/orbitdb-identity-provider-webauthn-did'
		);
		/** @type {{ prfOutput: Uint8Array, rawCredentialId: Uint8Array }[]} */
		const answers = [];
		const wordsKid = await vaultModule.wordsSlotId();
		// The recovery words cannot answer here: a renewed vault has none, and says so.
		for (const slot of ownerVault().record.slots.filter(
			(s) => s.kid !== kid && s.kid !== wordsKid
		)) {
			const rawCredentialId = new Uint8Array(
				WebAuthnDIDProvider.base64urlToArrayBuffer(slot.credentialId)
			);
			const prfOutput = await readPrfOutput({ credentialId: slot.credentialId, rawCredentialId });
			answers.push({ prfOutput, rawCredentialId });
		}
		session.vault = await vaultModule.renewBooksVault(
			ownerVault(),
			answers,
			[kid],
			globalThis.localStorage
		);
		for (const a of answers) a.prfOutput.fill(0);
	}
	await showVault();
	if (app.vault.indexOn && !networkPause()) await publishBooksVault();
}

/**
 * Give the books recovery words (#406, stage 2), once the person has written
 * them down and given three of them back: one more slot in the vault. Words
 * the books had are replaced. Published on Aleph (index W) when the vault is.
 *
 * @param {string[]} words from `newRecoveryWords`
 * @param {{ publish?: boolean }} [options]
 */
export async function addBooksRecoveryWords(words, { publish = false } = {}) {
	if (!session) throw new Error('The books are not open.');
	const [{ seedFromWords }, { addRecoveryWords }, { wordsIndexKey }] = await Promise.all([
		import('./recovery-words.js'),
		import('./books-vault.js'),
		import('./backup/vault-index.js')
	]);
	const seed = await seedFromWords(words);
	try {
		session.vault = await addRecoveryWords(ownerVault(), seed, globalThis.localStorage);
		const key = await wordsIndexKey(seed);
		await showVault();
		if ((publish || app.vault.indexOn) && !networkPause()) await publishBooksVault([key]);
	} finally {
		seed.fill(0);
	}
}

/** Take the recovery words out of the vault. */
export async function removeBooksRecoveryWords() {
	if (!session) throw new Error('The books are not open.');
	const { removeRecoveryWords } = await import('./books-vault.js');
	session.vault = await removeRecoveryWords(ownerVault(), globalThis.localStorage);
	await showVault();
	if (app.vault.indexOn && !networkPause()) await publishBooksVault();
}

/**
 * Open the books with recovery words, on a device without any of their
 * passkeys (#406, stage 2): the words open the vault – kept in this browser,
 * or found on Aleph through their index unless the network is paused – then
 * a new passkey is made, gets its slot, and opens the books as any other.
 * Two prompts, as when creating. Nothing is made when the words open nothing.
 *
 * @param {string} text the words as typed or pasted
 * @param {string} label the new passkey's name
 */
export function recoverWithWords(text, label) {
	const name = label.trim() || 'Le Space Belege';
	/** @type {Recovered | undefined} */
	let recovered;
	return run(
		async () => {
			const [words, vaultModule, indexes] = await Promise.all([
				import('./recovery-words.js'),
				import('./books-vault.js'),
				import('./backup/vault-index.js')
			]);
			const typed = words.normalizeWords(text);
			const check = await words.checkWords(typed);
			if (!check.ok) {
				throw new Error(
					check.unknown.length
						? t('onboarding.words.unknown', { positions: check.unknown.join(', ') })
						: check.count !== words.WORD_COUNT
							? t('onboarding.words.count', { count: check.count })
							: t('onboarding.words.checksum')
				);
			}
			const seed = await words.seedFromWords(typed);
			try {
				const lookup = !networkPause();
				let opened = await vaultModule
					.openWithWords({
						seed,
						storage: globalThis.localStorage,
						...(lookup ? { find: () => indexes.findVaultWithWords({ seed }) } : {})
					})
					.catch((/** @type {any} */ e) => {
						if (e?.code === 'VAULT_LOCKED') throw new Error(t('onboarding.words.wrong'));
						throw e;
					});
				if (!opened) {
					throw new Error(lookup ? t('onboarding.words.notFound') : t('onboarding.words.notHere'));
				}
				let owner = '';
				if (lookup) {
					const current = await indexes.readRootIndex({ root: opened.root }).catch(() => null);
					owner = current?.pointer?.owner ?? '';
					if (current?.vault) {
						opened = await vaultModule
							.newerWithWords(opened, current.vault, seed, current.slots)
							.catch((/** @type {any} */ e) => {
								if (e instanceof vaultModule.RemovedWordsError) {
									throw new Error(t('onboarding.words.removed'));
								}
								throw e;
							});
					}
				}
				recovered = { opened, owner, label: name };
			} finally {
				seed.fill(0);
			}
			return createPasskeyCredential({ userId: name, displayName: name });
		},
		t('messages.passkey.createFailed'),
		'create',
		{ recovered: () => recovered }
	);
}

/** @param {string} label shown in the passkey picker; identifies nothing */
export function createPasskey(label) {
	const name = label.trim() || 'Le Space Belege';
	// The label in both: a security key's picker lists `user.name` (the
	// provider's `userId`), not the display name (#429). The provider makes
	// the user handle, which is what identifies the credential, at random.
	return run(
		() => createPasskeyCredential({ userId: name, displayName: name }),
		t('messages.passkey.createFailed'),
		'create'
	);
}

export function restorePasskey() {
	return run(() => restorePasskeyCredential(), t('messages.passkey.notFound'), 'restore');
}

export function unlockStoredPasskey() {
	return run(async () => loadStoredPasskeyCredential(), t('messages.passkey.notStored'), 'unlock');
}

/**
 * An E2E-only hook: tests add records through the real store, the way the
 * bank import does. Only in an E2E build (AGENTS.md), not in `vite dev`.
 */
function installE2EHooks() {
	if (import.meta.env.VITE_E2E !== 'true') return;
	/** @param {Uint8Array} bytes */
	const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
	/** @type {any} */ (window).__belegeE2E = {
		did: () => app.did,
		identityHash: () => session?.identityHash,
		peerId: () => session?.peerId,
		// Hex, so the test can look for them on disk. Present only in E2E
		// builds: node.js leaves `secretsForE2E` out of every other build.
		secrets: () => {
			const secrets = session?.secretsForE2E;
			if (!secrets) return null;
			return {
				// Only books made as before #496 (an E2E switch) have a passkey signing key.
				...(secrets.signingKey ? { signingKey: hex(secrets.signingKey) } : {}),
				// A member has none (#612).
				...(secrets.booksSecret ? { booksSecret: hex(secrets.booksSecret) } : {}),
				databaseKey: hex(secrets.databaseKey),
				replicationKey: hex(secrets.replicationKey),
				blobKey: hex(secrets.blobKey),
				peerKey: hex(secrets.peerKey)
			};
		},
		addTransaction: (/** @type {Record<string, any>} */ tx) => session?.store.transactions.put(tx),
		/** The record of a built own bridge image (#777), as "Bridge-Image bauen" leaves it. */
		setOwnImage: async (/** @type {Record<string, any>} */ record) => {
			const { IMAGE_SETTING } = await import('./integrations/hosted-image.js');
			if (session?.store) await setSetting(session.store.settings, IMAGE_SETTING, record);
		},
		/** The passphrase the books derive for an own image of `plainSha256`, to compare with what a VM got. */
		ownImagePassphrase: async (/** @type {string} */ plainSha256) =>
			(await hostedAleph()).ownImagePassphrase(plainSha256),
		// The books' Aleph key's address (made if there is none yet), for a fake INSTANCE it owns (#585).
		alephAddress: async () => {
			if (!session?.store) return null;
			const { ensureBackupKey } = await import('./backup/keeper.js');
			const { alephAddressOf } = await import('./backup/aleph-signer.js');
			const key = await ensureBackupKey(session.store.settings);
			return key ? alephAddressOf(key) : null;
		},
		// The books' own identity and where their databases are (#496).
		booksDid: () => session?.booksDid,
		addresses: () =>
			session
				? Object.fromEntries(
						Object.entries(session.store.databases()).map(([name, db]) => [
							name,
							String(db.address)
						])
					)
				: null,
		transactions: () => session?.store.transactions.list(),
		// Every protocol this device's node answers to, for the stranger spec (#537):
		// it tries each one without the device proof.
		protocols: () => session?.libp2p?.getProtocols?.() ?? [],
		// A relay that dropped this device (sleep, another network): every connection to the relays hung up.
		hangUpRelays: async () => {
			const { relayPeerOf } = await import('./sync/first-contact.js');
			const peers = new Set((session?.relays ?? []).map((r) => relayPeerOf(r)).filter(Boolean));
			let closed = 0;
			for (const c of session?.libp2p?.getConnections?.() ?? []) {
				if (peers.has(c.remotePeer.toString())) {
					closed++;
					await c.close().catch(() => {});
				}
			}
			return { closed, relays: [...peers] };
		},
		// A backup's bytes, and putting them back, without Aleph (#628).
		backupBytes: async () => {
			const built = await session?.makeBackup({ appVersion: 'e2e' });
			return built ? Array.from(built.sealed) : null;
		},
		restoreBytes: async (/** @type {number[]} */ bytes) => {
			const done = await session?.restoreBackup(new Uint8Array(bytes));
			return done ? { target: done.target, databases: done.databases } : null;
		},
		// A made-up receipt, as reading one would leave it (instalments spec, #258).
		addReceipt: (/** @type {Record<string, any>} */ r) => session?.store.receipts.put(r),
		// …and one with its file in the sealed blob store (the receipt preview, #273).
		addReceiptFile: async (/** @type {number[]} */ bytes, /** @type {Record<string, any>} */ r) => {
			const blobs = currentBlobs();
			if (!session || !blobs) return null;
			const fileCid = await blobs.put(new Uint8Array(bytes));
			return session.store.receipts.put({ ...r, fileCid });
		},
		// Whether a receipt's file is whole on this device (receipts/prefetch.js).
		fileHere: (/** @type {string} */ cid) => currentBlobs()?.has(cid) ?? false,
		filesState: () => ({ missing: [...app.files.missing], fetching: [...app.files.fetching] }),
		// Ask the prefetch to look now (receipts/prefetch.js), as unlock does.
		filesCheck: () => currentFilePrefetch()?.run(),
		// The matching over what a test put in (questions, own transfers).
		runMatching: () => runMatchingNow(),
		// A bank account as an import creates it (bank/import.js), for the export spec.
		addAccount: (/** @type {Record<string, any>} */ account) =>
			session?.store.accounts.put(account),
		accounts: () => session?.store.accounts.list(),
		// For the benchmark (app/bench/): made-up books written through the real
		// store, and the app's own read, refresh and matching paths timed in the page.
		bench: {
			/** @param {string} name @param {Record<string, any>[]} records */
			async putMany(name, records) {
				const collection = /** @type {any} */ (session?.store)?.[name];
				const ids = [];
				for (const r of records) ids.push((await collection.put(r)).id);
				return ids;
			},
			/** @param {string} name @param {string} id */
			async get(name, id) {
				return /** @type {any} */ (session?.store)?.[name].get(id);
			},
			/** @param {string} name */
			async count(name) {
				return ((await /** @type {any} */ (session?.store)?.[name].list()) ?? []).length;
			},
			refresh: () => refresh(),
			match: () => runMatchingNow('manual'),
			estimate: () => navigator.storage.estimate(),
			// The sync node's network, for the resilience benchmark: its
			// connections as they are, and what happened since `watchNet()` —
			// connections opened and closed, peers gone, OrbitDB's heads
			// exchanges and sync errors — each with the time.
			connections: () => connectionsOf(session?.libp2p),
			// Whom gossipsub still counts as a peer: it keeps that list itself,
			// and it can forget a peer that libp2p is still connected to.
			pubsubPeers: () =>
				(session?.libp2p?.services?.pubsub?.getPeers?.() ?? []).map((/** @type {any} */ p) =>
					String(p)
				),
			watchNet: () => watchNet(session?.libp2p, session?.store?.databases?.()),
			netlog: () => netlog.slice()
		}
	};
}

/** @type {Array<Record<string, unknown>>} */
const netlog = [];
/** @type {WeakSet<object>} */
const watched = new WeakSet();

/** @param {any} c a libp2p connection */
const describeConnection = (c) => ({
	peer: String(c.remotePeer),
	addr: String(c.remoteAddr),
	// libp2p 3 marks a relayed connection with `limits`; `limited` is the
	// older flag the app's device-sync still reads. Both, to tell them apart.
	limited: c.limited ?? null,
	limits: c.limits ?? null,
	direction: c.direction,
	status: c.status,
	streams: (c.streams ?? []).map((/** @type {any} */ s) => s.protocol ?? '?')
});

/** @param {any} libp2p */
function connectionsOf(libp2p) {
	return (libp2p?.getConnections?.() ?? []).map(describeConnection);
}

/**
 * Start writing the node's network events into `netlog`, once per node and
 * per database. Reading `netlog()` leaves it in place.
 *
 * @param {any} libp2p
 * @param {Record<string, any> | undefined} databases the store's OrbitDB databases by name
 */
function watchNet(libp2p, databases) {
	const note = (/** @type {string} */ event, /** @type {Record<string, unknown>} */ detail) =>
		netlog.push({ t: Date.now(), event, ...detail });
	if (libp2p && !watched.has(libp2p)) {
		watched.add(libp2p);
		libp2p.addEventListener('connection:open', (/** @type {any} */ e) =>
			note('connection:open', describeConnection(e.detail))
		);
		libp2p.addEventListener('connection:close', (/** @type {any} */ e) =>
			note('connection:close', describeConnection(e.detail))
		);
		libp2p.addEventListener('peer:disconnect', (/** @type {any} */ e) =>
			note('peer:disconnect', { peer: String(e.detail) })
		);
	}
	for (const [name, db] of Object.entries(databases ?? {})) {
		if (!db?.events || watched.has(db)) continue;
		watched.add(db);
		db.events.on('join', (/** @type {unknown} */ peer, /** @type {unknown[]} */ heads) =>
			note('orbitdb:join', { db: name, peer: String(peer), heads: heads?.length ?? null })
		);
		db.events.on('leave', (/** @type {unknown} */ peer) =>
			note('orbitdb:leave', { db: name, peer: String(peer) })
		);
		db.events.on('error', (/** @type {any} */ error) =>
			note('orbitdb:error', { db: name, name: error?.name, message: error?.message })
		);
	}
	return netlog.length;
}
