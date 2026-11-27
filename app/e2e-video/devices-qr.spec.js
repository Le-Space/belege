// Working on through a cloud outage (#961): three devices of one company –
// a laptop, a phone and an office laptop – each with a passkey of its own,
// joined by QR code, on one stage. No host beyond this machine answers: every
// request beyond it is aborted, and the scene fails if one was made. The
// laptop holds the bridge and its model; the phone asks it for an account,
// the office laptop assigns a receipt, and the laptop sees both at once.
//
// The steps come from e2e/device-own-passkey.spec.js and
// e2e/device-outage-work.spec.js; the stage (three recordings in one frame,
// one voice) from @le-space/video-kit/stage. Sample data only: "Beispieldaten"
// and one made-up payment.
//
//   DEMO_VOICE=say DEMO_LANG=de pnpm video e2e-video/devices-qr.spec.js   # a dry run
//   DEMO_MODEL=ollama …   the laptop's bridge asks Ollama on this machine
//                          (docs/ollama.md) instead of the test stub
import { test, expect } from '@playwright/test';
import { defaultConfig } from '@belege/bridge';
import { FAKE_LLM_KEY, startFakeLlm } from '@belege/bridge/testing/llm';
import { startStage } from '@le-space/video-kit/stage';
import { acceptConsent } from '../e2e/consent.js';
import { equip, prfOf } from '../e2e/devices.js';
import { startBridge } from '../e2e/bridge-process.js';
import { SKR03_ACCOUNTS } from '../src/lib/booking/skr03.js';
import { BRAND, NIGHT, voice } from './belege.js';

const LANG = process.env.DEMO_LANG === 'de' ? 'de' : 'en';
const OLLAMA = process.env.DEMO_MODEL === 'ollama';
const BRIDGE_PORT = Number(process.env.E2E_BRIDGE_PORT || 4392);

const EN = {
	intro:
		'The cloud is down. With Le Space Belege, work goes on: the books sit on no server, so no one there can read them or leak them.',
	passkey:
		'On the laptop: the books, made with a passkey and filled with sample payments and receipts, and a chart of accounts with one for hosting. The books exist only in this browser.',
	bridge: OLLAMA
		? 'Beside it runs the laptop’s bridge, with a language model on the laptop itself. The laptop shares it with its own devices.'
		: 'Beside it runs the laptop’s bridge, with its language model. The laptop shares it with its own devices.',
	outage:
		'Now the internet goes away. No cloud, no relay. In the network menu: without a relay, by QR. The devices talk peer to peer, over their own Wi-Fi.',
	phone: 'The phone makes a passkey of its own and scans the laptop’s QR code.',
	compare: 'Both screens show the same code. The laptop lets the phone in, and hands it the vault.',
	phoneBooks:
		'The payments and receipts come to the phone peer to peer, with no server in between.',
	office: 'The office laptop, the same way, with a third passkey.',
	ask: 'On the phone, a payment without an account. The phone asks the laptop’s model for one, through the laptop.',
	take: 'The suggestion goes into the field, and the account is booked.',
	laptopSees:
		'On the laptop, the payment has its account at once – it came peer to peer from the phone – and leaves the list without one.',
	receipt:
		'In the office, a payment that has no receipt yet. The office laptop assigns the invoice.',
	matched: 'And the laptop shows the match.',
	keys: 'Three passkeys in one vault. If one device is lost, the others still have everything, without a backup in a cloud.',
	proof: 'Every request of the three browsers stayed on this machine.',
	outro: 'When the cloud fails, work goes on.'
};

