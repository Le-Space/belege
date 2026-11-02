#!/usr/bin/env node
// `pnpm demo`: Belege with made-up books, for a demo or a screen recording.
//
// Starts what the E2E suite uses, never anything real:
//   - a fake Hibiscus with a business account and payments that fit the
//     invoices below (test/support/fake-hibiscus.js);
//   - a fake mailbox with made-up invoices as PDFs, a look-alike phishing mail
//     and a private mail that stays out (test/support/fake-imap.js);
//   - the language model: your local Ollama when it runs and has the model
//     (nothing leaves the computer), else a fake one; `--fake-llm` forces the
//     fake, which answers at once;
//   - the bridge itself in test mode, on its usual port 8765, with a config in
//     a temporary folder – your real bridge.json and keychain are not touched.
//
// Every name, IBAN, amount and invoice is invented. Ctrl+C stops everything
// and deletes the temporary folder.
//
//   pnpm demo                  Ollama if it is there, else the fake model
//   pnpm demo -- --fake-llm    the fake model, instant answers
//   pnpm demo -- --lan         also the relay for own devices in this network
//                              (a phone in the same Wi-Fi, docs/features.md)
//
// DEMO_MODEL names another Ollama model (default qwen3:30b-a3b-instruct-2507-q4_K_M).
// DEMO_PORT moves the bridge off 8765 (then the app has to be told; for trying it out).

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import net from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defaultConfig, saveConfig } from '../src/config.js';
import { FAKE_PASSWORD, startFakeHibiscus } from '../test/support/fake-hibiscus.js';
import {
	ACCOUNTING,
	FAKE_IMAP_PASSWORD,
	RECEIPTS,
	sampleMailbox,
	startFakeImap
} from '../test/support/fake-imap.js';
import { FAKE_LLM_KEY, startFakeLlm } from '../test/support/fake-llm.js';

// The app looks for its bridge here; DEMO_PORT only for trying the demo beside a running bridge.
const PORT = Number(process.env.DEMO_PORT || 8765);
const OLLAMA = 'http://127.0.0.1:11434';
const MODEL = process.env.DEMO_MODEL || 'qwen3:30b-a3b-instruct-2507-q4_K_M';
const CLI = fileURLToPath(new URL('../src/cli.js', import.meta.url));
const args = process.argv.slice(2);

/** Whether something listens on a port of this machine. @param {number} port */
const inUse = (port) =>
	new Promise((resolve) => {
		const socket = net.connect({ host: '127.0.0.1', port }, () => {
			socket.end();
			resolve(true);
		});
		socket.on('error', () => resolve(false));
	});

/** Ollama runs and has the model. */
async function ollamaReady() {
	try {
		const res = await fetch(`${OLLAMA}/api/tags`, { signal: AbortSignal.timeout(2000) });
		const { models = [] } = /** @type {any} */ (await res.json());
		return models.some((/** @type {any} */ m) => m.name === MODEL || m.model === MODEL);
	} catch {
		return false;
	}
}

/** This Mac's address in a private network, for the relay to own devices. */
function lanAddress() {
	for (const list of Object.values(networkInterfaces())) {
		for (const a of list ?? []) {
			if (
				a.family === 'IPv4' &&
				!a.internal &&
				/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)
			) {
				return a.address;
			}
		}
	}
	return null;
}

const iso = (/** @type {Date} */ d) => d.toISOString().slice(0, 10);

/**
 * The business account's payments: one for each invoice in the mailbox, a few
 * days after it, plus what a month has besides – a customer paying, a bank fee,
 * a subscription without a receipt yet. All invented.
 *
 * @param {Date} base the mailbox's newest day
 */
function bankData(base) {
	const day = (/** @type {number} */ n) => iso(new Date(base.getTime() + n * 864e5));
	let id = 500;
	/** @param {string} on @param {string} amount @param {string} name @param {string} purpose @param {string} [kind] */
	const tx = (on, amount, name, purpose, kind = 'Basislastschrift') => ({
		id: ++id,
		konto_id: 1,
		datum: on,
		valuta: on,
		betrag: amount,
		empfaenger_name: name,
		empfaenger_konto: '',
		zweck: purpose,
		zweck_raw: `SVWZ+${purpose}`,
		art: kind,
		endtoendid: 'NOTPROVIDED'
	});
	return {
		accounts: [
			{
				id: 1,
				iban: 'DE00 0000 0000 0000 0047 11',
				bezeichnung: 'Geschäftskonto',
				name: 'Beispiel Studio UG',
				waehrung: 'EUR',
				saldo: '8.412,30',
				saldo_datum: day(0)
			}
		],
		transactions: [
			tx(
				day(0),
				`-${RECEIPTS.wolkenfabrik.gross}`,
				RECEIPTS.wolkenfabrik.vendor,
				`Rechnung ${RECEIPTS.wolkenfabrik.invoice}`
			),
			tx(
				day(-1),
				`-${RECEIPTS.stromwerk.gross}`,
				RECEIPTS.stromwerk.vendor,
				`Vertrag ${RECEIPTS.stromwerk.invoice} Abschlag`
			),
			tx(
				day(-2),
				`-${RECEIPTS.papierladen.gross}`,
				RECEIPTS.papierladen.vendor,
				'Bestellung 2026-555',
				'Kartenzahlung'
			),
			tx(
				day(-3),
				`-${RECEIPTS.buero.gross}`,
				RECEIPTS.buero.vendor,
				'Kundennr 4711',
				'Kartenzahlung'
			),
			tx(day(-4), '2.380,00', 'Kundin Beispiel AG', 'Rechnung 2026-031 Webseite', 'Gutschrift'),
			tx(day(-5), '-4,90', 'Beispielbank', 'Kontofuehrung', 'Entgelt'),
			tx(day(-6), '-12,00', 'Softwareabo Muster Ltd', 'Abo Oktober')
		]
	};
}

if (await inUse(PORT)) {
	console.error(
		`Port ${PORT} is in use – is your own bridge running? Stop it first (Ctrl+C in its terminal): the demo bridge takes its place, so the app finds it without changes.`
	);
	process.exit(1);
}

const useOllama = !args.includes('--fake-llm') && (await ollamaReady());
const base = new Date(Date.now() - 3 * 864e5);
const hibiscus = await startFakeHibiscus({ data: bankData(base) });
const imap = await startFakeImap({ storage: sampleMailbox({ base, invitation: true }) });
const llm = useOllama ? null : await startFakeLlm();
const dir = await mkdtemp(join(tmpdir(), 'belege-demo-'));
const configPath = join(dir, 'bridge.json');
const lan = args.includes('--lan') ? lanAddress() : null;

await saveConfig(
	{
		...defaultConfig(),
		bridge: { port: PORT },
		hibiscus: {
			host: hibiscus.host,
			port: hibiscus.port,
			certSha256: hibiscus.fingerprint,
			ibanSuffixes: ['4711']
		},
		mail: {
			...defaultConfig().mail,
			host: imap.host,
			port: imap.port,
			user: imap.user,
			tls: 'none',
			accountingAddress: ACCOUNTING
		},
		llm: {
			...defaultConfig().llm,
			...(useOllama
				? { baseUrl: `${OLLAMA}/v1`, model: MODEL, retryModel: MODEL, redaction: 'off' }
				: { baseUrl: /** @type {any} */ (llm).url, redaction: 'on' }),
			configured: true
		},
		...(lan ? { lanRelay: { host: lan, port: 4990 } } : {})
	},
	configPath
);

const bridge = spawn(process.execPath, [CLI, '--test-mode', '--config', configPath], {
	env: {
		...process.env,
		BELEGE_BRIDGE_TEST_PASSWORD: FAKE_PASSWORD,
		BELEGE_BRIDGE_TEST_IMAP_PASSWORD: FAKE_IMAP_PASSWORD,
		BELEGE_BRIDGE_TEST_LLM_KEY: useOllama ? 'ollama' : FAKE_LLM_KEY
	},
	stdio: ['ignore', 'inherit', 'inherit']
});

console.log(`
  Belege demo – made-up books, nothing real
  ─────────────────────────────────────────
  Bridge     http://127.0.0.1:${PORT} (test mode, config in ${dir})
  Bank       fake Hibiscus: "Geschäftskonto" …4711, ${bankData(base).transactions.length} payments
  Mailbox    fake IMAP: invoices as PDFs to ${ACCOUNTING}, a phishing look-alike, a private mail, an invitation
  AI         ${useOllama ? `Ollama ${MODEL} on this computer – nothing leaves it` : 'fake model (instant answers)'}
  ${lan ? `Devices    relay for own devices on ${lan}:4990` : 'Devices    no LAN relay (add -- --lan for a phone in this Wi-Fi)'}

  1. Open Belege in a fresh browser profile and create a demo passkey.
  2. Integrationen → Bridge: the pairing code below.
  3. Bank → Jetzt synchronisieren; Belege → E-Mails abrufen; Alle neuen auslesen.

  Ctrl+C stops the demo and deletes the temporary folder.
`);

let stopping = false;
async function stop() {
	if (stopping) return;
	stopping = true;
	if (bridge.exitCode === null) {
		const exited = new Promise((resolve) => bridge.once('exit', resolve));
		bridge.kill('SIGTERM');
		await exited;
	}
	await llm?.close();
	await imap.close();
	await hibiscus.close();
	await rm(dir, { recursive: true, force: true });
	process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
bridge.on('exit', (code) => {
	if (!stopping) {
		console.error(`The bridge stopped (${code}).`);
		stop();
	}
});