const DE = {
	intro:
		'Die Cloud fällt aus. Mit Le Space Belege geht die Arbeit weiter: Die Geschäftsbücher liegen auf keinem Server, also kann dort auch niemand mitlesen oder sie abgreifen.',
	passkey:
		'Auf dem Laptop: die Geschäftsbücher, mit einem Passkey angelegt, mit Beispielzahlungen und -belegen und einem Kontenplan mit eigenem Konto für Hosting. Es gibt sie nur in diesem Browser.',
	bridge: OLLAMA
		? 'Daneben läuft die Bridge des Laptops, mit einem Sprachmodell auf dem Laptop selbst. Der Laptop gibt sie für seine eigenen Geräte frei.'
		: 'Daneben läuft die Bridge des Laptops, mit ihrem Sprachmodell. Der Laptop gibt sie für seine eigenen Geräte frei.',
	outage:
		'Jetzt fällt das Internet aus. Keine Cloud, kein Relay. Im Netzwerk-Menü: ohne Relay, per QR. Die Geräte sprechen Peer-to-Peer miteinander, über das eigene WLAN.',
	phone: 'Das Telefon legt einen eigenen Passkey an und scannt den QR-Code des Laptops.',
	compare:
		'Beide Bildschirme zeigen denselben Code. Der Laptop lässt das Telefon zu und übergibt ihm den Tresor.',
	phoneBooks: 'Zahlungen und Belege kommen Peer-to-Peer aufs Telefon, ohne Server dazwischen.',
	office: 'Der Büro-Laptop genauso, mit einem dritten Passkey.',
	ask: 'Auf dem Telefon eine Zahlung ohne Konto. Das Telefon fragt das Sprachmodell des Laptops, über den Laptop.',
	take: 'Der Vorschlag kommt ins Feld, und das Konto ist gebucht.',
	laptopSees:
		'Auf dem Laptop hat die Zahlung sofort ihr Konto – es kam Peer-to-Peer vom Telefon – und verschwindet aus der Liste ohne Konto.',
	receipt:
		'Im Büro eine Zahlung, die noch keinen Beleg hat. Der Büro-Laptop ordnet die Rechnung zu.',
	matched: 'Und der Laptop zeigt die Zuordnung.',
	keys: 'Drei Passkeys in einem Tresor. Geht ein Gerät verloren, haben die anderen noch alles, ohne Backup in einer Cloud.',
	proof: 'Jede Anfrage der drei Browser blieb auf diesem Rechner.',
	outro: 'Wenn die Cloud ausfällt, geht die Arbeit weiter.'
};

const LINES = LANG === 'de' ? DE : EN;
/** Nothing on screen names Aleph: the film shows work without any host. @param {import('@playwright/test').Page} page */
const noAleph = (page) =>
	expect
		.poll(() =>
			page.evaluate(() => document.body.innerText.split('\n').filter((l) => /aleph/i.test(l)))
		)
		.toEqual([]);
/**
 * The chart the laptop reads in: the app's SKR 03 list and an account of the
 * company's own for hosting (made up). The model is to pick that one; any
 * other suggestion fails the recording, which is then made again.
 */
const HOSTING = {
	number: '4929',
	name: LANG === 'de' ? 'Hosting und Server' : 'Hosting and servers'
};
const CHART_CSV = [
	'Konto;Bezeichnung',
	...[...SKR03_ACCOUNTS, HOSTING].map((a) => `${a.number};${a.name}`)
].join('\n');
const W =
	LANG === 'de'
		? {
				laptop: 'Laptop',
				phone: 'Telefon',
				office: 'Büro-Laptop',
				internetOff: 'Internet: aus',
				create: 'Passkey anlegen',
				pair: 'Koppeln',
				tabs: { payments: 'Zahlungen', integrations: 'Integrationen' },
				hosts: 'Angefragte Hosts',
				chapters: [
					'Ein Laptop, eine Bridge',
					'Das Internet fällt aus',
					'Neue Geräte per QR',
					'KI über den Laptop',
					'Beleg im Büro zugeordnet',
					'Drei Passkeys, ein Tresor',
					'Nichts verließ den Rechner'
				]
			}
		: {
				laptop: 'Laptop',
				phone: 'Phone',
				office: 'Office laptop',
				internetOff: 'Internet: off',
				create: 'Create passkey',
				pair: 'Pair',
				tabs: { payments: 'Payments', integrations: 'Integrations' },
				hosts: 'Hosts asked',
				chapters: [
					'One laptop, one bridge',
					'The internet goes down',
					'New devices by QR',
					'AI through the laptop',
					'A receipt matched in the office',
					'Three passkeys, one vault',
					'Nothing left this machine'
				]
			};
/** The chapter, top left, numbered. @param {any} stage @param {number} n */
const chapter = (stage, n) => stage.chapter(W.chapters[n - 1], { n });

/** @type {Awaited<ReturnType<typeof startFakeLlm>> | null} */ let llm = null;
/** @type {import('../e2e/bridge-process.js').StartedBridge} */ let bridge;

test.beforeAll(async () => {
	let llmConfig;
	if (OLLAMA) {
		// The bridge's default since 2026-11-16: Ollama on this machine
		// (bridge/src/config.js), with the model this machine has pulled
		// (DEMO_OLLAMA_MODEL); setup:llm told it runs here, so nothing is blacked out.
		const model = process.env.DEMO_OLLAMA_MODEL || defaultConfig().llm.model;
		llmConfig = {
			...defaultConfig().llm,
			model,
			retryModel: model,
			redaction: 'off',
			configured: true
		};
		// Loaded before the recording: a cold model on a laptop's CPU may take
		// longer than a call through another device may wait (60 s).
		await fetch(`${llmConfig.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ model, messages: [{ role: 'user', content: 'OK' }], max_tokens: 1 })
		});
	} else {
		llm = await startFakeLlm();
		llm.answers.respond = (body) =>
			String(body.messages?.[0]?.content ?? '').includes('contra account (Gegenkonto)')
				? {
						picks: [
							{
								account: HOSTING.number,
								confidence: 'high',
								reason: LANG === 'de' ? 'Monatliches Hosting.' : 'Monthly hosting.'
							}
						]
					}
				: undefined;
		llmConfig = {
			...defaultConfig().llm,
			model: 'deepseek-flash',
			retryModel: 'deepseek-v4-pro',
			baseUrl: llm.url,
			configured: true
		};
	}
	bridge = await startBridge({
		name: 'devices-film',
		config: { llm: llmConfig },
		env: OLLAMA ? {} : { BELEGE_BRIDGE_TEST_LLM_KEY: FAKE_LLM_KEY }
	});
});

test.afterAll(async () => {
	await bridge?.stop();
	await llm?.close();
});

// As playwright.config.js: without a media permission Chromium offers only the
// default route's address, and behind a VPN the devices never connect. The app
// never asks for a microphone. The locale as the recording's (DEMO_LANG).
const CONTEXT = {
	permissions: ['microphone'],
	locale: LANG === 'de' ? 'de-DE' : 'en-GB'
};
// What each device says it is: the device list names them by it.
const MAC =
	'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
const ANDROID =
	'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';

/** This machine: the page and the laptop's bridge (and its model). @param {string} url */
const local = (url) =>
	/^(data|blob|about):/.test(url) || ['localhost', '127.0.0.1'].includes(new URL(url).hostname);

test('through a cloud outage: three devices, three passkeys, one vault by QR', async ({
	browser
}, testInfo) => {
	test.setTimeout(900_000);
	const stage = await startStage(browser, testInfo, LINES, {
		voice,
		lang: LANG,
		night: NIGHT,
		accent: BRAND.palette.accent,
		font: BRAND.font,
		devices: {
			laptop: {
				label: W.laptop,
				x: 40,
				y: 130,
				width: 900,
				height: 820,
				zoom: 1,
				context: { ...CONTEXT, userAgent: MAC }
			},
			phone: {
				label: W.phone,
				x: 980,
				y: 130,
				width: 380,
				height: 820,
				zoom: 1,
				context: { ...CONTEXT, userAgent: ANDROID }
			},
			office: {
				label: W.office,
				x: 1400,
				y: 130,
				width: 480,
				height: 820,
				zoom: 0.8,
				context: { ...CONTEXT, userAgent: MAC }
			}
		}
	});
	/** @type {string[]} */
	const outside = [];
	/** @type {Set<string>} */
	const asked = new Set();
	/** @type {Record<string, Awaited<ReturnType<typeof equip>>>} */
	const d = {};
	for (const [name, n] of /** @type {const} */ ([
		['laptop', 6],
		['phone', 7],
		['office', 8]
	])) {
		const { context, page } = stage.devices[name];
		d[name] = await equip(context, page, { mode: 'qr', prf: prfOf(n) });
		// The camera reads a code once, as a real one does: QrScan may ask the
		// detector again before it stops, and one invite must give one answer.
		await context.addInitScript(() => {
			const Detector = /** @type {any} */ (globalThis).BarcodeDetector;
			/** @type {any} */ (globalThis).BarcodeDetector = class extends Detector {
				async detect() {
					const found = await super.detect();
					if (found.length) /** @type {any} */ (globalThis).__scanValue = '';
					return found;
				}
			};
		});
		// The film is about working without any host: the keys page's Aleph
		// texts (hinterlegen, andere Bücher, neue Schlüssel, the technical note) are
		// left out of the picture. Through the CSSOM, element by element: the app's
		// CSP refuses an inline stylesheet.
		await context.addInitScript(() => {
			const HIDE =
				'label:has([data-testid="keys-publish"]), label:has([data-testid="words-publish"]), [data-testid="keys-not-published"], [data-testid="keys-lost"], [data-testid="keys-other"], [data-testid="keys-rekey"], [data-testid="keys-doc"] ~ *';
			const hide = () => {
				for (const el of /** @type {NodeListOf<HTMLElement>} */ (document.querySelectorAll(HIDE)))
					el.style.setProperty('display', 'none', 'important');
			};
			const watch = () => {
				hide();
				new MutationObserver(hide).observe(document.body, { childList: true, subtree: true });
			};
			if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watch);
			else watch();
		});
		page.on('pageerror', (e) => console.log(`[${name}] pageerror ${e.message}`));
		if (process.env.DEMO_DEBUG)
			page.on('console', (m) => console.log(`[${name}] ${m.type()} ${m.text()}`.slice(0, 400)));
		// The outage, for real: nothing beyond this machine is reached.
		await context.route(
			(url) => !local(url.href),
			(route) => {
				outside.push(route.request().url());
				return route.abort('internetdisconnected');
			}
		);
		context.on('request', (r) => {
			if (/^https?:/.test(r.url())) asked.add(new URL(r.url()).host);
		});
		page.on('websocket', (ws) => {
			if (!local(ws.url())) outside.push(`websocket ${ws.url()}`);
		});
	}
	const { laptop, phone, office } = d;
	// The laptop shares its bridge with its own devices (Erweitert → the checkbox).
	await laptop.context.addInitScript(() => localStorage.setItem('belege.bridge-share', 'on'));
	// The phone and the office laptop are other machines: the laptop's 127.0.0.1
	// – its bridge and the bridge's node – is out of their reach.
	for (const other of [phone, office]) {
		await other.context.route(`http://127.0.0.1:${BRIDGE_PORT}/**`, (r) =>
			r.abort('connectionrefused')
		);
		await other.context.routeWebSocket(
			(url) => url.hostname === '127.0.0.1',
			(ws) => ws.close()
		);
	}
	/** @param {import('@playwright/test').Page} page @param {string} name */
	const tab = (page, name) =>
		stage.click(page, page.getByRole('link', { name, exact: true }).first());
	/** @param {import('@playwright/test').Page} page @param {string} name */
	const row = async (page, name) => {
		// The list shows one month at a time; the sample's payments are in the month before.
		await stage.type(page, page.getByTestId('transaction-search'), name);
		return page.getByTestId('transaction').filter({ hasText: name }).first();
	};

	// A person's pace, not a machine's: a look before each click, a moment after
	// it, and slower typing.
	const machineClick = stage.click;
	const machineType = stage.type;
	stage.click = async (page, locator, o) => {
		await page.waitForTimeout(500);
		return machineClick(page, locator, { settle: 900, ...o });
	};
	stage.type = async (page, locator, text, o) => {
		await page.waitForTimeout(400);
		return machineType(page, locator, text, { delay: 80, ...o });
	};

	try {
		// Before the film starts: the laptop's books – a passkey, the sample data,
		// the chart with the hosting account – and its bridge, paired by code.
		await laptop.page.goto('/');
		await phone.page.goto('/');
		await office.page.goto('/');
		await acceptConsent(laptop.page);
		await laptop.page.getByTestId('passkey-label').fill(W.laptop);
		await laptop.page.getByRole('button', { name: W.create }).click();
		await expect(laptop.page.getByTestId('own-did')).toBeVisible();
		await laptop.page.getByTestId('setup-start-ack').check();
		await laptop.page.getByTestId('setup-start-look').click();
		await expect(laptop.page.getByTestId('sample-banner')).toBeVisible({ timeout: 60_000 });
		// A payment that waits for its receipt: the sample's Stromwerk invoice,
		// paid later than it was issued (made up).
		await laptop.page.evaluate(() => {
			const day = new Date();
			day.setDate(day.getDate() - 2);
			return /** @type {any} */ (window).__belegeE2E.addTransaction({
				bookedOn: day.toISOString().slice(0, 10),
				counterparty: 'Stromwerk Test AG',
				purpose: 'Abschlag Strom Büro',
				amountCents: -4500,
				currency: 'EUR',
				sample: true
			});
		});
		await laptop.page.getByTestId('settings-link').click();
		await laptop.page.getByTestId('settings-tile-kontenplan').click();
		const chart = laptop.page.getByTestId('chart');
		await chart.getByTestId('chart-file').setInputFiles({
			name: 'kontenplan.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(CHART_CSV)
		});
		await chart.getByTestId('chart-take').click();
		await expect(chart.getByTestId('chart-current')).toContainText(`${SKR03_ACCOUNTS.length + 1}`);
		await laptop.page.getByRole('link', { name: W.tabs.integrations, exact: true }).first().click();
		await laptop.page.getByTestId('pairing-code').fill(bridge.code());
		await laptop.page.getByRole('button', { name: W.pair, exact: true }).click();
		await expect(laptop.page.getByTestId('bridge-status')).toHaveAttribute('data-paired', 'true');
		await laptop.page.getByRole('link', { name: W.tabs.payments, exact: true }).first().click();
		await laptop.page.getByTestId('filter-all').click();
		await expect(laptop.page.getByTestId('transaction').first()).toBeVisible();

		// The phone and the office laptop, ready to join with a passkey of their own.
		for (const [dev, label] of /** @type {const} */ ([
			[phone, W.phone],
			[office, W.office]
		])) {
			await acceptConsent(dev.page);
			await dev.page.getByTestId('own-join-open').locator('summary').click();
			await dev.page.getByTestId('own-join-label').fill(label);
		}

		// The film.
		stage.markStart();
		await stage.focus('laptop');
		await stage.say(LINES.intro);
		await chapter(stage, 1);
		await stage.sayWhile(LINES.passkey, async () => {
			const month = laptop.page.getByTestId('transaction-month').nth(1);
			if (await month.isVisible()) await stage.click(laptop.page, month);
		});
		await stage.sayWhile(LINES.bridge, async () => {
			await tab(laptop.page, W.tabs.integrations);
			await stage.click(laptop.page, laptop.page.getByTestId('integration-geraete').first());
			const advanced = laptop.page.getByTestId('devices-advanced');
			if (!(await advanced.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open)))
				await stage.click(laptop.page, advanced.locator('summary').first());
			const share = laptop.page.getByTestId('devices-bridge-share');
			await share.scrollIntoViewIfNeeded();
			await expect(share).toBeChecked();
			await expect(laptop.page.getByTestId('devices-bridge-served')).toBeVisible({
				timeout: 30_000
			});
		});

		// The outage.
		await chapter(stage, 2);
		await stage.note('net', W.internetOff, { kind: 'warn' });
		await stage.sayWhile(LINES.outage, async () => {
			await stage.click(laptop.page, laptop.page.getByTestId('local-only'));
			await expect(laptop.page.getByTestId('network-mode-qr')).toBeChecked();
			await noAleph(laptop.page);
		});
		await laptop.page.keyboard.press('Escape');

		// The phone: its own passkey, the laptop's QR code.
		await stage.focus('laptop', 'phone');
		await chapter(stage, 3);
		await join(phone, LINES.phone, LINES.compare);
		await stage.sayWhile(LINES.phoneBooks, async () => {
			await expect(phone.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 });
			await tab(phone.page, W.tabs.payments);
			await expect(phone.page.getByTestId('transaction').first()).toBeVisible({
				timeout: 90_000
			});
		});

		// The office laptop, with a third passkey. Meanwhile the phone finds the
		// laptop's bridge (its card asks again until the route through the laptop is up).
		await stage.focus('laptop', 'office');
		const phoneReady = (async () => {
			await phone.page
				.getByRole('link', { name: W.tabs.integrations, exact: true })
				.first()
				.click();
			const status = phone.page.getByTestId('bridge-status');
			await expect(status).toHaveAttribute('data-paired', 'true', { timeout: 180_000 });
			await expect
				.poll(
					async () => {
						const state = await status.getAttribute('data-state');
						if (state === 'offline') await phone.page.getByTestId('bridge-check').click();
						return state;
					},
					{ timeout: 120_000, intervals: [2_000] }
				)
				.toBe('online');
			await phone.page.getByRole('link', { name: W.tabs.payments, exact: true }).first().click();
		})();
		await join(office, LINES.office);
		// The office laptop opening its vault is a wait, too.
		await stage.cutWhile(() =>
			expect(office.page.getByTestId('own-did')).toBeVisible({ timeout: 60_000 })
		);
		// What the phone still waits for is left out of the film.
		await stage.cutWhile(() => phoneReady);
		await tab(laptop.page, W.tabs.payments);
		await laptop.page.getByTestId('filter-without-account').click();
		const before = await withoutAccount(laptop.page);

		// The phone asks the laptop's model, through the laptop.
		await stage.focus('phone');
		const booking = phone.page.getByTestId('tx-booking');
		await chapter(stage, 4);
		await stage.sayWhile(LINES.ask, async () => {
			await stage.click(phone.page, phone.page.getByTestId('filter-without-account'));
			await stage.click(phone.page, await row(phone.page, 'Wolkenfabrik Hosting GmbH'));
			await booking.getByTestId('tx-booking-ai-ask').scrollIntoViewIfNeeded();
			await stage.click(phone.page, booking.getByTestId('tx-booking-ai-ask'));
		});
		const picks = booking.getByTestId('tx-booking-ai-picks');
		// The model takes a while on a laptop's CPU: the wait is left out of the film.
		await stage.cutWhile(() => expect(picks).toBeVisible({ timeout: 120_000 }));
		// A suggestion other than the hosting account fails the recording: record again.
		const pick = String(await picks.locator('[data-account]').first().getAttribute('data-account'));
		if (pick !== HOSTING.number)
			throw new Error(`the model suggested ${pick}, not ${HOSTING.number}: record again`);
		await stage.sayWhile(LINES.take, async () => {
			await stage.click(phone.page, booking.getByTestId('tx-booking-ai-take').first());
			await stage.click(phone.page, booking.getByTestId('tx-booking-confirm'));
			await expect(booking).toHaveAttribute('data-confirmed', 'true');
		});
		await stage.click(phone.page, phone.page.getByTestId('tx-detail-close'));

		// The laptop sees it.
		await stage.focus('laptop');
		await expect.poll(() => withoutAccount(laptop.page), { timeout: 90_000 }).toBe(before - 1);
		await stage.sayWhile(LINES.laptopSees, async () => {
			await stage.click(laptop.page, laptop.page.getByTestId('filter-all'));
			await stage.click(laptop.page, await row(laptop.page, 'Wolkenfabrik Hosting GmbH'));
			await expect(laptop.page.getByTestId('tx-booking')).toHaveAttribute('data-confirmed', 'true');
			await laptop.page.getByTestId('tx-booking').scrollIntoViewIfNeeded();
		});
		await stage.click(laptop.page, laptop.page.getByTestId('tx-detail-close'));

		// The office laptop assigns the Stromwerk invoice.
		await stage.focus('office');
		const detail = office.page.getByTestId('tx-detail');
		await chapter(stage, 5);
		await stage.sayWhile(LINES.receipt, async () => {
			await tab(office.page, W.tabs.payments);
			await stage.click(office.page, office.page.getByTestId('filter-all'));
			await stage.click(office.page, await row(office.page, 'Stromwerk Test AG'));
			await expect(detail.getByTestId('tx-detail-missing')).toBeVisible();
			const choice = detail
				.getByTestId('tx-choice')
				.filter({ hasText: 'Stromwerk Test AG' })
				.first()
				.getByTestId('tx-choose');
			await choice.scrollIntoViewIfNeeded();
			await stage.click(office.page, choice);
			await expect(detail.getByTestId('tx-linked-vendor')).toHaveText('Stromwerk Test AG');
		});

		await stage.focus('laptop');
		await stage.sayWhile(LINES.matched, async () => {
			await stage.click(laptop.page, await row(laptop.page, 'Stromwerk Test AG'));
			await expect(laptop.page.getByTestId('tx-linked-vendor')).toHaveText('Stromwerk Test AG', {
				timeout: 90_000
			});
			await laptop.page.getByTestId('tx-linked-receipt').scrollIntoViewIfNeeded();
		});
		await stage.click(office.page, detail.getByTestId('tx-detail-close'));
		await stage.click(laptop.page, laptop.page.getByTestId('tx-detail-close'));

		// Three passkeys in one vault, on every device – inside the app: a reload
		// would end the QR connections (they are made anew after one).
		await stage.focus('laptop', 'phone', 'office');
		await chapter(stage, 6);
		await stage.sayWhile(LINES.keys, () =>
			Promise.all(
				[laptop, phone, office].map(async (dev) => {
					await stage.click(dev.page, dev.page.getByTestId('settings-link'));
					await stage.click(dev.page, dev.page.getByTestId('settings-tile-schluessel'));
					await expect(dev.page.getByTestId('keys-slot')).toHaveCount(3, { timeout: 90_000 });
					await noAleph(dev.page);
				})
			)
		);

		// The proof: what the three browsers asked.
		expect(outside).toEqual([]);
		await chapter(stage, 7);
		// A note, top right: an overlay would lie under the devices' videos.
		const hosts = [...new Set([...asked].map((h) => new URL(`http://${h}`).hostname))].sort();
		await stage.note('hosts', `${W.hosts}: ${hosts.join(' · ')}`, { kind: 'ok' });
		await stage.say(LINES.proof);
		await stage.chapter(null);
		await stage.say(LINES.outro);
	} finally {
		await stage.finish();
	}

	/**
	 * A device with its own passkey joins: it scans the laptop's invite, the
	 * laptop scans its answer, both show the same code, the laptop lets it in.
	 * @param {typeof phone} dev @param {string} line
	 * @param {string} [compare] said while both screens show the code
	 */
	async function join(dev, line, compare) {
		const invite = laptop.page.getByTestId('devices-qr-code');
		await stage.sayWhile(line, async () => {
			// Its own passkey (the name typed before the film started).
			await stage.click(dev.page, dev.page.getByTestId('own-join-start'));
			await expect(dev.page.getByTestId('own-join-scan')).toBeVisible({ timeout: 30_000 });
			// The laptop's invite, under Eigene Geräte → Erweitert.
			if (!(await laptop.page.getByTestId('devices-qr-invite').isVisible())) {
				await tab(laptop.page, W.tabs.integrations);
				await stage.click(laptop.page, laptop.page.getByTestId('integration-geraete'));
			}
			const advanced = laptop.page.getByTestId('devices-advanced');
			if (!(await advanced.evaluate((el) => /** @type {HTMLDetailsElement} */ (el).open)))
				await stage.click(laptop.page, advanced.locator('summary').first());
			await stage.click(laptop.page, laptop.page.getByTestId('devices-qr-invite'));
			await expect(invite).toHaveAttribute('data-phase', 'invite', { timeout: 30_000 });
			await invite.scrollIntoViewIfNeeded();
			await stage.click(dev.page, dev.page.getByTestId('own-join-scan'));
			await dev.page.evaluate(
				(c) => {
					/** @type {any} */ (globalThis).__scanValue = c;
				},
				String(await invite.getAttribute('data-code'))
			);
		});
		const answer = dev.page.getByTestId('own-join-code');
		await expect(answer).toBeVisible({ timeout: 30_000 });
		// The laptop takes the answer (pasted here, as the browser spec does).
		await laptop.page
			.getByTestId('devices-qr-paste')
			.fill(String(await answer.getAttribute('data-code')));
		await stage.click(laptop.page, laptop.page.getByTestId('devices-qr-use'));
		const dialog = laptop.page.getByTestId('handover-dialog');
		// The two devices connecting is a wait the film leaves out.
		await stage
			.cutWhile(() => expect(dialog).toBeVisible({ timeout: 30_000 }))
			.catch(async (e) => {
				if (process.env.DEMO_DEBUG) {
					console.log(
						'DEBUG laptop qr:',
						await laptop.page.getByTestId('devices-qr-mode').innerText()
					);
					console.log('DEBUG phone join:', await dev.page.getByTestId('own-join').innerText());
				}
				throw e;
			});
		if (compare) await stage.say(compare);
		else await stage.beat(800);
		await stage.click(laptop.page, laptop.page.getByTestId('handover-allow'));
		await expect(dialog).toBeHidden();
	}
});

/** The count in "Ohne Konto (n)". @param {import('@playwright/test').Page} page */
async function withoutAccount(page) {
	const text = String(await page.getByTestId('filter-without-account').textContent());
	return Number(/\((\d+)\)/.exec(text)?.[1]);
}
