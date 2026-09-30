// English (issue #192): the same keys as de.js, in the same order. A key
// missing here shows in German; the language switch is offered only once
// none is missing. Documents for German bookkeeping stay German (tDocument).
export default {
	app: {
		name: 'Le Space Belege',
		maker: 'Le Space',
		product: 'Belege',
		tagline: 'Payments and receipts, only on this device'
	},
	nav: {
		label: 'Main navigation',
		home: 'Home',
		zahlungen: 'Payments',
		belege: 'Receipts',
		export: 'Export',
		integrationen: 'Integrations'
	},
	header: {
		did: 'Your DID (the public key of your passkey)',
		localOnly: 'This device only',
		localOnlyTitle: 'Network off: no peer-to-peer, no relay, no server. More …',
		network: {
			both: 'Online: devices + invoice app',
			only: { devices: 'Online: own devices', 'invoice-app': 'Online: invoice app' },
			title: 'Network on – via a Le-Space relay (TLS WebSocket), end-to-end encrypted:',
			part: {
				devices: {
					connecting: '• Own devices: connecting …',
					online: '• Own devices: online, no device connected',
					connected: '• Own devices: {count} connected',
					failed: '• Own devices: error – {error}'
				},
				'invoice-app': {
					connecting: '• Invoice app: connecting …',
					online: '• Invoice app: online, not paired',
					connected: '• Invoice app: paired',
					failed: '• Invoice app: error – {error}'
				}
			},
			more: 'Who sees what …',
			menu: 'Network',
			paused: 'Network paused',
			pausedTitle: 'Network paused: no connection, not even at the next unlock – until you resume.',
			pausedShort: 'paused',
			pause: 'Pause everything',
			resume: 'Resume',
			locked: 'Once unlocked, you can switch connections on and off here.',
			devices: 'Own devices',
			app: 'Invoice app',
			off: 'off',
			switchOff: 'Off',
			switchOn: 'On',
			switchOnFirst: 'Switch on …',
			setUp: 'Set up …',
			reloadNeeded:
				'Devices go online at the next unlock – the node was offline when you unlocked.',
			reload: 'Reload and unlock now',
			mode: 'Where devices meet',
			modes: {
				public: 'Public (Le-Space relays)',
				qr: 'Without a relay, by QR',
				lan: 'Only on your own network (relay in your bridge)',
				both: 'Both: new devices only on your own network or by QR, then anywhere'
			},
			modeHints: {
				public: 'Anywhere; the relay sees IP addresses and times, never the content.',
				qr: 'No relay, no server: both devices on the same network, and swap codes once after every reload.',
				lan: 'Devices meet at your bridge’s relay, only on the same network; no public relay, no STUN.',
				both: 'A device the books do not know yet only gets in by QR or via your bridge’s relay; known devices also via the public relays.'
			},
			lanUnavailable:
				'First run `pnpm setup:relay` on the computer with the bridge, restart the bridge and pair here.',
			modePending: 'Applies to all devices of these books, here from the next unlock.'
		},
		localFirst: 'Le Space: the local-first stack behind this app'
	},
	assets: {
		sources: {
			coingecko: 'CoinGecko',
			kraken: 'Kraken',
			ecb: 'ECB reference rate',
			trade: 'Price of the trade',
			dex: 'DEX pool',
			migration: 'Value of the burnt old tokens',
			manual: 'entered by hand'
		},
		valuationLine: '{rate} EUR per {asset} · {source}{when}'
	},
	setup: {
		title: 'Setup',
		intro: 'Step by step to the first month in the export. Belege sees for itself what is done.',
		progress: '{done} of {total} done',
		now: 'Now',
		later: 'Later',
		resume: 'Take up again',
		state: { done: 'done', open: 'open', later: 'later' },
		optional: 'optional',
		needs: { bridge: 'needs the bridge', terminal: 'in the terminal' },
		laterTitle: 'For later ({count})',
		finished: 'Everything needed is set up or put off for later.',
		settingsHint: 'The setup leaves Home once nothing is open; here it stays.',
		start: {
			title: 'How do you want to start?',
			intro:
				'You can change the choice while the books are still empty. Everything can be set up later too.',
			look: {
				title: 'Look around first',
				text: 'See the app without setting anything up. The setup waits here on Home.'
			},
			file: {
				title: 'With a bank statement file',
				text: 'Upload a CAMT.053 statement from your bank. It needs no bridge and is the fastest way to real payments.'
			},
			bridge: {
				title: 'Fully, with the bridge',
				text: 'The bank through Hibiscus, the mailbox, AI, the exchange and wallets. Needs the terminal once, about 10 minutes.'
			},
			change: 'Start another way'
		},
		step: {
			passkey: {
				title: 'Secure the passkey',
				why: 'Whoever loses the only passkey loses the books. A second device with the same books keeps them safe.',
				time: 'about 5 minutes'
			},
			bridge: {
				title: 'Set up the bridge',
				why: 'The bridge runs on your computer and fetches what a browser cannot: the bank through Hibiscus, the mailbox, the AI, customer portals, the exchange and wallets.',
				time: 'about 10 minutes'
			},
			payments: {
				title: 'Get payments',
				why: 'The bank through Hibiscus or as a CAMT.053 file – which works without the bridge too. Kraken and own wallets as well, if you have them.',
				time: 'about 5 minutes'
			},
			receipts: {
				title: 'Get receipts',
				why: 'From the accounting mailbox, by upload, from a folder or from customer portals.',
				time: 'about 5 minutes'
			},
			ai: {
				title: 'AI for extraction',
				why: 'Reads vendor, amount, date and number from receipts – with your own model in the bridge, redacted first. Without AI you enter these by hand.',
				time: 'about 5 minutes'
			},
			books: {
				title: 'Set up the bookkeeping',
				why: 'Legal form, start of the financial year, advisor and client number, and the ledger account for each account with bookings. Needed only before the first export.',
				time: 'about 5 minutes'
			},
			export: {
				title: 'Export the first month',
				why: 'Go through the questions, confirm the accounts, then download one month’s DATEV package.',
				time: 'depends on the month'
			},
			more: {
				title: 'More, when you need it',
				why: 'Own devices, the invoice app or a read share for an assistant.',
				time: 'as you choose'
			}
		},
		bridge: {
			commands: 'In the terminal, once:',
			commandsAfter:
				'The bridge then shows a pairing code. This page notices by itself when it runs.',
			copy: 'Copy commands',
			waiting: 'Waiting for the bridge at {url} …',
			found: 'Bridge found – now pair it with the code from the terminal.',
			diagnosis: {
				origin:
					'The bridge runs but does not let this page ({origin}) in. Add the address to appOrigins in ~/.config/belege/bridge.json and restart the bridge.',
				mixed:
					'An https page may ask a plain-http address only on this computer (127.0.0.1). Start the bridge on this computer, or open the app locally (pnpm dev).',
				'bad-url': 'That is not an address. The usual one is http://127.0.0.1:8765.',
				unreachable:
					'Nothing answers at {url}. Is the bridge running (pnpm bridge)? Is the port right? If the browser blocks the request, the app opened locally helps (pnpm dev).'
			},
			more: 'The bridge in detail (Hibiscus, mailbox, keychain)'
		}
	},
	messages: {
		sync: {
			off: 'Sync is not on on this device.',
			notProved: 'The other device did not prove the passkey – it does not belong to these books.',
			noQrSession: 'Connecting without a relay only works after unlocking in this mode.',
			notQrCode: 'This is not a code for connecting without a relay.',
			unknownMode: 'Unknown mode: {mode}',
			bothNeedsLocal:
				'In “Both”, a new device joins by QR code or via your bridge’s relay – none is set up here.',
			deviceLabel: '{browser} on {system}',
			removed: 'This device was removed.',
			notDeviceId: 'This is not a device ID.',
			removeFromOther: 'A device is removed from another one.'
		},
		passkey: {
			createFailed: 'The passkey could not be created.',
			notFound: 'No passkey for Belege was found on this device.',
			notStored: 'No passkey is stored in this browser.',
			noPrf:
				'This passkey does not provide a PRF secret. Belege encrypts all data with a key derived from this secret and opens no data without it. Please use a passkey in a browser and password manager with PRF support (e.g. current Chrome, Safari or Firefox with iCloud Keychain, Google Password Manager or 1Password).'
		},
		receipts: {
			senderUnconfirmed: 'The sender is not confirmed: check and approve first.'
		},
		booking: {
			accountDigits: 'An account has 4 to 8 digits.',
			taxKeyDigits: 'A BU key has up to 4 digits.',
			rateFormat: 'The rate is a number from 0, e.g. 0.0042 – or 0 for a worthless token.',
			rateNoQuantity: 'This booking has no quantity that a rate belongs to.'
		},
		camt: {
			notXml: 'The file is not valid XML.',
			notCamt: 'The file is not a CAMT.053 bank statement (BkToCstmrStmt missing).',
			noIban: 'The bank statement names no IBAN (Acct/Id/IBAN).',
			noAmount: 'A booking without an amount on {date}'
		},
		bridge: {
			unreachable:
				'The bridge cannot be reached (is it running, and is this address allowed in appOrigins?).',
			unknownDevice: 'The bridge does not know this device (pair again).',
			originNotAllowed: 'This app address is not allowed in the bridge.',
			wrongCode: 'Wrong pairing code.',
			noCode: 'No pairing code active: restart the bridge with --pair.',
			mailNotSetUp: 'The mailbox is not set up on the bridge (pnpm setup:mail).',
			llmNotSetUp: 'Reading receipts is not set up on the bridge (pnpm setup:llm).',
			senderUnverified: 'The sender is not confirmed (DKIM/SPF): approve first.',
			noModel: 'No model gave a usable answer ({reasons}).'
		},
		ucep: {
			unreachable: 'The invoice app cannot be reached right now. Is it open and unlocked?',
			oldVersion:
				'This version of the invoice app does not know matching yet. Please update the invoice app.',
			scopeMissing:
				'The pairing does not allow this yet: please pair the invoice app again (unpair, then connect again) so that Belege may read issued invoices and report payments.',
			invoicePdfMismatch: 'The PDF of invoice {number} does not match what the app states.',
			notInvoiceApp: 'This invitation is not from an invoice app.',
			peerUnreachable: 'The invoice app cannot be reached under this peer ID right now.',
			eigenbelegPdfLater:
				'Eigenbeleg {number} has been created, but its PDF only comes over a direct connection – which could not be made just now. Please try again later.',
			eigenbelegPdfMismatch: 'The PDF of the Eigenbeleg does not match what the app created.'
		},
		eigenbeleg: {
			needWhat: 'What was paid for? That belongs on the Eigenbeleg.',
			needWhy: 'Why is there no receipt from the other party? One sentence is enough.',
			exists: 'This payment already has Eigenbeleg {number}.',
			saveFailed: 'The Eigenbeleg could not be saved.'
		},
		aleph: {
			exists: 'This month already has usage proof {number}.',
			nothing: 'The account moved no credits this month: no proof needed.',
			saveFailed: 'The usage proof could not be saved.'
		},
		wallets: {
			costCentre: 'Cost centre: up to 36 letters and digits, no spaces – {value}'
		},
		export: {
			notReady: 'This month is not ready for export yet.'
		},
		classify: {
			ownAccount: 'own account',
			ibanOnOtherSide: 'IBAN of this account on the other side'
		}
	},
	language: {
		label: 'Language',
		de: 'Deutsch',
		en: 'English',
		quoted: '“{text}”'
	},
	theme: {
		toLight: 'Switch to light mode',
		toDark: 'Switch to dark mode',
		light: 'Light mode',
		dark: 'Dark mode'
	},
	technical: {
		on: 'Simple',
		off: 'Technical',
		title: 'Switch between simple and technical explanation',
		tag: 'Technical'
	},
	pageQr: {
		open: 'This page as a QR code',
		dialog: 'QR code of this page',
		hint: 'Scan with your phone – opens exactly this page.'
	},
	portals: {
		title: 'Customer portals',
		intro:
			'Fetch invoices straight from your customer account. A browser on the bridge’s Mac signs in and only downloads the invoices.',
		unpaired: 'Pair the bridge first.',
		none: 'The bridge knows no customer portals.',
		state: {
			'logged-in': 'signed in',
			'needs-login': 'sign-in expired',
			never: 'never signed in'
		},
		lastLogin: 'signed in on {date}',
		lastRun: 'last fetched on {date}: {count} invoices',
		lastRunFailed: 'last fetch on {date} failed',
		lastRunRefused: ', {count} refused',
		login: 'Sign in',
		loggingIn: 'Waiting for the sign-in in the browser window …',
		loginHint:
			'A browser window opens on the bridge’s Mac. Sign in there – you enter any code or security check yourself. The window then closes.',
		cancel: 'Cancel',
		fetch: 'Fetch invoices',
		fetching: 'Fetching invoices …',
		fromMonth: 'from month',
		logout: 'Sign out',
		logoutHint: 'Ends the session and deletes the browser profile on the Mac.',
		result:
			'{listed} invoices since {since} · new: {new} · already there: {known} · duplicate: {duplicate}',
		refused: ' · refused (no PDF or similar): {count}',
		read: ' · read: {count}',
		error: {
			offline: 'The bridge cannot be reached.',
			unpaired: 'The bridge does not know this device (pair again).',
			needsLogin: 'The sign-in has expired: please “Sign in”.',
			busy: 'The portal is busy with another operation right now.',
			cancelled: 'Sign-in cancelled.',
			timeout: 'No sign-in happened within 10 minutes.',
			step: 'The portal looked different than expected (step “{step}”). See bridge/README.md, customer portals.',
			browser:
				'The browser for the portals is missing on the bridge: pnpm --filter @belege/bridge exec playwright install chromium',
			profile: 'The portal’s browser profile is still open.',
			unknownInvoice: 'This invoice is no longer on the bridge: please fetch again.',
			recordingOff: 'This bridge cannot record portals.',
			notRecorded: 'There is no recording.',
			noDownload:
				'No invoice was downloaded in the recording: please record again and download one.',
			unusable:
				'The download button has neither a name nor a fixed attribute: it cannot be found again like this.',
			rejected:
				'The recipe would contain personal data (email, IBAN or a long number) and was not saved.',
			noRecipe: 'No recorded recipe is saved for this portal.',
			credentialsCancelled: 'No password entered – nothing saved.',
			credentialsEmpty: 'The password was empty – nothing saved.',
			credentialsInvalid: 'Please enter a username or an email address (one line).',
			credentialsUnsupported:
				'The password window only exists on the Mac. On the bridge’s computer: pnpm setup:portal',
			credentialsOff: 'This bridge cannot save login details from here.',
			hostsUnconfirmed: 'Please first confirm every further address the path visits.',
			newInvalid:
				'Please give a name (without email address or long numbers) and a start page with https://.',
			notLocal: 'Only your own portals can be removed.'
		},
		local: {
			badge: 'own recipe, local',
			pending:
				'New portal – not saved yet. Stop the recording and save it, otherwise it disappears again.',
			remove: 'Remove portal',
			removeHint: 'Deletes this portal’s recipe, browser profile and login details on the Mac.',
			removeConfirm:
				'Remove “{name}”? Recipe, browser profile (the session) and saved login details are deleted on the Mac. Receipts already fetched stay.'
		},
		new: {
			title: 'Record a new portal',
			intro:
				'For a vendor the bridge does not know yet: enter a name and start page, sign in in the bridge’s window, click through to an invoice and download it. From then on the bridge fetches the invoices there by itself.',
			name: 'Name',
			namePlaceholder: 'e.g. Anthropic',
			start: 'Start page',
			button: 'Record a new portal',
			starting: 'Opening the window …',
			hint: 'You do the sign-in yourself in the window – including codes, “Sign in with Google” and security checks. Passwords and inputs are never recorded.',
			recording:
				'Sign in in the bridge’s window, click through to an invoice and download it. Then “Stop recording” here.',
			saved: '“{name}” saved – it is now under Integrations → Customer portals.',
			imported: ' The downloaded invoice has been taken over as a receipt.',
			technical: [
				'The bridge creates its own portal (ID local-<name>) with its own browser profile under ~/.config/belege/portals/local-<name>/ and opens its Chromium on the start page. Only the origin and path of the address are kept; parameters and anchors (often with tokens) are discarded.',
				'What is recorded are real clicks on links and buttons, as role and name. Sign-in pages (password field, addresses like …/login or accounts.…) are not recorded, and whatever came before them is dropped: the later fetch starts signed in.',
				'If the invoice is on another address (such as invoice.stripe.com), the review shows it, and you confirm each one individually. Apart from the vendor’s site, the fetch may only visit these addresses (allowedHosts); any other navigation is aborted.',
				'The recipe lives only on the Mac: ~/.config/belege/recipes/local-<name>.json (0600), without email addresses, IBANs or long numbers. The downloaded PDF becomes a receipt like any fetched invoice.'
			]
		},
		credentials: {
			title: 'Login details',
			username: 'Username or email',
			save: 'Save login details',
			saving: 'Waiting for the password window …',
			hint: 'You enter the password in a window on your Mac – it goes straight into the Keychain and never through this page.',
			stored: 'Login details saved: the bridge will fill in the sign-in form from now on.',
			storedBadge: 'Login details saved',
			delete: 'Delete login details',
			deleted: 'Login details deleted.',
			technical: [
				'The app only sends the username to the bridge (POST /portals/<portal>/credentials). The bridge uses osascript to open a macOS dialog with hidden input; the portal’s name and address go in as arguments, not into the script.',
				'The password ends up in the macOS Keychain (service belege-bridge, account portal:<portal>), the username in ~/.config/belege/bridge.json. No log and no response contains the password; the app only learns that login details exist.',
				'“Delete login details” removes both. You still enter codes (SMS, email) and security checks yourself in the window.'
			]
		},
		record: {
			start: 'Record portal',
			startHint:
				'Click through to the invoices yourself once – the bridge remembers the path and walks it alone from then on.',
			hint: 'In the bridge’s window, click through to your invoices and download one. Passwords and inputs are never recorded.',
			stop: 'Stop recording',
			reviewTitle: 'Recorded steps',
			none: 'No click recorded.',
			noDownload: 'No download detected – the recording cannot be saved like this.',
			paused: 'Nothing was recorded on sign-in pages ({count} clicks).',
			download: ' (download)',
			unusable: ' – cannot be found again, will be skipped',
			page: 'Page {path}',
			on: ' on {host}',
			invoiceKept: 'The downloaded invoice is taken over as a receipt when saving.',
			hostsTitle: 'Further addresses',
			hostsHint:
				'The path leads through addresses outside the vendor’s site. The fetch may later visit only what you confirm here.',
			hostConfirm: '{host} is part of the invoice path',
			savedInvoice: ' The downloaded invoice has been taken over as a receipt.',
			save: 'Save as recipe',
			discard: 'Discard',
			saved: 'Recipe saved: the next fetch takes this path.',
			export: 'Export recipe',
			exportHint:
				'Downloads the recipe as JSON – for sharing, for instance for a future open recipe collection (@le-space/portal-recipes). It only contains roles, names of buttons and links, and patterns, no inputs.',
			role: {
				link: 'Link',
				button: 'Button',
				tab: 'Tab',
				menuitem: 'Menu item',
				element: 'Element'
			}
		},
		technical: [
			'The bridge starts its own Chromium (Playwright) with one profile per portal under ~/.config/belege/portals/<portal>/profile (0700) – not your everyday Chrome. The session stays in this profile; “Sign out” ends it and deletes it.',
			'A password, if you store one with “Save login details” or pnpm setup:portal, lives in the macOS Keychain (belege-bridge, portal:<portal>). You always enter codes and security checks yourself. No language model and no screenshots are involved.',
			'Every file must be a PDF by its bytes (at most 15 MB). The app recognises duplicates by the invoice ID (vodafone:<id>) and by the SHA-256.',
			'“Record portal” only remembers real clicks on links and buttons as role and name (digits as the pattern \\d+) and visited pages as masked paths. Input fields, keystrokes and everything on pages with a password field are left out; the downloaded invoice (a PDF) becomes a receipt when saving. The recipe is stored as ~/.config/belege/recipes/<portal>.json (0600) on the Mac and is rejected if it would contain an email address, an IBAN or five digits in a row. The fetch then replays the clicks without a language model.'
		]
	},
	footer: {
		verlauf: 'History',
		madeWith: 'Built with',
		build: 'Build',
		releaseExact: 'Released version – the notes are in the release on GitHub.',
		releaseAfter: '{count} changes after version {release}, not released yet.',
		source: 'Source code',
		privacy: 'Privacy & technology'
	},
	consent: {
		title: 'Before you start',
		intro:
			'Le Space Belege brings your bank transactions and receipts together. This explains where your data is stored and what leaves this computer – briefly for everyone, and in detail with the “Technical” switch.',
		earlyHeading: 'Still early.',
		earlyBody:
			'Le Space Belege is in development. Keep storing your bank statements and receipts somewhere else as well.',
		technicalHeading: 'Under the hood',
		integrationNames: {
			hibiscus: 'Hibiscus (banks via FinTS/HBCI)',
			camt: 'CAMT.053 bank statements, e.g. Revolut Business',
			alchemy: 'Alchemy (EVM, with your own key)',
			blockscout: 'Blockscout (EVM, no key)',
			'cosmos-nodes': 'Nym, Nodes Guru, PublicNode, Polkachu (Cosmos nodes)',
			'akash-indexer': 'Akash Console (indexer, older Akash history)',
			aleph: 'Aleph Cloud (credits of your own accounts, read only)',
			coingecko: 'CoinGecko (rates)',
			'kraken-rates': 'Kraken (rates)',
			ecb: 'European Central Bank (USD rate)'
		},
		features: {
			title: 'What Le Space Belege can do',
			more: 'All features in more detail: docs/features.md in the source code.',
			privacy: {
				name: 'Privacy & storage',
				items: [
					'A passkey instead of a password; every entry and every receipt file is sealed with a key derived from the passkey.',
					'Everything stays in this browser – Le Space runs no server for your books.',
					'The network can be paused at the top at any time; own devices and the invoice app can each be switched on and off.'
				]
			},
			payments: {
				name: 'Payments',
				items: [
					'Bank transactions from Hibiscus (via the bridge) and bank statements as CAMT.053, for example from Revolut or GLS.',
					'One financial year after another; related bookings are one click away.',
					'Mark, document and settle private payments from the business account.'
				]
			},
			receipts: {
				name: 'Receipts',
				items: [
					'From the bookkeeping mailbox, by upload, from a folder and from customer portals (Vodafone, your own by recording).',
					'Senders without DKIM/SPF wait for your approval; signs of fraud are pointed out.',
					'Copies of an invoice are recognised; a payment without a receipt gets an Eigenbeleg (self-made receipt).'
				]
			},
			matching: {
				name: 'Matching',
				items: [
					'Points for amount, invoice and customer number, IBAN, vendor and date: confident pairs are linked, the rest becomes a question.',
					'Transfers between your own accounts (also across chains and bridges), bank fees and refunds need no receipt.',
					'Vendor accounts for prepaid balances and collective invoices; Belege learns from your links.'
				]
			},
			ai: {
				name: 'AI – only on click (✦)',
				items: [
					'Extract receipts, keep searching in the private mailbox, suggest a receipt or a counter-booking, explain inconsistencies.',
					'With your own model in the bridge, after redaction; Le Space runs no AI.',
					'Token usage and costs in view.'
				]
			},
			crypto: {
				name: 'Crypto',
				items: [
					'Kraken and your own wallets on Cosmos chains (Nym, Akash), EVM chains (Ethereum, Base, …) and Bitcoin.',
					'Every booking in euros with quantity and daily rate plus its source: CoinGecko, Kraken, ECB, DEX pool (Uniswap), trade price, migration or by hand.',
					'Swaps – also across chains –, token migrations and dust; Aleph balances as a monthly statement.'
				]
			},
			export: {
				name: 'Bookkeeping & export',
				items: [
					'Every booking with an SKR 03 account and BU key; your chart of accounts can be imported.',
					'One ZIP per month: DATEV booking batch (EXTF) for MonkeyOffice, the receipts as PDF and a statement per account.'
				]
			},
			devices: {
				name: 'Devices & collaboration',
				items: [
					'The same books on phone and computer; a device only gets them once it proves the passkey.',
					'Devices meet via public relays, at the relay of your own bridge on the same network, or with no relay at all by QR code – or via all of them, in which case a new device only gets in on your own network.',
					'The phone uses the computer’s bridge; Belege can be installed as an app.',
					'Invoice app (UCEP): have Eigenbelege (self-made receipts) created and report paid invoices; read-only access for an assistant.'
				]
			}
		},
		identity: {
			title: 'Identity: your passkey',
			simple: [
				'Nothing works without a passkey. Your passkey is your identity: it signs you in and unlocks your books. There is no username or password.',
				'Your passkey must support an extra feature called PRF, from which the key for your data is created. If it can’t, the books stay locked.'
			],
			technical: [
				'A WebAuthn passkey with P-256 (ES256), stored as discoverable. Your DID (did:key:…) is its public key, formed by @le-space/orbitdb-identity-provider-webauthn-did. The private key never leaves the authenticator.',
				'The PRF extension (CTAP hmac-secret) is mandatory. If the authenticator provides no PRF secret, start-up aborts; there is no unencrypted fallback.',
				'Passkey prompts: creating 3, unlocking 1, restoring on a new device 4.'
			]
		},
		storage: {
			title: 'Storage: only in this browser, always encrypted',
			simple: [
				'Your bookings, receipts and settings are stored only in this browser on this device – nowhere else, not with us either.',
				'Everything is encrypted, with a key that your passkey creates anew each time you unlock. The key itself is never stored.'
			],
			loss: 'If you lose the passkey, you lose access to your data. Nobody can recover it then, not even us. If you delete this browser’s site data, it is gone as well.',
			lossHeading: 'Important:',
			technical: [
				'From the passkey’s PRF response, HKDF-SHA-256 derives the AES-GCM key that seals every database (info belege/db-key/v1), and the names of the databases (belege/db-name/v1:<collection>), so that no address can be guessed from the DID. None of this is stored.',
				'No private key is kept on the device: the identity provider derives the OrbitDB signing key (secp256k1) from the same PRF response each time you unlock. It lives only in the memory of this session.',
				'Stored are the OrbitDB document databases transactions, receipts, partners, accounts, settings, matches, questions and events, on Helia with LevelBlockstore and LevelDatastore in IndexedDB (belege/helia-blocks, belege/helia-data, belege/orbitdb). Every entry is encrypted with AES-GCM, receipt files with a separate key (belege/blob-key/v1).',
				'localStorage holds only public data: the passkey details (credential ID, public key, DID, PRF input), the passkey’s signature over the identity document and three flags of this page (notice read, light/dark, technical).'
			]
		},
		network: {
			title: 'Network: off',
			simple: [
				'Le Space Belege connects to no one. No peer-to-peer, no relay, no server: your books do not leave this browser.'
			],
			titleDevices: 'Network: own devices only',
			options: 'Settings',
			devices: 'Sync own devices',
			devicesText:
				'Your books and receipts also on your phone or a second computer with the same passkey. The devices connect via a Le Space relay (found via Aleph, see “Le Space relays”) and, where possible, directly; everything is encrypted before it leaves the device. Or, in the network menu at the top under “Where devices meet”, without a relay by QR: two devices on the same network scan each other’s code and connect directly – then Belege asks neither Aleph nor a relay nor a STUN server, and the code shows only the device’s identifier and its addresses on the local network. Or “Only on your own network”: the devices meet at the relay of your own bridge (set up on the computer with `pnpm setup:relay`) – then Belege asks neither Aleph nor a public relay nor a STUN server, and your computer sees only the addresses on the local network and when the devices are connected. Or “Both”: all three ways at once, but a device the books don’t know yet only gets in by QR or via your bridge’s relay – only after that via the public relays as well. A device only gets the books once it proves that it has the same passkey; the relay and other peers get none of it, not even encrypted. The relay sees that two devices are talking to each other, their IP addresses and the identifiers (hash values) of the databases, never contents. Applies to this device, from the next unlock. On a computer with a bridge you can additionally share the bridge with your own devices (Integrations → Own devices): then the phone uses bank, mailbox, AI and wallets via this computer – only the shared queries, encrypted; the bridge’s credentials stay on the computer.',
			collaboration: 'Collaboration',
			collaborationText:
				'Shared books with colleagues or your tax advisor, chat and later video. This comes later and will then be switched on explicitly here – not before, and not by itself.',
			technical: [
				'A libp2p node runs in the browser because OrbitDB needs one – without transports, without a bootstrap list and without peer discovery. It cannot dial anyone and listens on no address. Only when you pair Belege with your invoice app is a second, separate node added that connects to a relay (see “Invoice app” below); it cannot reach your books.',
				'Its peer key (Ed25519) is created anew in every session and stored nowhere.',
				'With “Sync own devices” this node gets the transports of the invoice app node: WebSocket to the relay, a reservation there, WebRTC for the direct connection, plus gossipsub for OrbitDB. Its peer key then comes from the passkey and a random value of this browser, so that each device has its own stable identifier. The devices know each other through sealed entries in the settings (`device:<identifier>`). Before a device gets anything, it proves the passkey: an HMAC over both identifiers with a key that is derived from the passkey and never transmitted. Until then the node answers only identify and the relay – no gossipsub, no OrbitDB heads, no Bitswap, no bridge.',
				'In the “Without a relay, by QR” mode the node has only the transport of @le-space/libp2p-webrtc-qr: no WebSocket, no relay address, no query to Aleph. Invitation and answer are each a WebRTC SDP with local candidates only (no STUN), signed with the device’s peer key and checked against the peer ID inside; because the SDP contains the DTLS fingerprint, the signature binds the connection to both identifiers, as Noise otherwise does. A code is valid for ten minutes. The passkey proof runs on this connection as on any other. The mode is stored sealed in the settings (`network-mode`) and as a copy in this browser.',
				'In the “Only on your own network” mode the node dials the bridge’s relay via WebRTC-Direct (`/ip4/<address on the local network>/udp/<port>/webrtc-direct/certhash/…`): the browser checks the relay’s certificate via its hash in the address, without a certificate authority and without installation. The bridge listens only on the one chosen address, never on all, and uses its own P-256 certificate valid for ten years, so that the address stays the same. The address is stored sealed in the settings (`lan-relay`); the app fetches it from the bridge when pairing. The connections between the devices use local candidates only (no STUN), and Noise encrypts them end to end as with the public relay.',
				'In the “Both” mode the node has all transports: QR, WebRTC-Direct to the bridge’s relay, WebSocket to the public relays. If a device the books don’t know yet (no `device:<identifier>` entry) proves the passkey, the proof only counts on a connection that was made by QR or runs via the bridge’s relay; on any other path the node aborts, on both sides. So someone who has the passkey but is not on your own network gets nothing.',
				'The page loads no fonts, scripts or images from third parties.'
			]
		},
		ai: {
			title: 'AI: where a language model helps',
			simple: [
				'Le Space runs no AI and sees none of it. The bridge on your computer asks the language model you set up yourself: a public one like DeepSeek or a local one on your own computer. If none is set up, none of this runs.',
				'AI only helps where a button carries the ✦ sign, and only when you press it. What goes out is shown when you hover over it with the mouse.'
			],
			usesHeading: 'With AI',
			uses: [
				'Extract receipts: vendor, amount, date, invoice and customer number from the text of a receipt – and whether it is a receipt at all (sign-in emails and newsletters are not). With “Extract”, “Extract all new”, “Upload receipt”, “Use as receipt” and “Fetch invoices”.',
				'“Keep searching with AI” in the private mailbox: suggest search terms and senders, then choose the receipt among the hits – by subject, sender domain and file names, never by the text of the emails.',
				'“AI suggestion” under “Link receipt”: name the matching one of up to 25 of your receipts for a booking – by vendor, amount, date, invoice number and short description. You do the linking.',
				'“AI suggestion” under “Link as counter-booking …”: name, among up to 8 bookings on your other accounts, the other side of a transfer between your own accounts – by direction, amount, quantity, day, account type, counterparty and purpose, without addresses, IBANs and hashes. You do the linking.',
				'“Explain inconsistencies” in the vendor account: say in a few sentences what doesn’t add up with a vendor – by dates, amounts, periods and line items, without phone numbers, customer and invoice numbers. Nothing is booked.'
			],
			withoutHeading: 'Without AI, by fixed rules',
			without:
				'Matching with points, questions, sorting of search hits, transfers and bank fees, what matching learns from your decisions, and the portal recipes. Every match is explained by “Why this match?”.',
			check:
				'You check what the AI delivers: the receipt shows the model and the text sent, an AI suggestion is only applied on your click, and the History lists every call.',
			technical: [
				'You set up the language model in the bridge (pnpm setup:llm): any interface in the OpenAI format (/chat/completions) – via https, or via http only on this computer (127.0.0.1, localhost), such as Ollama or LM Studio. The default is deepseek-flash, with deepseek-v4-pro as the second attempt.',
				'Before every call the bridge redacts names from your list, IBANs except for the last four digits, your own email addresses, streets, postcodes and links (only the host remains). The responses are JSON and are checked (totals, date formats, candidate numbers); whatever doesn’t fit is discarded.',
				'The API key is kept in the bridge’s macOS Keychain, never in the browser. The bridge’s log records only numbers, never text. The app’s History shows the model, duration and tokens of every call.'
			]
		},
		integrations: {
			title: 'What Belege works with',
			simple:
				'Banks, exchanges and blockchains whose bookings Belege reads, and the services it asks for that – only when you set them up or use them. The logos are built into the app; this dialog loads nothing from third-party servers.',
			groups: {
				banks: 'Banks and bank statements',
				exchanges: 'Exchanges',
				chains: 'Blockchains (own wallets)',
				data: 'Data and rate sources',
				explorers: 'Block explorers (link only)',
				ai: 'AI models (you choose one)',
				portals: 'Customer portals',
				apps: 'Connected apps'
			},
			marks:
				'Trademarks and logos belong to their owners; they only show what Belege works with. Logos: Simple Icons (CC0).'
		},
		services: {
			title: 'External services',
			simple: ['Only when you use them, and only with what is stated here.'],
			leaves: 'What leaves the computer:',
			bridge: {
				name: 'Bridge on this computer (127.0.0.1)',
				text: 'Fetches transactions from Hibiscus and receipts from your mailbox. The app only receives accounts you have approved on the bridge, and only emails to the bookkeeping address.',
				leaves:
					'The bridge queries your mailbox (IMAP) and sends redacted text to the language model for extraction (see below). Hibiscus establishes the connection to GLS Bank (FinTS).',
				technical:
					'The bridge listens only on 127.0.0.1 (port 8765) and starts on no other address. Pairing uses a one-time code; the bearer token is stored encrypted in the app’s settings, and on the bridge only its hash. CORS allows only the registered app addresses; the Host header must be 127.0.0.1 or localhost. Jameica’s certificate is pinned; the Hibiscus password, IMAP token and API key are kept in the macOS Keychain. Accounts without an approved IBAN ending are not queried at all. The bridge opens mailboxes read-only.'
			},
			camt: {
				name: 'Bank statement import (CAMT.053)',
				text: 'The file is read only here in the browser.',
				leaves: 'Nothing. The file is not uploaded.',
				technical:
					'Read with DOMParser in the browser. Of the account, the last four digits of the IBAN and a hash of it are kept.'
			},
			enableBanking: {
				name: 'Enable Banking',
				text: 'Planned for banks without Hibiscus: an account information service with an EU licence.',
				leaves: 'Your transactions would pass through its servers.',
				technical:
					'An account information service (AIS) under PSD2: after your authorisation at the bank, it retrieves accounts and transactions and passes them on; in doing so they pass through its servers. So far only in an experiment (spikes/enablebanking), not built into the app.'
			},
			deepseek: {
				name: 'Language model – DeepSeek by default (extracting receipts, AI search)',
				text: 'The model you set up in the bridge. Only for buttons with ✦ (see “AI” above).',
				leaves:
					'When extracting, the redacted text of a receipt; with “Keep searching with AI”, counterparty and payment reference as well as subject, sender domain and file names of the hits, redacted. With DeepSeek the servers are outside the EU; a local model does not leave this computer.',
				technical:
					'The bridge sends only the text layer of a PDF (or the text of an email) with subject and sender, after redacting names from its list, IBANs (except for the last four digits), your own email addresses, streets and postcodes – never the file itself. DeepSeek runs its servers in China. The API key is kept in the bridge’s macOS Keychain, never in the browser. The bridge extracts emails from senders that did not pass the DKIM/SPF check only after your approval.'
			},
			portals: {
				name: 'Customer portals (Vodafone)',
				text: 'A browser on this Mac signs in to your customer account and downloads only the invoices – only when you press “Sign in” or “Fetch invoices”.',
				leaves:
					'Your sign-in to the portal (Vodafone) and the requests for the invoice pages, directly from this Mac. The session stays in a browser profile on the Mac; a password only if you store it in the Keychain.',
				technical:
					'The bridge starts its own Chromium (Playwright) with one profile per portal under ~/.config/belege/portals/<portal>/profile (directory 0700), not your everyday browser. The first time (and when the session expires) it opens a visible window: you sign in, and you always enter codes (SMS, email) and security checks yourself. After that it fetches the invoices without a window. An optional password (pnpm setup:portal vodafone) is kept in the macOS Keychain and is only typed into the portal’s sign-in form. Only PDFs (by their bytes, at most 15 MB) reach the app. No language model, no screenshots; the log names only the step that failed. Anyone who can use your macOS account can also use the session in the profile: turn on FileVault; “Sign out” deletes the profile. A portal’s terms of use may restrict automated access.'
			},
			blockchain: {
				name: 'Blockchain query (Nym/Cosmos, Ethereum/EVM, Bitcoin)',
				text: 'Only for your own wallets that you enter under Integrations, and only when you press “Sync”: the bridge asks a public node for the transfers and the balance of the address.',
				leaves:
					'The wallet address and the IP address of this Mac – to the operator of the node: by default Nym (rpc.nymtech.net) for Nyx, PublicNode for Akash (for the older history also the Akash indexer console-api.akash.network, run by the Akash team), Blockscout for Ethereum, Base, Arbitrum, Optimism and Polygon – or Alchemy, if you have set up an Alchemy API key –, or the node you enter yourself. The operator can infer from this that this address belongs to you; Alchemy also associates the queries with your Alchemy account. If a token has no CoinGecko rate, the bridge also asks Alchemy for its Uniswap pool in the block of the booking – Alchemy then sees the token contract and the block. For Bitcoin, the bridge asks mempool.space (or your own Esplora server) about every address it derives from your account key, in quick succession from the same IP: the operator can infer from this that all these addresses belong together. For Aleph Cloud, only if you switch on “Check own Ethereum addresses at Aleph” under Integrations or enter an Aleph account: each of these addresses to Aleph (api2.aleph.im), read only – Aleph can infer from this that they belong together.',
				technical:
					'Queries are made over HTTPS: for Cosmos chains the CometBFT RPC (tx_search by transfer.sender and transfer.recipient, header, status) and the REST API (balance), for EVM chains Blockscout’s Etherscan-compatible API (txlist, txlistinternal, tokentx, balance) or, with a key, Alchemy (alchemy_getAssetTransfers, receipts, nonce, balance; internal transactions on Arbitrum and Optimism still via Blockscout; for a token without a CoinGecko rate, eth_call to the Uniswap factories (V2, V3) and Uniswap V4’s StateView for its pools against ETH and USDC in the block of the booking; the deepest one counts if it holds at least €3,000 on the ETH or USDC side). The Alchemy key is kept in the bridge’s macOS Keychain (pnpm setup:alchemy) and appears only in the address of the requests to Alchemy – never in the browser, never in the log. The app sends the address in the body of a request to the bridge, never in a URL (to Blockscout it goes in the query URL, as its API requires); the bridge’s log records only numbers. No key, no signature: the address is public, the list of your wallets is stored encrypted in your books, not in the bridge. Only assets from the chain’s list are booked (NYM, NYX, AKT, ETH, POL, USDC with a verified contract); other tokens are counted and left out. For Bitcoin, the account key (xpub, ypub or zpub) is kept only in the bridge’s macOS Keychain; the bridge derives the addresses from it (up to 20 unused in a row) and queries their confirmed transactions (Esplora API: address, address/txs/chain). The app knows only a fingerprint of the key. Links to the block explorer only open when you click them.'
			},
			ucep: {
				name: 'Invoice app (UCEP via a relay)',
				text: 'Only if you pair Belege with your invoice app under Integrations: Belege connects to it via a relay to have an Eigenbeleg (self-made receipt) created for a payment without a receipt, and – on your click on “Sync invoices” – to fetch the invoices you have issued and tell it which ones are paid.',
				leaves:
					'The IP address of this device and Belege’s peer ID – to the operator of the relay (one of the Le Space relays, see below). For an Eigenbeleg, the details of this one payment (date, amount, description, reason, the counterparty as you enter it, the payment’s internal identifier in Belege, and for crypto the chain, quantity, rate with source and time, and the transaction hash). For a paid invoice only: on which day, which amount and the payment’s internal identifier – never account, IBAN or payment reference. Both to your invoice app, no one else; never the rest of your books.',
				technical:
					'libp2p with WebSocket to the relay (Circuit Relay v2) and WebRTC for the direct connection; Noise encrypts every connection end to end, the relay sees only ciphertext. The peer ID comes from a key that is derived from your passkey and never stored. The pairing (UCEP, Le-Space/ucep-spec) grants Belege only the rights “create Eigenbelege”, “read own documents”, “read issued invoices” and “report payments”. Without pairing, Belege establishes no connection.'
			},
			relays: {
				name: 'Le Space relays (found via Aleph)',
				text: 'Only when Belege goes online – for the invoice app or for your own devices: Belege asks api.aleph.im for the current addresses of the Le Space relays and connects to them. Only entries from the two wallets that Le Space operates for this purpose count; other entries are ignored.',
				leaves:
					'To Aleph (api.aleph.im): the IP address of this device, when looking up. To the operator of the relay: the IP address, the peer ID of Belege and of the other side, when you are connected and how many bytes flow – never contents. For a direct connection (WebRTC), to public STUN servers (Google, Twilio, Cloudflare, Mozilla): the IP address.',
				technical:
					'Aleph POST messages in the channel simple-todo (ref simple-todo-bootstrap, type relay-bootstrap-v2, registration relay:orbitdb-relay:orbitdb-relay), as Le-Space/relay-button writes them; the newest entry per Le Space wallet is taken, and from it a TLS WebSocket address. If Aleph does not respond, Belege uses the last known relays. Every connection via a relay is encrypted end to end with Noise; the relay can read nothing, change nothing and cannot pose as the other side (Noise checks the peer ID). A third-party relay could at most see who is connected to whom and when, or refuse connections – hence only the Le Space wallets. The peer ID comes from your passkey and stays the same; anyone who knows it can recognise connections from Belege.'
			}
		},
		status: {
			off: 'off',
			active: 'active',
			whenPaired: 'when paired',
			planned: 'planned',
			notYet: 'not active yet',
			whenSetUp: 'when set up'
		},
		where: {
			heading: 'What is stored where',
			items: [
				'In this browser: your books, encrypted.',
				'In this browser, readable: the public details of your passkey and three flags of this page.',
				'On your passkey: the only key to everything.',
				'On this computer outside the browser, only if you set up the bridge: its settings, the Hibiscus password, the IMAP token and the API key in the Keychain.',
				'On this computer, only if you sign in to a customer portal: its browser profile with the session, and a portal password only if you store it in the Keychain.',
				'With us: nothing. We run no server and receive no copy.'
			],
			cookies: 'No cookies, no tracking.'
		},
		proceed: 'Understood',
		close: 'Close',
		reopenHint:
			'You can find this notice at any time at the bottom of the page under “Privacy & technology”.'
	},
	onboarding: {
		title: 'Unlock your books',
		intro:
			'Your bookkeeping data stays on this device and is encrypted with a key from your passkey. Without the passkey nobody can read it – not even us.',
		unlock: 'Unlock with saved passkey',
		newHeading: 'New here',
		label: 'Name for the passkey',
		labelPlaceholder: 'e.g. Smith Ltd',
		labelHint:
			'Just a label in the passkey picker. The identity comes from the key, not from this name.',
		create: 'Create passkey',
		restoreHeading: 'Already have a passkey?',
		restore: 'Restore with existing passkey',
		busy: 'Please confirm the passkey …'
	},
	share: {
		title: 'Access for an assistant',
		what: 'An assistant on this computer (e.g. Claude Code) can look at a year’s payments, receipts and questions instead of working from screenshots. You choose what it sees and for how long; the bridge keeps the share in memory only and counts every read.',
		note: 'What an assistant reads goes to its vendor as conversation content.',
		needsBridge: 'This needs the bridge to be paired.',
		collections: 'What is shared',
		scope: {
			transactions: 'Payments',
			receipts: 'Receipts',
			questions: 'Questions',
			redacted: 'redacted'
		},
		redacted:
			'Redacted (IBANs except the last four digits, no email addresses, phone numbers, customer and contract numbers, file names or senders)',
		unredactedWarning:
			'Unredacted: IBANs, file names, senders and all numbers go out exactly as they are stored.',
		duration: 'Valid for',
		create: 'Create share for {year}',
		command: 'The assistant reads the share with this command:',
		copyCommand: 'Copy command',
		until: 'until {time}',
		reads: 'read {count}×',
		revoke: 'Revoke',
		refresh: 'Refresh reads'
	},
	aleph: {
		title: 'Aleph Cloud (hosting credits)',
		what: 'Aleph issues no invoices: hosting and storage are paid with credits. Here a usage proof is created as an Eigenbeleg (self-made receipt) per Aleph account and month – opening and closing balance, top-ups, usage per day (storage combined, each instance separately) with euro value. Read only: nothing is signed or moved.',
		needsBridge: 'Needs the paired bridge.',
		scanLabel: 'Check own Ethereum addresses at Aleph',
		scanPrivacy:
			'The addresses under “Own wallets” (Ethereum and other EVM chains) are checked with Aleph for credits. Aleph can infer from this that they belong together.',
		extraLabel: 'Another Aleph account (0x…)',
		extraAdd: 'Add',
		badAddress: 'That is not an Aleph account address (0x and 40 hex characters).',
		scan: 'Check with Aleph',
		scanning: 'Checking …',
		scanned: '{asked} addresses checked, {found} of them with Aleph credits.',
		none: 'No Aleph account found yet. Switch on the check or enter an account, then “Check with Aleph”.',
		credits: '{credits} credits (as of {date})',
		month: 'Month',
		make: 'Create usage proof',
		making: 'Creating …',
		exists: 'Proof {number} is under Receipts.',
		made: 'Eigenbeleg {number} for {month} created ({eur}); it is under Receipts.'
	},
	pwa: {
		update: 'A new version of Belege is available. Reload – then unlock with the passkey.',
		reload: 'Reload',
		installWhat:
			'Belege can be installed as an app: its own window and icon, starts offline too. The books stay on this device.',
		install: 'Install as app',
		later: 'Not now'
	},
	devices: {
		title: 'Own devices',
		what: 'The same books on your phone or a second computer: both devices need the same passkey (synced via the keychain) and sync switched on.',
		off: 'Sync is off on this device. Switch it on in the “Privacy & technology” notice under “Sync own devices”; it applies from the next unlock.',
		openConsent: 'Open notice',
		pending: 'Switched on – applies from the next unlock (reload the page).',
		self: 'ID of this device',
		selfHint: 'Enter it on the other device under “Add device”.',
		reachable: 'reachable via the relay',
		notReachable: 'waiting for the relay …',
		copy: 'Copy ID',
		add: 'Add device',
		addLabel: 'ID of the other device',
		addButton: 'Connect',
		list: 'Known devices',
		none: 'No other device yet.',
		connected: 'connected',
		direct: 'direct',
		viaRelay: 'via the relay',
		bridgeShare: 'Share this computer’s bridge with own devices',
		bridgeShareText:
			'Only on the computer where the bridge runs and is paired: your other devices (the same books, in the list below) use bank, mailbox, AI, rates and wallets through it. Only reading and querying requests, no setup, nothing is deleted; access to the bridge stays here. Applies from the next unlock, as long as this tab is open and unlocked.',
		bridgeServed: 'This computer’s bridge is available to your devices.',
		bridgePending: 'Shared – applies from the next unlock (reload the page).',
		notConnected: 'not connected',
		unnamed: 'Unnamed device',
		showQr: 'Show as QR code',
		hideQr: 'Hide QR code',
		qrLabel: 'QR code with the ID of this device',
		qrHint: 'Capture it on the other device under “Add device” with “Scan QR code”.',
		scan: 'Scan QR code',
		scanStop: 'Stop scanning',
		scanHint: 'Hold the other device’s QR code up to the camera. The image stays on this device.',
		scanFailed: 'The camera could not be opened ({reason}). You can also paste the ID.',
		scanWrong: 'This QR code is not a device ID.',
		bothMode:
			'“Both”: a new device joins via QR code or via your bridge’s relay; after that the devices also meet via the public relays.',
		qrMode: {
			what: 'Without a relay: one device shows an invitation, the other scans it and shows its answer, the first scans the answer. Then both are connected directly – no relay, no server in between.',
			invite: 'Show invitation',
			inviteLabel: 'QR code with this device’s invitation',
			inviteHint:
				'Scan with the other device, then capture its answer here with “Scan QR code”. Valid for ten minutes.',
			answerLabel: 'QR code with this device’s answer',
			answerHint: 'Scan with the device that showed the invitation.',
			copy: 'Copy code',
			pasteLabel: 'Or paste the other device’s code',
			use: 'Use',
			connected: 'Connected: the other device has proven the passkey and has been added.',
			limits:
				'Both devices must be on the same network (Wi-Fi without client isolation). After a reload or a dropped connection they exchange codes once again.'
		},
		remove: 'Remove',
		removeConfirm: 'Really remove',
		removeCancel: 'Cancel',
		removeWhat:
			'The devices stop syncing with it, and it switches off its sync as soon as it learns of this. Anyone with the passkey can still open the books – for a lost device, delete the passkey in the keychain.',
		removed:
			'This device was removed on another device; sync is switched off here. Switch it back on in the “Privacy & technology” notice – then the more recent switch-on applies.'
	},
	vendorAccount: {
		open: 'View vendor account',
		title: 'Vendor account: {name}',
		back: 'To Payments',
		intro:
			'All payments and receipts from this vendor on one timeline, with running balance: opening balance + payments − usage per receipts. For credit and collective statements, where a payment never matches exactly one receipt.',
		opening: 'Opening balance {date}',
		unknown: 'unknown',
		topUps: 'Payments / top-ups',
		usage: 'Usage per receipts',
		closing: 'Balance {date}',
		wholeYear: 'Show whole year {year}',
		findings: 'What doesn’t add up',
		finding: {
			negative:
				'On {date} the balance is negative ({amount}): more used than paid – a payment or the opening balance is missing.',
			gap: 'There is no receipt for {month} – an invoice is probably missing.',
			'no-statements': 'There are payments, but not a single receipt from this vendor.',
			january:
				'The receipt from {date} ({amount}) may still bill the previous year – please check before it is assigned to this year.',
			'unknown-opening':
				'The first entry is a receipt ({date}): without an opening balance the balance before it is unknown.',
			'previous-year':
				'The receipt from {date} ({amount}) bills a period of the previous year – it belongs to the previous year’s usage.'
		},
		period: 'Period',
		items: 'Items',
		explain: 'Explain inconsistencies',
		explainTitle:
			'Sends the timeline to your language model: dates, amounts, periods, items and the findings – redacted, without phone, customer and invoice numbers. Hints only, nothing is booked.',
		explainNeedsBridge: 'This needs the bridge to be paired with a language model.',
		notes: 'AI notes',
		pdf: 'Download as PDF',
		isPrepaid:
			'Kept as a prepaid account: top-ups need no receipt of their own, the usage proofs count as linked.',
		openingLabel: 'Opening balance on 1 Jan {year} (EUR, e.g. from the customer account)',
		save: 'Save',
		prepaidOff: 'Stop keeping as a prepaid account',
		suggest:
			'Looks like a prepaid account: payments and receipts don’t match one by one, the top-ups are round amounts or the receipts are not payment requests.',
		prepaidWhat:
			'Kept as a prepaid account, the usage proofs serve as receipts for the top-ups: no more questions about individual top-ups, the receipts show as “Prepaid account”. The timeline shows whether everything adds up.',
		prepaidOn: 'Keep as a prepaid account',
		payment: 'Payment',
		statement: 'Receipt',
		empty: 'No payments or receipts from this vendor in this period.',
		col: { date: 'Date', what: 'Entry', topUp: 'Payment', usage: 'Usage', balance: 'Balance' }
	},
	year: {
		label: 'Year',
		fromYear: 'Receipt from {year}',
		fromYearTitle: 'The receipt is from {year}; the payment falls in this year.',
		hidden: '{count} more in other years'
	},
	home: {
		integrationNeeds: 'Integrations need you',
		privateOpen: {
			title: 'Paid privately, not yet settled: {count} ({amount})',
			what: 'Private payments from the business account. Pay them back from the private account and link the repayment to the payment.'
		},
		transferReceipts: {
			title: 'Transfer with receipt: {count} to check',
			what: 'These payments now count as your own transfer and need no receipt, but still have one linked – often from before the transfer was recognised. Unlink it if the receipt doesn’t belong; otherwise confirm it.',
			receipt: 'Linked: {vendor}',
			open: 'Open payment',
			unlink: 'Unlink',
			keep: 'Receipt is correct'
		},
		resume: {
			extract:
				'{count} receipts were not fully read when the page was reloaded or locked. Continue?',
			suggest:
				'AI suggestions are still missing for {count} questions because the run was interrupted. Continue?',
			go: 'Continue',
			drop: 'Discard',
			noBridge: 'This doesn’t work without a paired bridge – pair it under Integrations.'
		},
		morning: 'Good morning',
		day: 'Good afternoon',
		evening: 'Good evening',
		intro: 'Here is what’s in your books.',
		transactions: 'Payments',
		receipts: 'Receipts',
		partners: 'Partners',
		totals: {
			title: 'Income and expenses {year}',
			what: 'What came in from outside and went out, as booked (gross). Transfers between your own accounts, swaps and trades do not count; refunds are netted against their charge.',
			income: 'Income',
			expenses: 'Expenses',
			bank: 'Bank',
			crypto: 'Crypto',
			total: 'Total',
			balance: 'Balance',
			private: 'Paid privately from the business account',
			privateLine: '{paid} paid · {repaid} paid back',
			loans: 'Loans',
			loansLine: '{received} received · {paid} paid',
			unpricedOne: '1 crypto booking without a rate is not counted.',
			unpricedMany: '{count} crypto bookings without a rate are not counted.',
			show: 'show',
			none: 'No payments in this year yet.'
		},
		identity: 'Your identity',
		identityHint: 'The DID is your passkey’s public key. It reveals nothing about your data.',
		agentTitle: 'Your receipt agent is waiting for you',
		agentKind: 'Question',
		agentOpenOne: '1 open question',
		agentOpenMany: '{count} open questions',
		agentNone: 'No open questions – everything that can be linked is linked.',
		vat: {
			title: 'Input VAT {year}',
			what: 'The VAT in your receipts at 19 % and 7 %, by receipt date. As the receipts were extracted – a help for the advance return, not the return itself.',
			period: 'Period',
			rate19: '19 %',
			rate7: '7 %',
			sum: 'Input VAT',
			year: 'Year',
			quarter: 'Q{n}',
			unlinked: 'Of this, {amount} from receipts not linked to a payment yet (receipts: {count}).',
			foreign: 'Foreign VAT: {amount} (receipts: {count}) – not German input VAT, not counted.',
			reverse:
				'§13b (reverse charge, a service from abroad): {amount} (receipts: {count}). You owe the VAT on it and deduct it as input VAT at once – zero in the end, but to be declared.',
			noLines:
				'Receipts without a VAT line: {count}. Nothing to deduct, or not extracted – worth a look.',
			other: 'Receipts in another currency, not counted: {count}.',
			undated: 'Receipts without a date, in no period: {count}.',
			smallBusiness:
				'As a small business (Kleinunternehmer, §19 UStG) you deduct no input VAT. Your receipts of this year contain {amount} of VAT.',
			outputLater:
				'The output VAT from your outgoing invoices and the VAT payable follow once the invoice app sends the VAT per rate.'
		},
		agentProgress: '{done} of {total} done',
		agentAnswer: 'Answer questions',
		coverage: 'Payments with receipt',
		coverageText: '{covered} of {count} ({percent} %)',
		matchRun: 'Start matching',
		matchRunning: 'Matching …',
		matchResult: '{sure} linked · {questions} · {classified} without receipt requirement',
		matchWaiting: ' · {count} still waiting',
		matchQuestionsOne: '1 question',
		matchQuestionsMany: '{count} questions',
		matchFailed: 'Matching failed.',
		matchStep: {
			read: 'Reading payments and receipts …',
			score: 'Comparing {receipts} receipts with {transactions} payments …',
			write: 'Writing the matches …',
			done: 'Done.'
		},
		matchHow:
			'Matching compares every receipt with every open payment and awards points for amount, invoice number, vendor, IBAN and date. The app does this itself, on this device – the AI only reads the receipts.',
		verlaufLink: 'View in History',
		technical: [
			'The books are eight OrbitDB document databases (transactions, receipts, partners, accounts, settings, matches, questions, events), each entry sealed with AES-GCM; amounts in whole cents, deletion is soft (deleted).',
			'Keys and database names come via HKDF-SHA-256 from the passkey’s PRF response and are derived afresh at every unlock.'
		]
	},
	matching: {
		reason: {
			amount: 'Amount',
			'invoice-number': 'Invoice number',
			'customer-number': 'Customer number',
			iban: 'IBAN',
			vendor: 'Vendor',
			'vendor-in-purpose': 'Vendor in reference',
			'vendor-learned': 'Vendor (learned)',
			date: 'Date',
			'far-date': 'Date far off',
			'wrong-direction': 'Wrong direction',
			manual: 'by hand',
			eigenbeleg: 'Eigenbeleg',
			'crypto-hash': 'Tx hash in receipt',
			'crypto-address': 'Address in receipt',
			'crypto-amount': 'Quantity in receipt'
		},
		badge: {
			receipt: 'Receipt',
			'no-receipt': 'No receipt needed',
			'private-mistake': 'Private (misdirected)',
			'private-repayment': 'Private repayment',
			'own-transfer': 'Own transfer',
			'bank-fee': 'Bank statement',
			loan: 'Loan',
			'crypto-reward': 'Exchange earnings',
			'crypto-stake': 'Staking',
			refund: 'Refund',
			'prepaid-topup': 'Prepaid account',
			'crypto-swap': 'Swap',
			'token-burn': 'Burned by the project',
			'token-migration': 'Token migration',
			'crypto-dust': 'Dust',
			'rule-ignore': 'Ignored',
			'rule-private': 'Private'
		},
		kind: {
			'own-transfer': 'Own transfer (1360) – no receipt needed',
			'bank-fee': 'Bank charge – the bank statement is the receipt',
			loan: 'Loan – the contract is the receipt',
			'crypto-reward': 'Staking or earn income – the exchange’s statement is the receipt',
			'crypto-stake': 'Delegated to staking – no receipt needed, not on 1360',
			refund: 'Charge and refund – no receipt needed',
			'prepaid-topup': 'Top-up of a prepaid account – covered by the usage proofs',
			'crypto-swap': 'Swap via a DEX – the transaction in the block explorer is the receipt',
			'token-burn': 'Burned by the token project – no payment, no receipt',
			'token-migration':
				'Token migration – both transactions in the block explorer are the receipt',
			'crypto-dust': 'Dust under one cent – no receipt needed',
			'rule-ignore': 'Ignored per own instruction: {reason}',
			'rule-private': 'Private per own instruction: {reason}',
			'no-receipt': 'No receipt needed: {reason}'
		},
		state: { auto: 'automatic', confirmed: 'confirmed' },
		score: '{score} points',
		waiting: 'still waiting ({days} days)',
		waitingOne: 'still waiting (1 day)'
	},
	explain: {
		reason: {
			amount: 'Amount matches',
			amountValue: 'Amount matches ({amount})',
			invoice: 'Invoice number in the payment reference',
			invoiceValue: 'Invoice number {number} in the payment reference',
			customer: 'Customer number in the payment reference',
			customerValue: 'Customer number {number} in the payment reference',
			vendor: 'Vendor matches',
			vendorValue: 'Vendor {vendor}',
			vendorLearned: 'Vendor matches – you have linked it this way before',
			vendorLearnedValue: 'Vendor {vendor} – you have linked “{counterparty}” to it before',
			vendorInPurpose: 'Vendor in the payment reference',
			vendorInPurposeValue: 'Vendor {vendor} in the payment reference',
			iban: 'The vendor’s IBAN is the contra account',
			date: 'Date matches',
			'far-date': 'Date is far off',
			'wrong-direction': 'Direction does not match (incoming instead of outgoing or vice versa)',
			'crypto-hash': 'the transaction hash is on the receipt',
			'crypto-address': 'the counterparty address is on the receipt',
			'crypto-amount': 'the quantity with asset is on the receipt'
		},
		how: {
			auto: 'linked automatically',
			confirmed: 'confirmed by you',
			manual: 'linked by you'
		},
		points: '{score} points',
		thresholds:
			'The app links automatically from {sure} points, and only if no other receipt and no other payment comes closer than {lead} points. Otherwise it asks.',
		field: {
			counterparty: 'Counterparty',
			purpose: 'Payment reference',
			any: 'Counterparty or reference'
		},
		rule: {
			noReceipt: 'Decided by you: No receipt needed – {reason}',
			noReason: 'no reason given',
			ownCompany: 'Own transfer: the counterparty is your company “{company}”',
			ownIban: 'Own transfer: the contra account is your account {account}',
			ownIbanFound: '– the counter-booking there on {date} is linked.',
			ownIbanMissing:
				'– there is no counter-booking with this amount there in the days around it. Is this account’s bank statement fully imported?',
			ownCounter:
				'Own transfer: the counter-booking is on {account} on {date} – same amount in the other direction, and “{sign}” says transfer. No receipt needed (account 1360).',
			otherAccount: 'your other account',
			ownMirrored:
				'Own transfer: the contra account ends like your account {account}, and the counter-booking is there',
			bankFee: 'Bank charge: booking type “{type}” – the bank statement is the receipt',
			bankFeeCode:
				'Bank charge: the bank’s booking code “{code}” (fees) – the bank statement is the receipt',
			bankFeeWords:
				'Bank charge: “{word}” in the payment reference, and no counterparty other than the bank – the bank statement is the receipt',
			bankFeeLearned:
				'Bank charge: you have classified a booking with this payment reference this way before – the bank statement is the receipt',
			loan: 'Loan: “Darlehen” (loan) in the payment reference – the contract is the receipt',
			exchangeFee:
				'Exchange fee: Kraken charged it for this booking – the exchange’s statement is the receipt',
			networkFee: 'Blockchain network fee: the transaction in the block explorer is the receipt',
			ownAddress:
				'Own transfer: the counterparty address {address} is your wallet {account}. No receipt needed (account 1360).',
			ownIbc:
				'Own transfer via IBC: the recipient {address} on the other chain is your wallet {account}. No receipt needed (account 1360).',
			ownManual:
				'Own transfer, linked by you: the counter-booking is on {account} on {date}. No receipt needed (account 1360).',
			ownBridge:
				'Own transfer via a bridge: the counter-booking is on {account} on {date} – the same cryptocurrency, the same quantity minus the bridge fee (at most 3 %), within 8 days. No receipt needed (account 1360).',
			prepaidTopup:
				'Top-up of the prepaid balance at {vendor}: covered by its usage proofs in the vendor account – no receipt of its own needed.',
			refunded:
				'Fully refunded: the refund is on {account} on {date} ({how}). Charge and refund cancel out – no receipt needed.',
			refundOf:
				'Refund of the charge on {account} from {date} ({how}). The refund needs no receipt of its own; for a partial refund the charge still needs its receipt.',
			refundAuto: 'same counterparty, “Erstattung” (refund) in the text',
			refundManual: 'linked by you',
			swap: 'Swap via a decentralised exchange (DEX): the wallet gave one asset and got another, in one transaction. The transaction in the block explorer is the receipt. For tax purposes a disposal and an acquisition at the day’s value – clarify that with your tax advisor.',
			swapCross:
				'Swap via another chain (Skip Go, Osmosis): the result arrived on {account} on {date}. Both transactions in the block explorer are the receipt. For tax purposes a disposal and an acquisition at the day’s value – clarify that with your tax advisor.',
			swapCrossArrival:
				'Arrival of a swap via another chain (Skip Go, Osmosis): sent on {date} from {account}. Both transactions in the block explorer are the receipt.',
			swapCrossMissing:
				'Swap via another chain (Skip Go, Osmosis) to {address} – the same address as this wallet, but not set up as an own wallet. Add it under Integrations → Own wallets, then Belege will find the arrival.',
			swapCrossNone:
				'Swap via another chain (Skip Go, Osmosis) to your wallet {address} – the arrival is not booked there yet. Sync the wallet, or link it by hand as a swap.',
			swapCrossMany:
				'Swap via another chain (Skip Go, Osmosis) to your wallet {address} – {count} arrivals match. Link the right one by hand as a swap.',
			swapManual: 'Linked by you as a swap with {account} on {date}.',
			tokenBurn:
				'Burned by the project: this wallet did not send the transaction, the token project did (a rebase or a migration) – no payment to anyone, no receipt. If there was a new token for it, link it as a migration.',
			tokenMigration:
				'Token migration: linked with {account} on {date}. The new token takes over the value (the acquisition cost) of the burned one – no disposal. The assessment is up to your tax advisor.',
			staking:
				'Staking: the tokens are delegated and remain yours. No receipt needed. Not on 1360 – their return after unbonding is not a transaction, so a transfer would never balance; clarify the account with your tax advisor.',
			dust: 'Dust: worth less than a cent, received without you doing anything. No receipt needed. Often a test or advertising – or the start of address poisoning: never use the sender address as a recipient.',
			dustLookalike:
				'Dust from an address that looks like {known} but is a different one – very likely address poisoning. No receipt needed.',
			cryptoReward:
				'Staking or Earn income from the exchange – the exchange’s statement is the receipt. Clarify with your tax advisor which account it belongs to.',
			ignore: 'Own instruction: {field} contains “{contains}” → ignored ({reason})',
			private: 'Own instruction: {field} contains “{contains}” → private ({reason})'
		},
		why: 'Why this match?',
		whyNone: 'Why is no receipt needed?',
		question: 'Open question: these receipts are candidates',
		noCandidates: 'No receipt reaches enough points to be suggested.',
		waiting: 'No receipt yet – matching waits another {days} days, then it asks.',
		waitingOne: 'No receipt yet – matching waits another day, then it asks.',
		notAi: 'The app does the matching itself by points, not the AI.',
		technical: [
			'The points come from app/src/lib/matching/score.js: amount 40, invoice number in the reference or in the end-to-end ID 50, customer number 20, IBAN 15, vendor 20 (in the reference 10), date within the window invoice date −5 to due date +10 days 10; more than 60 days off −30, wrong direction −40.',
			'Points and reasons are stored in the sealed matching record (matches), as the matching assigned them at the time.'
		]
	},
	statistik: {
		title: 'Storage and AI',
		back: 'Back',
		intro:
			'What your books take up in this browser and what the AI has used. None of it leaves the browser.',
		storage: 'Storage in this browser',
		ofQuota: 'of {quota} available',
		files: 'Receipt files (encrypted)',
		fileCount: '{count} files',
		database: 'The books (database) and other',
		storageUnknown: 'This browser does not report the storage used.',
		persisted: 'The browser keeps the data permanently.',
		notPersisted: 'The browser may delete the data when space runs low.',
		persist: 'Request persistent storage',
		persistYes: 'Granted: the browser will no longer delete the books on its own.',
		persistNo:
			'Not granted. Some browsers only grant it once the page is installed as an app or used often.',
		records: 'Entries',
		collection: {
			transactions: 'Payments',
			receipts: 'Receipts',
			matches: 'Matches',
			questions: 'Questions',
			events: 'History',
			partners: 'Partners',
			accounts: 'Accounts'
		},
		ai: 'AI usage',
		today: 'Today',
		week: 'Last 7 days',
		month: 'This month',
		cost: 'Cost (approx.)',
		tokens: 'Tokens',
		kind: {
			extract: 'Extraction',
			'match-assist': 'AI suggestion',
			'transfer-assist': 'AI counter-booking',
			'vendor-assist': 'AI vendor account',
			'mail-assist': 'Mailbox search'
		},
		perReceipt: 'About {tokens} tokens per extracted receipt this month.',
		perReceiptNone: 'No receipt has been extracted this month yet.',
		pricesFrom: 'Prices from {date} in {currency}, at the vendor’s peak and off-peak times.',
		estimated: ' Older entries without individual calls are estimated.',
		unpriced: ' Without a price and not counted: {models}.',
		holidays:
			' The app does not know Chinese public holidays (off-peak); on those days the estimate is too high.',
		editPrices: 'Change prices',
		toVerlauf: 'View in History',
		workers: 'Concurrent AI requests per run',
		workersHint:
			'Applies to “Extract all new” and “AI suggestions for all open questions”. If the vendor limits requests, the run waits and then continues. Choose fewer if it pauses often.',
		pricesHint:
			'Per 1 million tokens in {currency}, at peak time; the app works out the off-peak price from it.',
		priceInput: 'Input',
		priceCached: 'Cached input',
		priceOutput: 'Output',
		savePrices: 'Save prices',
		resetPrices: 'Reset to the vendor’s prices',
		home: 'Storage and AI',
		homeLine: '{storage} used · AI this month {cost}',
		homeOpen: 'Details'
	},
	rueckfragen: {
		ai: {
			button: 'AI suggestions for all open questions ({count})',
			what: 'For {count} payments without a receipt, the bridge asks your language model which receipt fits – one request per payment with the redacted booking and up to 25 nearest receipts.',
			tokens: 'Based on your last AI suggestions, about {tokens} tokens.',
			tokensUnknown: 'History shows how many tokens this takes after the first run.',
			only: 'These are only suggestions: nothing is linked until you accept one.',
			start: 'Get suggestions',
			no: 'Cancel',
			progress: 'AI suggestions … {done}/{count}',
			cancel: 'Cancel',
			cancelling: 'Stopping after this question …',
			failed: 'The AI did not answer for {count} questions – a new run will ask it again.',
			pick: 'AI suggestion ({confidence}): {reason}',
			nonePick: 'AI suggestion: none of the receipts fits.',
			take: 'Accept',
			dismiss: 'Discard',
			takeSure: 'Accept all confident suggestions ({count})',
			transferFirst: 'First check whether it is an own transfer',
			transferFirstWhat:
				'For {count} of these payments there is a counter-booking with a similar amount on another own account: for these the bridge first asks whether one of them is the other side – one extra request each. If the model finds one, no receipt is searched for.',
			transferPick: 'AI suggestion ({confidence}): own transfer – {reason}',
			transferTake: 'Link as counter-booking'
		},
		title: 'Questions',
		intro:
			'Where matching is not sure, it asks you. Your answer stands: a later matching run does not overwrite it.',
		back: 'Back to Home',
		empty: 'No open questions.',
		answered: 'Done ({count})',
		kind: {
			'unsure-match': 'Which payment belongs to this receipt?',
			'missing-receipt': 'This payment is missing a receipt',
			'missing-income': 'This incoming payment is missing its outgoing invoice',
			'unknown-sender': 'Sender not verified'
		},
		unknownSender:
			'This email failed the sender check (DKIM/SPF). Approve it first, then it will be extracted and matched.',
		candidates: 'Suggestions',
		receiptCandidates: 'Matching receipts',
		noCandidates: 'No matching receipt found.',
		choose: 'This is it',
		none: 'None of these',
		noReceipt: 'No receipt needed',
		reason: 'Reason',
		reasonPlaceholder: 'e.g. business meal, receipt lost',
		ignore: 'Ignore',
		confirmSender: 'Sender checked – approve',
		openTx: 'Open payment',
		auto: 'resolved itself',
		answer: {
			candidate: 'linked',
			none: 'none of these',
			'no-receipt': 'no receipt needed',
			ignore: 'ignored',
			'confirm-sender': 'approved',
			auto: 'resolved itself'
		}
	},
	ai: {
		mark: 'AI',
		extract:
			'With AI: the bridge sends the receipt’s text – redacted, never the file – to the language model you have set, and gets back vendor, amount, date and numbers.',
		upload:
			'With AI: after the upload the bridge extracts the receipt with your language model (text only, redacted). Linking happens without AI.',
		import:
			'With AI: after the import the bridge extracts the email or its attachment with your language model (text only, redacted). Linking happens without AI.',
		portal:
			'With AI: the bridge extracts the fetched invoices with your language model (text only, redacted). Signing in and fetching work without AI.'
	},
	settings: {
		title: 'Settings',
		intro: 'What matching and the export need to know about you and your bookkeeping.',
		nav: {
			setup: 'Setup',
			company: 'Company & own accounts',
			matching: 'Matching & rules',
			learned: 'Learned',
			books: 'Bookkeeping (DATEV)',
			chart: 'Chart of accounts',
			privacy: 'Privacy & technical'
		}
	},
	anweisungen: {
		title: 'Company, matching and bookkeeping',
		intro:
			'What matching needs to know about you: your company name, your own accounts and payments that need no receipt.',
		companyNames: 'Company name(s)',
		companyHint:
			'One name per line, e.g. “le space UG”. Payments to this name count as an own transfer (account 1360), invoices from it as your outgoing invoices.',
		ownIbans: 'Own IBANs',
		ownIbansHint:
			'One IBAN per line. Payments to these accounts count as an own transfer. Matching already knows the accounts from the books: {list}.',
		ownIbansNone: 'none yet',
		rules: 'Rules',
		noRules: 'No rules yet.',
		field: 'Where',
		fieldCounterparty: 'Counterparty contains',
		fieldPurpose: 'Payment reference contains',
		fieldAny: 'Counterparty or reference contains',
		contains: 'Text',
		action: 'Then',
		actionIgnore: 'ignore (no receipt needed)',
		actionPrivate: 'mark as private',
		reason: 'Reason',
		reasonPlaceholder: 'e.g. tax assessment on file',
		add: 'Add rule',
		remove: 'Remove',
		learnedFees: 'Learned bank fees',
		learnedFeesHint:
			'Bookings you classified as a bank fee: account and payment reference without numbers. The next identical booking needs no receipt.',
		noLearnedFees: 'None yet.',
		learned: 'Learned vendors',
		learnedHint:
			'When you link a receipt to a payment or confirm a matching, matching remembers that this counterparty on the bank statement belongs to this vendor – and where its receipts come from by email. Next time this counts 40 points and helps the mailbox search.',
		learnedMail: 'Receipts from {domains}',
		noLearned: 'Nothing learned yet.',
		forget: 'Forget',
		grace: 'Ask about a missing receipt after',
		graceUnit: 'days',
		graceHint:
			'A receipt often arrives a few days after the debit. Until then the payment counts as without a receipt, but matching does not ask yet. 0 = ask immediately.',
		chart: {
			title: 'Chart of accounts',
			hint: 'Import your bookkeeping’s chart of accounts: then “Account” on each payment suggests your accounts with your names instead of the general SKR 03 list.',
			infoTitle:
				'A file from your bookkeeping: DATEV “Kontenbeschriftungen” (account labels, e.g. MonKey Office: Import & Export → Export DATEV → Kontenbeschriftungen) or a CSV with account number and name. It stays encrypted in your books in this browser.',
			howTitle: 'How do I get the file?',
			how: [
				'MonKey Office: sidebar → Import & Export → Export DATEV → “Kontenbeschriftungen” (optionally just an account range “von Konto … bis Konto”) → import the CSV file here.',
				'Other programs with a DATEV interface: choose the export “Kontenbeschriftungen” or “Kontenplan (DATEV-Format)” – the file starts with “EXTF”.',
				'Otherwise a CSV or text file with one column for the account number (4–8 digits) and one for the name, separated by semicolon, comma or tab, will do – such as the chart of accounts export from Lexware, sevDesk or Excel.',
				'Your program is not listed or the file is not recognised? Write to us which program you use – we will add it on request.'
			],
			read: 'Import chart of accounts …',
			replace: 'Import another chart of accounts …',
			found: '{count} accounts recognised ({format}), {skipped} lines skipped. The first ones:',
			format: { datev: 'DATEV account labels', csv: 'CSV' },
			take: 'Accept',
			cancel: 'Discard',
			current: 'Imported: {count} accounts from “{file}” on {date}.',
			drop: 'Remove – back to the SKR 03 list',
			nothing:
				'No account was recognised in the file: it needs one column with account numbers (4–8 digits) and one with names.',
			tooLarge: 'The file is larger than 5 MB – is it really the chart of accounts?'
		},
		books: {
			title: 'Bookkeeping (MonkeyOffice / DATEV)',
			hint: 'What the DATEV export needs to know about your bookkeeping. Check the values in MonkeyOffice – it shows what it expects on import.',
			ledger: 'Ledger account in MonkeyOffice',
			ledgerHint:
				'The ledger account under which this bank account is kept in your bookkeeping. Suggestion per SKR 03: {suggestion} – only a placeholder, enter the number from MonkeyOffice.',
			noAccounts: 'No bank accounts in the books yet.',
			vatPeriod: 'Advance VAT return',
			vatPeriods: { quarter: 'quarterly', month: 'monthly' },
			smallBusiness: 'Small business (Kleinunternehmer, §19 UStG)',
			vatHint:
				'The input VAT card on Home follows this. As a small business you charge no VAT and deduct none.',
			legalForm: 'Legal form',
			legalFormUnset: 'not specified yet',
			legalForms: {
				sole: 'Sole proprietorship',
				partnership: 'Partnership (GbR, OHG, KG)',
				corporation: 'Corporation (UG, GmbH)'
			},
			shareholderAccount: 'Shareholder clearing account',
			legalFormHint:
				'Determines how a private payment from the business account is booked (“Private (misdirected)”): for sole proprietorships and partnerships as a private withdrawal (1800), a repayment as a private contribution (1890); UG and GmbH have no private withdrawals – the company paid for you, a claim on the shareholder clearing account that you pay back. Set the account number with your tax advisor.',
			consultant: 'Advisor number',
			client: 'Client number',
			numbersHint:
				'For your own bookkeeping without a tax advisor, MonkeyOffice usually takes 1001 and 1. Check in MonkeyOffice what it expects on DATEV import.',
			fiscalStart: 'Financial year starts in',
			accountLength: 'Ledger account length',
			accountLengthHint: 'Digits of your ledger accounts, usually 4 for SKR 03.',
			taxKeys: 'BU keys',
			taxKeysHint:
				'The keys the app suggests from the receipt. Preset per SKR 03; only change them after consulting your tax advisor.',
			input19: 'Input VAT 19 %',
			input7: 'Input VAT 7 %',
			output19: 'Output VAT 19 %',
			output7: 'Output VAT 7 %',
			reverseCharge: '§13b (reverse charge)',
			reverseChargeHint: 'check with your tax advisor',
			invalidLedger: 'A ledger account has 4 to 8 digits: {name}',
			learnedAccount: 'Account {account}'
		},
		save: 'Save',
		saved: 'Saved. Matching now runs with the new instructions.',
		ruleText: '{field} “{contains}” → {action}'
	},
	belege: {
		title: 'Receipts',
		empty: 'No receipts yet. Fetch emails, upload files or share a folder.',
		upload: 'Upload receipts',
		uploadHint: 'PDFs and images, drag and drop them here too.',
		drop: 'Drop to upload',
		folder: 'Share folder',
		folderAgain: 'Read folder “{name}”',
		folderForget: 'Forget folder',
		folderHint: 'The folder is only read. The browser asks for access again in every session.',
		folderDenied: 'The browser was not given read access to the folder.',
		mailTitle: 'Fetch emails',
		mailIntro:
			'Fetches the emails to {address} from the chosen months through the bridge, read-only. Private mail stays in the mailbox.',
		mailFrom: 'From month',
		mailTo: 'To month',
		mailLastYear: 'All of last year',
		mailReadAfter: 'Read new receipts right after fetching',
		trash: {
			button: 'Move mail to the bin',
			confirm:
				'The mail is moved to the bin in the mailbox (not deleted – you can restore it in your mail program). The receipt stays here in the books.',
			yes: 'Yes, move it',
			cancel: 'Cancel',
			busy: 'Moving …',
			done: 'Mail is in the mailbox’s bin (since {date}).'
		},
		scam: {
			badge: 'Suspicious',
			title: 'Possible fraud – please check',
			intro:
				'These signs fit a fake invoice. They are a hint, not a verdict. That is why the receipt is not linked automatically.',
			ok: 'It’s fine',
			okHint:
				'Only if you are sure the invoice is genuine – if in doubt, ask the vendor through the channel you know, not through contact details from this mail.',
			sign: {
				'auth-fail': 'The sender check (SPF/DKIM/DMARC) failed: {detail}',
				lookalike: 'The sender domain looks like that of a known vendor, but is not: {detail}',
				'other-domain': 'This vendor used to write from a different domain: {detail}',
				'new-iban':
					'The invoice names an account ({detail}) that this vendor has never been paid to',
				'free-mail': 'Invoice from a free email address: {detail}',
				pressure: 'Pushy wording: “{detail}”',
				'foreign-links': 'Links to hosts other than the sender: {detail}'
			}
		},
		mailFetch: 'Fetch emails',
		mailFetching: 'Fetching …',
		mailNoBridge: 'For emails and reading receipts, pair the bridge under ',
		mailNoBridgeLink: 'Integrations',
		mailNoBridgeAfter: '.',
		mailNotSetUp:
			'The mailbox is not set up on the bridge: pnpm setup:mail, then restart the bridge.',
		llmNotSetUp: 'Extraction is not set up on the bridge: pnpm setup:llm, then restart the bridge.',
		mailResult: '{mails} emails · new: {new} · already there: {known} · duplicate: {duplicate}',
		mailVerdicts: ' · sender check updated: {count}',
		importResult: 'New: {new} · duplicate: {duplicate} · not supported: {unsupported}',
		sources: 'Sources',
		sourceAll: 'All',
		sourceMail: 'Email {address}',
		sourceUpload: 'Uploaded',
		sourceFolder: 'Folder',
		search: 'Search receipts',
		searchPlaceholder: 'Search: vendor, amount, date, invoice number',
		extractAll: 'Extract all new ({count})',
		extracting: 'Extracting … {done}/{count}',
		extractCancel: 'Cancel',
		extractCancelling: 'Stopping after this receipt …',
		list: 'Receipt list',
		noMatches: 'No receipts for this selection.',
		noDate: 'No date',
		textMail: 'Email without attachment',
		status: {
			new: 'New',
			unassigned: 'Not linked',
			question: 'Question',
			assigned: 'Linked',
			ignored: 'Ignored',
			prepaid: 'Prepaid account'
		},
		unverified: 'Check sender',
		duplicate: {
			badge: 'Duplicate',
			note: 'Duplicate: invoice number {number} already exists – {file} from {date}, {linked}. The files differ, but the content is the same invoice.',
			linked: 'linked to a payment',
			unlinked: 'not linked yet',
			setAside: 'Set aside as duplicate'
		},
		setAside: {
			action: 'Set aside – not a receipt',
			title:
				'Stays out of matching and out of the export; any link is removed. Can be taken back in.',
			duplicate: 'Set aside as duplicate.',
			notNeeded: 'Set aside – not a receipt.',
			restore: 'Take back in'
		},
		origin: {
			label: 'How linked',
			filter: {
				all: 'All',
				auto: 'Automatic',
				confirmed: 'Confirmed',
				manual: 'By hand',
				ai: 'AI find',
				open: 'Not linked'
			},
			badge: {
				auto: 'Automatic · {score} pts',
				'auto-learned': 'Automatic (learned) · {score} pts',
				confirmed: 'Confirmed',
				manual: 'By hand'
			},
			ai: 'AI find',
			aiTitle: 'Found with “Keep searching with AI” ({confidence}): {reason}',
			aiTitleNone: 'Found with “Keep searching with AI”',
			month:
				'{auto} automatic · {confirmed} confirmed · {manual} by hand · {ai} AI find · {open} open'
		},
		detail: 'Receipt',
		chooseOne: 'Choose a receipt on the left.',
		warningTitle: 'Sender not confirmed',
		warningFail:
			'This email failed the sender check (DKIM/SPF). It could be fake – a phishing mail made to look like an invoice, for example.',
		warningNone:
			'This email has no passed sender check (DKIM/SPF). Check whether you know the sender.',
		warningAfter: 'The file is only shown and read once you release it.',
		confirm: 'Sender checked – open and release',
		preview: 'Preview',
		previewFailed: 'The preview could not be created.',
		extract: 'Extract',
		extractAgain: 'Extract again',
		extractBusy: 'Extracting …',
		imageGap: 'Image – reading to follow (no text recognition yet).',
		noText: 'No text in the PDF (probably a scan) – reading to follow.',
		fields: {
			vendor: 'Vendor',
			amount: 'Amount',
			date: 'Invoice date',
			invoiceNumber: 'Invoice number',
			summary: 'Content',
			model: 'Extracted with',
			from: 'From',
			subject: 'Subject',
			received: 'Received',
			file: 'File',
			source: 'Source',
			sender: 'Sender check'
		},
		verdict: {
			pass: 'passed',
			fail: 'failed',
			none: 'no result',
			outgoing: 'own email (Sent)'
		},
		sourceName: {
			mail: 'Email',
			upload: 'Uploaded',
			folder: 'Folder',
			portal: 'Customer portal',
			eigenbeleg: 'Eigenbeleg',
			'invoice-app': 'Invoice app (own invoice)'
		},
		recordPortal: 'Record portal for {host}',
		recordPortalHint:
			'The email points to the vendor’s site. Record once how you get to the invoices there – the bridge then fetches them itself. Only the site’s address is used as the start page, never the link from the email.',
		linkedTo: 'Linked to',
		openTx: 'Open payment',
		reminderNote:
			'Payment reminder – does not link a payment by itself. If needed, link it by hand under Payments.',
		how: {
			line: 'Extracted with {model} · {seconds} s · {tokens} tokens · {redactions} spots redacted',
			lineOld: 'Extracted with {model}',
			fallback: 'second attempt with {model}, because {reason}',
			sent: 'Sent to the AI (redacted)',
			sentHint:
				'Exactly this text went from the bridge to the language model. Redacted spots are in square brackets, such as [NAME] or [IBAN …1234].',
			sentMissing:
				'Extracted with an older bridge: which text was sent is not stored. “Extract again” catches up on it.',
			redactions:
				'Redacted: {terms} names, {iban} IBANs, {email} email addresses, {street} streets, {postcode} postcodes and towns, {link} links',
			attempts: 'Attempts: {list}',
			tokens: 'Tokens: {prompt} sent, {completion} returned, {reasoning} of them for reasoning',
			notAi:
				'The AI only reads these fields. Which payment the receipt belongs to is then decided by the app, using points.',
			why: {
				'stopped early: length': 'the answer broke off (token limit reached)',
				'content is not JSON': 'the answer was not JSON',
				'answer is not JSON': 'the answer was not JSON',
				checks: 'the answer did not add up ({detail})',
				http: 'the service reported an error ({detail})',
				unreachable: 'the service could not be reached',
				other: '{detail}'
			}
		},
		technical: [
			'Every file is sealed in the browser with AES-GCM (key via HKDF from the passkey’s PRF response, info belege/blob-key/v1) and stored in 1 MiB blocks in Helia’s blockstore. The app spots duplicates by the SHA-256 of the content, which is only kept in the sealed record.',
			'For reading, only the PDF’s text layer goes to the bridge. The bridge redacts names, IBANs, your own email addresses, streets and postcodes and then asks the language model; the file itself never leaves the browser.'
		]
	},
	verlauf: {
		title: 'History',
		intro:
			'What the app did and what you decided, newest first. The entries are sealed in your books, like everything else.',
		filters: 'Filters',
		all: 'All ({count})',
		group: {
			auslesen: 'Extraction ({count})',
			abgleich: 'Matching ({count})',
			abruf: 'Fetching ({count})',
			entscheidungen: 'Decisions ({count})'
		},
		groupName: {
			auslesen: 'Extraction',
			abgleich: 'Matching',
			abruf: 'Fetching',
			entscheidungen: 'Decision'
		},
		empty: 'Nothing in the history yet.',
		more: 'Show older ({count})',
		openReceipt: 'Open receipt',
		openTx: 'Open payment',
		kind: {
			'bank-sync': 'Transactions fetched',
			'booking-changed': 'Booking changed on fetch',
			'mail-fetch': 'Emails fetched',
			'file-import-upload': 'Receipts uploaded',
			'file-import-folder': 'Folder read',
			'sender-verdict': 'Sender check updated',
			extract: 'Receipt read',
			extractFailed: 'Extraction failed',
			'mail-assist': 'Searched the mailbox with AI',
			'match-assist': 'AI suggestion for a link',
			'transfer-assist': 'AI suggestion for a counter-booking',
			'vendor-assist': 'AI explanation of a vendor account',
			matching: 'Matching',
			decision: 'Decision',
			export: 'DATEV export'
		},
		text: {
			bookingChanged: 'before {from}, now {to}{flipped}{unconfirmed}{receipt}',
			bookingChangedFlipped: ' – the direction has reversed',
			bookingChangedUnconfirmed: ' · account assignment withdrawn',
			bookingChangedReceipt: ' · check receipt',
			bankSync:
				'{source}: {accounts} account(s) · new: {new} · updated: {updated} · skipped: {skipped}',
			mailFetch:
				'{from} to {to}: {mails} emails · new: {new} · already there: {skipped} · duplicate: {duplicate}',
			fileImport: 'new: {new} · duplicate: {duplicate} · not supported: {unsupported}',
			senderVerdict: '{vendor}: {was} → {now}',
			senderReleased: ' – released for reading',
			extract: '{vendor} · {model} · {seconds} s · {tokens} tokens · {redactions} spots redacted',
			extractFallback: ' · second attempt, because {reason}',
			extractFailed: '{vendor}: {error}',
			mailAssist:
				'{model} · {terms} search terms · {domains} senders · {mails} hits · {seconds} s · {tokens} tokens',
			mailAssistPick: ' · suggestion: {confidence}',
			matchAssist: '{model} · {candidates} receipts checked · {seconds} s · {tokens} tokens',
			transferAssist: '{model} · {candidates} bookings checked · {seconds} s · {tokens} tokens',
			vendorAssist: '{model} · {rows} rows checked · {seconds} s · {tokens} tokens',
			export: 'DATEV export {month}: {bookings} bookings, {receipts} receipts',
			matching:
				'{sure} linked · {created} new questions · {resolved} resolved · {classified} need no receipt · {waiting} still waiting',
			today: 'today',
			matchingManual: 'started by you',
			matchingAuto: 'after fetching or reading',
			pairs: 'Linked: {list}'
		},
		verdict: {
			pass: 'passed',
			fail: 'failed',
			none: 'no result',
			outgoing: 'own email'
		},
		decision: {
			confirm: 'Link confirmed',
			link: 'Receipt linked by hand',
			unlink: 'Link removed',
			reject: 'Suggestion rejected',
			'no-receipt': '“No receipt needed” set',
			'bank-fee': 'Classed as bank fee',
			'bank-fee-forget': 'Bank fee forgotten',
			'not-transfer': 'Marked as “not a transfer”',
			'own-transfer-link': 'Linked as counter-booking (own transfer)',
			'swap-link': 'Linked as swap',
			'migration-link': 'Linked as token migration',
			'migration-unlink': 'Token migration removed',
			'manual-rate': 'Rate entered by hand',
			'swap-unlink': 'Swap link removed',
			'refund-link': 'Linked as refund',
			'prepaid-on': 'Kept as prepaid account',
			'share-created': 'Share for an assistant created',
			'share-revoked': 'Share for an assistant revoked',
			'prepaid-off': 'No longer kept as prepaid account',
			'not-refund': 'Marked as “not a refund”',
			'transfer-receipt-kept': 'Receipt of a transfer confirmed',
			'company-name': 'Company name adopted',
			'receipt-duplicate': 'Receipt set aside as duplicate',
			'receipt-set-aside': 'Receipt set aside',
			'receipt-restore': 'Receipt taken back in',
			'needs-receipt': '“No receipt needed” withdrawn',
			'confirm-sender': 'Sender released',
			'scam-cleared': 'Scam suspicion marked as unfounded',
			'mail-trash': 'Mail moved to the bin',
			'upload-link': 'Receipt uploaded and linked to this payment',
			'receipt-moved': 'Receipt moved here from another payment',
			eigenbeleg: 'Eigenbeleg created and linked',
			'aleph-statement': 'Aleph usage proof {number} for {month} created',
			booking: 'Account adopted',
			bookings: 'Automatic accounts adopted',
			answer: 'Question answered: {choice}'
		},
		source: {
			hibiscus: 'Hibiscus',
			camt: 'CAMT import',
			kraken: 'Kraken',
			nyx: 'Wallet (Nym/Nyx)',
			akash: 'Wallet (Akash)',
			ethereum: 'Wallet (Ethereum)',
			base: 'Wallet (Base)',
			arbitrum: 'Wallet (Arbitrum)',
			optimism: 'Wallet (Optimism)',
			polygon: 'Wallet (Polygon)'
		},
		technical: [
			'Every entry is a record in the sealed OrbitDB collection events (AES-GCM like all the others): kind, time, the IDs of receipt, payment, link or question, and numbers – model, duration, tokens, redactions per kind, hits. No token, no key, no receipt text.',
			'It is written by the action itself: syncing, CAMT import, email fetch, reading, matching and every decision. An automatic matching run that changes nothing writes no entry; one started by you always does.'
		]
	},
	booking: {
		title: 'Account',
		intro:
			'Which account this payment is booked to (contra account, SKR 03) and with which BU key. The app suggests, you confirm – only what you have confirmed gets exported.',
		suggestion: 'Suggestion',
		source: {
			transfer: 'Own transfer',
			fee: 'Bank fee',
			private: 'Private (paid by mistake), by legal form',
			learned: 'learned',
			learnedFrom: 'learned from {vendor}',
			confirmed: 'confirmed',
			none: 'No suggestion – pick an account from the list or enter a number.'
		},
		account: 'Contra account',
		accountPlaceholder: 'Number or name, e.g. 4930 or office',
		ownNumber: 'Own account number, not in the catalogue',
		notInChart: 'Not in your chart of accounts – check that the account exists in your bookkeeping',
		chartNote:
			'Suggestions from your imported chart of accounts ({count} accounts). Which account is right is for you to decide with your tax advisor.',
		taxKey: 'BU key',
		taxKeyPlaceholder: 'empty = none',
		taxVia: {
			vat19: 'From the receipt: VAT 19 %',
			vat7: 'From the receipt: VAT 7 %',
			'reverse-charge': 'From the receipt: §13b (reverse charge) – check with your tax advisor',
			'reverse-charge-income':
				'Receipt with reverse charge on income – no key, check with your tax advisor',
			'no-vat': 'The receipt shows no VAT – no key',
			'other-rate': 'The receipt has {rate} % – not a German rate, please check yourself',
			mixed: 'The receipt has several tax rates – please check yourself',
			'no-receipt': 'No receipt, so no key from the receipt',
			automatic: 'Automatic account: the VAT is built into the account, no BU key',
			learned: 'Learned from the vendor',
			confirmed: 'Confirmed',
			none: 'Without VAT'
		},
		confirm: 'Confirm',
		confirmChange: 'Confirm change',
		confirmed: 'Confirmed: {account} · {key} · on {date}',
		keyValue: 'BU {key}',
		keyNone: 'no BU key',
		notConfirmed: 'Not confirmed yet – without a confirmed account this month cannot be exported.',
		invalidAccount: 'An account has 4 to 8 digits.',
		invalidKey: 'A BU key has up to 4 digits.',
		catalogueNote:
			'The account list is a starting point based on SKR 03 – which account is right is for you to decide with your tax advisor.',
		technical: [
			'The confirmation is stored on the payment itself: booking = { account, taxKey, confirmedAt }, sealed like every record.',
			'Suggestions in this order: own transfer → 1360, bank fee → 4970 (both without a key), otherwise the account you last gave this vendor (partners: account, taxKey – via the vendor on the receipt or the counterparty on the bank statement).',
			'The BU key comes from the read receipt: VAT 19 % → 9 (income 3), 7 % → 8 (income 2), reverse_charge → 94; the keys can be changed under Settings → Bookkeeping. None of this asks a language model.'
		]
	},
	export: {
		title: 'Export',
		intro:
			'Once a month: the bookings as a DATEV booking batch for MonkeyOffice and the receipts as PDF, together in one ZIP file. It is created only here in the browser and downloaded to your device – nothing goes to a server.',
		empty: 'No payments yet – connect the bank or import a bank statement first.',
		month: 'Month',
		summary:
			'{bookings} bookings · {lines} in the booking batch · {receipts} receipts and {statements} bank statements in the ZIP',
		settings:
			'Advisor number {consultant} · Client number {client} · Financial year from {fiscal} · Ledger account length {length}',
		settingsLink: 'change under Settings',
		checks: 'Before the export',
		check: {
			unpriced:
				'{count} crypto bookings without a rate – without a euro amount nothing goes into the export. Enter the rate on the booking.',
			unassignedOk: 'Every booking has a confirmed account.',
			unassigned: '{count} bookings without a confirmed account – no export until they have one.',
			autoConfirm: 'Confirm accounts for own transfers and bank fees ({count})',
			autoConfirmHint:
				'Confirms 1360 for own transfers and 4970 for bank fees – the same suggestions as in the payment, with one click for all.',
			ledgerOk: 'Every bank account has its ledger account.',
			noLedger: 'Ledger account missing for {list} – enter it under Settings → Bookkeeping.',
			noBankAccount: '{count} bookings belong to no bank account in the books.',
			missingReceiptOk: 'Every booking has a receipt or a reason why none is needed.',
			missingReceipt:
				'{count} bookings without a receipt and without “No receipt needed” – the export works, but check them.',
			unlinkedOk: 'No receipt from this month is left over.',
			unlinked: '{count} receipts from this month are not linked to any payment.',
			unverifiedOk: 'No receipt is waiting for the sender check.',
			unverified: '{count} receipts with an unconfirmed sender – they are not included in the ZIP.',
			more: '… and {count} more'
		},
		open: 'open',
		download: 'Download DATEV export',
		building: 'Creating ZIP …',
		done: 'Downloaded: {file} – {bookings} bookings, {receipts} receipts, {statements} bank statements.',
		blocked: 'Sort out the items marked in red first.',
		failed: 'The export failed: {error}',
		overview: {
			noReceipt: 'no receipt',
			noFile: 'Receipt {number} without a file (email text)',
			transferLine: 'Own transfer, the counter-booking on {date} is included in this line',
			transferSide: 'not in the booking batch: included in the counter-booking of {date} ({bank})'
		},
		technical: [
			'Booking batch in DATEV format EXTF, version 700, category 21, format version 13: header line with 31 fields, column headings, one line per booking with 125 fields; separator “;”, line ending CRLF, character set Windows-1252 (ANSI).',
			'Account = ledger account of the bank account, contra account = the confirmed account, S = money came in, H = money went out (from the bank account’s point of view); receipt date DDMM = booking day, receipt field 1 = receipt number YYYY-MM-NNN, booking text = vendor or counterparty (at most 60 characters).',
			'An own transfer whose counter-booking is in the books goes in once: from the bank account with the lower ledger account against the ledger account of the other.',
			'The ZIP file is created with fflate in the browser; the receipts are opened from the sealed storage for this. The receipt numbers assigned stay on the receipt (exportNumber), a second export assigns the same ones.'
		]
	},
	copy: {
		copied: 'Copied',
		selected: 'Selected – copy with Ctrl+C or ⌘C',
		failed: 'Copying not possible',
		clickToCopy: 'Click to copy',
		address: 'Copy address',
		hash: 'Copy tx hash',
		iban: 'Copy IBAN',
		ref: 'Copy reference'
	},
	monthPicker: { month: '{label}: month', year: '{label}: year' },
	zahlungen: {
		title: 'Payments',
		addTest: 'Create test booking',
		emptyBefore: 'No payments yet – under ',
		emptyLink: 'Integrations',
		emptyAfter: ' connect the bank or import a bank statement.',
		account: 'Account',
		allAccounts: 'All accounts',
		search: 'Search',
		searchPlaceholder: 'Search: name, amount, date',
		flow: {
			label: 'Only:',
			clear: 'Clear filter',
			'bank-income': 'Income · bank',
			'bank-expenses': 'Expenses · bank',
			'crypto-income': 'Income · crypto',
			'crypto-expenses': 'Expenses · crypto',
			private: 'Private from the business account',
			loan: 'Loans',
			unpriced: 'Crypto without a rate'
		},
		receiptFilter: 'Receipt filter',
		withoutReceipt: 'Only without receipt ({count})',
		withoutAccount: 'Without account ({count})',
		changedFilter: 'Changed on fetch ({count})',
		relatedMark: 'Belongs together with {count} other booking(s)',
		changedBadge: 'changed on fetch',
		parties: 'From {from} → To {to}',
		noAccountBadge: 'no account',
		noReceiptBadge: 'no receipt',
		all: 'All ({count})',
		months: 'Months',
		coverage: 'Receipt coverage {month}',
		coverageText: '{percent} % with receipt',
		noMatches: 'No matches',
		bookings: 'Bookings',
		noneForSelection: 'No payments for this selection.',
		open: 'Open payment',
		trade: 'Swap {arrow} {what}',
		tradeTitle: 'Swapped',
		tradeOpen: 'open the other side',
		time: '{time}',
		detail: {
			changedTitle: 'Changed on fetch on {date}',
			changedText: 'The source now reports this booking differently: before {from}, now {to}.',
			changedFlipped: ' An income became an expense or the other way round.',
			changedAccount:
				' The account assignment was therefore withdrawn – please confirm it again under “Account”.',
			changedReceipt: ' Also check whether the linked receipt still fits.',
			changedOk: 'Checked',
			details: 'Details',
			detailsHide: 'Hide details',
			status: {
				receipt: {
					missing: 'Receipt missing',
					done: 'Receipt ✓',
					'none-needed': 'No receipt needed'
				},
				konto: { missing: 'Account missing', done: 'Account ✓' }
			},
			alt: { toggle: 'No third-party receipt …' },
			next: 'Next step',
			nextKonto: 'Confirm account',
			othersMissing: '{count} without receipt',
			related: {
				title: 'Belongs together with',
				receipt: 'Receipt',
				kind: {
					transfer: 'Own transfer',
					trade: 'Swap',
					migration: 'Migration',
					fee: 'Fee for it',
					refund: 'Refund',
					'fee-of': 'Fee for'
				},
				via: {
					'counter-booking': 'counter-booking',
					reference: 'same reference',
					'own-address': 'own address',
					bridge: 'via bridge',
					'cross-chain': 'via another chain',
					manual: 'linked by you',
					hash: 'same tx hash',
					refid: 'same exchange reference'
				}
			},
			find: {
				title: 'Find receipt',
				label: 'Search receipts',
				placeholder: 'Vendor, amount, invoice number, sender …',
				sources: 'Source',
				tab: {
					passend: 'Matching',
					alle: 'All receipts',
					postfach: 'Private mailbox',
					portal: 'Portal'
				},
				other: 'Search for another receipt',
				open: 'Search for a receipt after all',
				sameAmount: 'Same amount',
				otherCurrency: 'other currency',
				days: '{days} days',
				noMatch: 'Nothing found – change the search text or pick another source.',
				noSuggestion:
					'No receipt scores enough points. “All receipts” lists all open ones; you can keep searching in the mailbox and at the vendor.'
			},
			poisonTitle: 'Warning: possible address poisoning',
			poisonText:
				'The sender address {address} starts and ends like {known}, which you have dealt with, but it is a different one. An address like this is planted in your history with a tiny amount so that you copy it by mistake the next time you send. Never send to this address; always compare the recipient address in full.',
			title: 'Payment',
			close: 'Close',
			date: 'Booking date',
			quantity: 'Quantity',
			valuation: 'Rate',
			eigenbeleg: {
				open: 'Create Eigenbeleg',
				hint: 'For a payment without a receipt from the other side, e.g. fees on a blockchain. An Eigenbeleg (self-made receipt) is not an invoice; whether it is accepted is for your tax advisor to clarify.',
				counterparty: 'Recipient or paying party',
				description: 'What was paid for?',
				reason: 'Why is there no receipt from the other side?',
				create: 'Create Eigenbeleg and link it',
				creating: 'Creating …',
				cancel: 'Cancel',
				createRemote: 'Create via the invoice app',
				creatingRemote: 'The invoice app is creating it …',
				doneRemote:
					'The invoice app has created Eigenbeleg {number}; it is linked to this payment.',
				done: 'Eigenbeleg {number} created and linked to this payment.'
			},
			exchangeType: 'Type at the exchange',
			txRef: 'Reference',
			chainTxRef: 'Transaction hash',
			address: 'Counter address',
			explorer: 'View in block explorer',
			explorerQr: 'QR code',
			valueDate: 'Value date',
			amount: 'Amount',
			account: 'Account',
			bookingType: 'Booking type',
			iban: 'IBAN of the other side',
			purpose: 'Payment reference (full)',
			receipts: 'Receipt',
			noReceipt: 'No receipt linked yet.',
			unlink: 'Unlink',
			assign: 'Link receipt',
			suggestions: 'Suggestions',
			allReceipts: 'All other receipts',
			choose: 'Link',
			noChoices: 'No receipts that can be linked.',
			noReceiptNeeded: 'No receipt needed',
			reason: 'Reason',
			reasonPlaceholder: 'e.g. entertainment, receipt lost',
			save: 'Save',
			cancel: 'Cancel',
			needsReceipt: 'Link a receipt after all',
			bankFee: 'Bank fee – no receipt needed',
			counterOpen: 'Open counter-booking',
			ownName:
				'Is “{name}” your company? On {account} there is the same amount in the other direction on {date}, with the same name – that looks like a transfer between your accounts.',
			ownNameYes: 'Yes, use it as company name',
			ownNameNo: 'No, a vendor',
			notTransfer: 'Not an own transfer – receipt needed',
			unlinkTransfer: 'Unlink – receipt needed',
			notRefund: 'Not a refund – receipt needed',
			linkRefund: 'Link as refund …',
			rate: {
				missing:
					'Rate missing: {reason}. The quantity is booked, the euro amount not yet – enter the rate, or Belege will look for it again on the next fetch.',
				label: 'EUR per {asset}',
				save: 'Enter rate',
				edit: 'Change rate by hand',
				hint: 'Marked as “entered by hand” and not overwritten by later fetches. 0 for a token nobody trades any more. Where the rate comes from (e.g. a DEX pool or a trade) belongs on the receipt as a note.'
			},
			migration: {
				found:
					'Replacement token: {count} incoming payments from whoever triggered this burn, within half a year. Which one is the replacement?',
				link: 'Link as migration',
				none: 'No incoming payment from whoever triggered the burn in the half year after. If the new token came from elsewhere, the burn stays without a counterpart.'
			},
			linkSwap: 'Link as swap …',
			linkSwapTitle:
				'The other side of a swap that no rule recognises – say via another chain or an exchange. Neither side then needs a receipt; for tax purposes a disposal and an acquisition.',
			linkSwapNone: 'No booking in the other direction on another account within 31 days.',
			private: {
				mark: 'Private (paid by mistake) …',
				markTitle:
					'A private payment, paid from the business account by mistake: no business expense, no business expense receipt. A short file note records the mistake; with a UG or GmbH you settle it with a repayment from the private account.',
				noteLabel: 'File note',
				hint: 'Only this one payment – others to the same counterparty stay as they are. You can attach a private invoice as proof of the mistake; it does not count as a business expense.',
				save: 'Record as private',
				title: 'Private (paid by mistake) – not a business expense',
				open: 'Not settled yet: {amount} outstanding.',
				settled: 'Settled.',
				repaidBy: 'Repayment on {date}: {amount}',
				repays: 'Repays the private payment of {date}: {amount}',
				repaymentTitle: 'Repayment of a private payment – not business income',
				repay: 'Link repayment …',
				repayPick: 'Link',
				repayNone: 'No credit in the 180 days around this payment.',
				unlink: 'unlink',
				undo: 'Business after all',
				noLegalForm:
					'The legal form has not been entered yet (Settings → Bookkeeping). Until then Belege treats the payment as for a UG/GmbH: to be settled with a repayment.',
				noClearing:
					'For a UG/GmbH the shareholder clearing account is still missing (Settings → Bookkeeping); agree the number with your tax advisor.'
			},
			linkRefundTitle:
				'This payment and one in the other direction – on the same or another account – are a charge and its refund. Fully refunded, neither needs a receipt; with a partial refund the charge still needs its own. Kept on every matching run.',
			linkRefundNone: 'No booking in the other direction within 120 days.',
			party: { from: 'From', to: 'To', own: 'own', foreign: 'third-party address' },
			linkTransfer: 'Link as counter-booking …',
			twins:
				'{count} bookings with exactly this amount in the opposite direction on your other accounts, in the days around it – and no payment reference says which is the counter-booking. Link the right one by hand.',
			linkTransferTitle:
				'This payment and one on another of your accounts or wallets are the two sides of an own transfer (account 1360): neither needs a receipt. Kept on every matching run.',
			linkTransferSearch: 'Search counter-booking: name, reference, amount …',
			linkTransferPick: 'Link',
			linkTransferAi: 'AI suggestion',
			linkTransferAiTitle:
				'Asks your language model which of these bookings is the other side: for each booking the direction, amount, quantity, day, account type, counterparty and reference – redacted, without addresses, IBANs and hashes. Only a suggestion: nothing is linked until you click.',
			linkTransferAiPick: 'AI suggestion ({confidence}): {reason}',
			linkTransferAiNone: 'AI suggestion: none of these bookings is the other side.',
			linkTransferAiTake: 'Accept',
			linkTransferAiDismiss: 'Dismiss',
			linkTransferNone: 'No booking in the other direction on another account within a month.',
			bankFeeTitle:
				'This booking is a bank charge; the bank statement is the receipt. Matching remembers the payment reference (without numbers) on this account and files the next identical booking by itself. It can be forgotten under Settings → Learned.',
			othersOut: 'More payments to {name}',
			othersIn: 'More payments from {name}',
			othersNone: 'No other payments with this counterparty.',
			withReceipt: 'with receipt',
			withoutReceipt: 'without receipt',
			privateSearch: 'Search the private mailbox',
			privateHint:
				'The bridge searches the whole mailbox for “{text}” and {amount} between {from} and {to}. Only the hits are read.',
			privateHintAmount:
				'The bridge searches the whole mailbox for {amount} between {from} and {to}. Only the hits are read.',
			privateHintCrypto:
				'The bridge searches the whole mailbox between {from} and {to} for the transaction hash, the address and the quantity{text} – what confirmation emails for crypto payments mention. Only the hits are read.',
			privateHintCryptoText: ' as well as for “{text}”',
			memoIn:
				'An incoming payment with memo “{memo}” is usually your own withdrawal from an exchange, where you entered the memo yourself – not a payment to you. The matching exchange booking pairs up via the transaction hash once the exchange has fetched this period.',
			privateSearching: 'Searching …',
			privateNone: 'No hits in the private mailbox.',
			privateHits: '{count} hits',
			criteria: { text: 'search term', sender: 'known sender', amount: 'amount' },
			privateLikely: 'Probably the receipt',
			aiChoice: 'AI suggestion',
			aiChoiceBusy: 'AI is checking …',
			aiChoiceTitle:
				'The bridge sends your configured language model the booking (counterparty, payment reference, amount, day) and up to 25 matching receipts with vendor, amount, date, invoice number and short description – redacted. It names the matching receipt; the linking is up to you.',
			aiChoiceNone: '{model} checked {count} receipts ({seconds} s) and considers none a match',
			aiChoiceModel: 'The language model',
			aiChoiceChecked: 'Which {count} receipts were checked?',
			aiChoiceEmpty: {
				crypto:
					'For a crypto payment only receipts that mention its hash, its address or its quantity qualify – none does. So the language model is not asked.',
				none: 'No read receipt in this direction – the language model would have nothing to check and is not asked.'
			},
			aiSearch: 'Keep searching with AI',
			aiSearching: 'AI is searching …',
			aiSearchTitle:
				'The bridge asks your configured language model twice: 1. counterparty and payment reference (redacted) → search terms and sender domains. 2. subject, sender domain, attachment names and arrival day of the hits (redacted) → which email is the receipt. No email text, no full address.',
			aiSearchHint:
				'No clear hit? The language model suggests search terms and judges the hits – only by subject, sender domain and file names, never by the text of the emails.',
			aiSummary: 'AI search: search terms {terms} · senders {domains} · {count} hits',
			aiSent: 'What went to the language model',
			aiPick: 'AI suggestion ({confidence}): {reason}',
			aiConfidence: { high: 'certain', medium: 'likely', low: 'uncertain' },
			privateMore: 'Show {count} more hits',
			privateMatched: 'matches: {criteria}',
			privateAttachments: 'Attachment: {names}',
			privateNoAttachment: 'no attachment (the email text is used)',
			privateImport: 'Use as receipt',
			privateImporting: 'Adding …',
			privateImported: 'Added as a receipt and extracted.',
			hitOutcome: {
				here: 'It is linked to this payment.',
				linked: 'Linked to this payment – as your decision ({score} points).',
				elsewhere: 'It is already linked to another payment (see below).',
				unverified: 'The sender is not confirmed: check and approve it under Receipts.',
				none: 'None of its receipts can be linked (see below).'
			},
			privateImportedUnverified:
				'Added as a receipt. The sender is not confirmed: check and approve it under Receipts.',
			privateDuplicate: 'This receipt is already in your books.',
			receiptHere: 'is linked to this payment',
			receiptElsewhere: 'linked to {name} of {date} – open',
			receiptConfirmFirst: 'Approve the sender under Receipts first',
			receiptAssign: 'Link to this payment',
			receiptPoints: ' ({score} pts)',
			noBridge: 'To search, pair the bridge under Integrations.',
			vendor: {
				title: 'Fetch from the vendor',
				income:
					'An incoming payment: its receipt is your own outgoing invoice, not a vendor’s invoice. Upload it above or link it.',
				noBridge: 'For this, pair the bridge under Integrations.',
				found:
					'Customer portal “{name}”: fetches the invoices from {since} via the bridge and checks whether one fits this payment.',
				login: 'Sign in to {name}',
				fetch: 'Fetch invoices from {name}',
				fetching: 'Fetching invoices …',
				none: 'There is no customer portal for “{name}” yet. Record it once: sign in, click through to an invoice, download it.',
				result: '{listed} invoices found · new: {new} · already there: {known}.',
				linked: ' One of them is linked to this payment.',
				nothingFits: ' None of the new invoices fits this payment by amount and date.',
				fits: 'Fits this payment: {vendor} · {amount} · {date}',
				assign: 'Link to this payment',
				assigned: 'Linked.',
				technical: [
					'The portal is found for the counterparty by its name or its address. The bridge fetches the invoices from the month before the booking; new ones are stored encrypted as receipts, read (if a language model is set up) and go through the normal matching.',
					'If one fits by amount, date and vendor (at least 40 points), it is offered here; it is only linked when you click, as with uploading.'
				]
			},
			portal: 'Open portal',
			portalFromPurpose: 'from the payment reference',
			portalFromPartner: 'saved with the partner',
			upload: 'Upload receipt and link it to this payment',
			uploadHint:
				'PDF or image, also by drag and drop onto here. The receipt is stored encrypted as under Receipts, read and linked to this payment – as your decision, even with few points.',
			uploading: 'Storing and reading …',
			uploaded: 'Linked: {vendor}',
			uploadedPoints: ' – {line}',
			uploadedDuplicate: ' (this receipt already existed)',
			uploadElsewhere:
				'This file is already the receipt “{vendor}” of another payment: {booking}. Nothing has been linked here and nothing changed there.',
			uploadElsewhereUnknown: 'a payment that has not arrived here yet',
			uploadElsewhereOpen: 'Open other payment',
			uploadMove: 'Move it here – the other one will then lack it',
			uploadMoved: 'Moved: the receipt now belongs to this payment; the other one needs one again.',
			uploadUnsupported: 'This is neither a PDF nor an image.',
			uploadTooLarge: 'The file is larger than 15 MB.',
			uploadReadFailed: 'Extraction failed: {error}',
			warn: {
				amount: 'Warning: the receipt says {receipt}, the payment {tx}.',
				'invoice-number': 'Warning: the invoice number {number} is not in the payment reference.',
				unread: 'The receipt has not been read: amount and invoice number could not be checked.'
			},
			drop: 'Drop: link receipt to this payment',
			folderCheck: 'Check folder now',
			folderChecking: 'Checking the folder …',
			folderResult: 'Folder: {count} new read in and matched.',
			folderNothing: 'Folder: nothing new.',
			folderDenied: 'The browser was not granted read access to the folder.',
			folderHint: 'While the app is open, it checks the shared folder every minute.'
		}
	},
	integrationen: {
		overview: {
			intro: 'What is connected to Belege – and what needs you right now.',
			countOk: 'connected',
			countNeeds: 'need you',
			countOff: 'not set up',
			needsTitle: 'Needs you',
			needKind: { err: 'Error', warn: 'Note' },
			need: {
				bridgeOffline: 'the bridge is not responding. Is it running on this Mac?',
				bridgeOfflineDevices:
					'the bridge is not responding – neither here nor via one of your own devices. Is your Mac with the bridge on and connected?',
				deviceRemoved: 'this device was removed on another one; syncing is off.',
				deviceError: 'syncing reports an error.',
				neverSynced: '{name} is set up but has never been fetched.',
				krakenRefused: 'the last fetch was refused. A new API key usually helps.',
				walletHints: 'the last fetch left notes (wallets with a note: {count}).'
			},
			group: { basis: 'Foundation', sources: 'Accounts & sources', together: 'Collaboration' },
			groupHint: {
				basis: 'runs on this computer',
				basisViaDevice: 'runs via your Mac',
				sources: 'where payments and receipts come from',
				together: 'other apps and people'
			},
			name: {
				bridge: 'Bridge',
				ki: 'AI – reading receipts',
				geraete: 'Own devices',
				bank: 'Bank (Hibiscus, bank statement)',
				kraken: 'Kraken (exchange)',
				wallets: 'Own wallets',
				aleph: 'Aleph Cloud',
				mail: 'Mailbox',
				portale: 'Customer portals',
				'rechnungs-app': 'Invoice app',
				assistent: 'Access for an assistant'
			},
			state: {
				connected: 'connected',
				unpaired: 'not paired',
				error: 'error',
				checking: 'checking',
				setUp: 'set up',
				notSetUp: 'not set up',
				on: 'on',
				off: 'off',
				pending: 'from the next unlock',
				removed: 'removed',
				none: 'none',
				onDemand: 'on demand',
				paired: 'paired',
				notPaired: 'not paired',
				viaDevice: 'via your Mac'
			},
			line: {
				bridge: 'On this Mac; fetches transactions, reads receipts, queries nodes',
				bridgeViaDevice: 'Runs on your Mac; this device uses it via device sync',
				ki: 'Reads vendor, amount, date and number from receipts',
				devicesOn: 'The same books on your devices · {count} connected',
				devicesOff: 'The same books on a phone or second computer',
				bankAccounts: '{count} accounts in the books',
				bankNone: 'Transactions from Hibiscus or a CAMT file',
				kraken: 'The exchange’s ledger, balances and trades, read-only',
				wallets: '{count} wallets, read-only via the address',
				walletsNone: 'Crypto addresses as accounts, read-only',
				aleph: '{count} accounts with credits',
				alephNone: 'Hosting credits of your own Ethereum addresses',
				mail: 'Receipts from the bookkeeping address – under Receipts',
				portals: 'Fetch invoices directly from customer accounts',
				invoiceApp: 'Eigenbelege with your number sequence and letterhead',
				assistant: 'Let someone read one year, redacted, with an expiry'
			},
			when: 'last {when}',
			path: 'Path',
			back: 'All integrations',
			unknown: 'This integration does not exist.',
			settingsMoved: 'Company name, own IBANs, rules, DATEV and chart of accounts are under'
		},
		invoiceApp: {
			title: 'Invoice app',
			intro:
				'Pair Belege with your invoice app (Le Space Rechnungen). It can then create an Eigenbeleg (self-made receipt) for a payment without a receipt – with its number sequence and your letterhead –, and Belege links it to the payment. The connection runs via a relay and is end-to-end encrypted; only the details of that one payment go across.',
			start: 'Connect',
			issued: {
				intro:
					'Your issued invoices come into Receipts as your own invoices, matching links them to incoming payments, and the invoice app learns what is paid – only date and amount, never account or payment reference.',
				sync: 'Sync invoices',
				result:
					'{invoices} invoices in the app, {added} newly taken over, {paid} paid; {reported} payment notices sent to the app.',
				pdfLater:
					'{count} invoices have not arrived yet: their PDF only travels over a direct connection. Try again at the next sync.'
			},
			offHint:
				'Only when you click here does Belege go online: it asks api.aleph.im for the Le Space relays and connects to one; after that only while an invoice app is paired; after unpairing, Belege goes offline again. Who sees what in the process is in the privacy dialog under “Le Space relays”.',
			starting: 'Connecting …',
			failed: 'The connection could not be established:',
			invitation: 'Invitation link from the invoice app (Connections → Invitation)',
			pair: 'Connect with invitation',
			peerId: 'Or: peer ID of the invoice app (Connections → This app)',
			pairByCode: 'Connect by code',
			showCode: 'Type this code into the invoice app and approve it there:',
			busy: 'Connecting …',
			paired: 'Paired since {since}.',
			unpair: 'Unpair',
			ownPeerId: 'Peer ID of Belege:'
		},
		title: 'Integrations',
		bridge: {
			title: 'Bridge',
			check: 'Check status',
			intro:
				'The bridge runs on this computer (127.0.0.1) and fetches transactions from Hibiscus. Accounts whose IBAN is not approved never leave it.',
			checking: 'Checking …',
			online: 'Bridge reachable',
			paired: 'this device is paired',
			unpaired: 'not paired',
			viaDevice: 'via your Mac (own device)',
			viaDeviceHint:
				'This device uses your Mac’s bridge. Pairing, setting up and unpairing happen there; only read-only queries and receipt reading go across from here.',
			noHibiscus: 'Hibiscus is not set up yet',
			offline: 'Bridge not reachable',
			unknown: 'Status unknown',
			url: 'Bridge address',
			code: 'Pairing code',
			pair: 'Pair',
			codeHint: 'The bridge shows the code in the terminal on start-up ({when}).',
			codeHintPaired: 'a device is already paired: restart with --pair',
			codeHintFirst: 'one-time, valid for 10 minutes',
			unpair: 'Remove pairing',
			unpairOffline:
				'The bridge was not reachable: the pairing is only removed on this device. On the bridge, `pnpm bridge -- --revoke-all` removes all pairings.'
		},
		hibiscus: {
			title: 'Hibiscus',
			none: 'No approved accounts.',
			reload: 'Reload',
			lastSync: 'last {date}',
			balanceOn: 'on {date}',
			sync: 'Sync now',
			syncing: 'Syncing …',
			syncHint: 'The first time the last 90 days, after that from the last sync.',
			fromLabel: 'From date (optional)',
			syncHintFrom:
				'Fetches all transactions from this day, as far as Hibiscus has retrieved them from the bank. Existing ones are not created twice.'
		},
		camt: {
			choose: 'Choose bank statement …',
			reading: 'Reading bank statement …',
			title: 'Import bank statement (CAMT.053)',
			intro:
				'For banks without a Hibiscus connection (such as Revolut): the bank statement’s CAMT.053 file. It is only read here in the browser.',
			pending: ' · {count} pending (not imported)'
		},
		ki: {
			title: 'AI – reading receipts',
			simple:
				'The AI only reads receipts: vendor, amount, date, invoice number. Linking them to payments is done by the app itself, traceably by points.',
			keyWhere:
				'The API key lives only in the bridge’s keychain – change it with pnpm setup:llm. It never reaches the browser.',
			noBridge: 'The bridge is not paired: settings only visible after pairing.',
			unreachable: 'The bridge says nothing about receipt reading (older version?): {error}',
			provider: 'Provider (host)',
			models: 'Models',
			modelsValue: '{primary}, on the second attempt {fallback}',
			key: 'API key',
			keyOk: 'set up ✓',
			keyMissing: 'missing – pnpm setup:llm',
			terms: 'Redaction terms',
			authServ: 'Server ID (sender check)',
			authServNone: 'not set – pnpm setup:mail',
			authServNoneHint:
				'Without an ID, the topmost Authentication-Results header of the email counts (your server’s). With an ID, only headers from exactly this server.',
			notSetUp: 'not set up – pnpm setup:llm, then restart the bridge',
			last: 'Last read',
			lastNone: 'never',
			totals: 'So far',
			totalsValue: '{calls} calls · {tokens} tokens',
			totalsFailed: ' · {count} failed',
			totalsFallback: ' · {count}× second attempt',
			verlauf: 'All calls in History',
			technical: [
				'The bridge sends the text layer of a PDF (or the text of an email) to the provider’s OpenAI-compatible chat API (/chat/completions, JSON mode, max_tokens 6000). Beforehand it redacts names from its list, IBANs except the last four digits, own email addresses, streets and postcodes. What was sent is shown on the receipt under “Sent to the AI”.',
				'The answer is checked (gross present, ISO currency, valid dates, net + VAT = gross). If it fails or breaks off, the bridge asks the second model.',
				'Why the key is not entered here: a key in the web page is readable by every script that ever runs on it. In the bridge it lives in the macOS keychain, and no bridge response contains it – GET /llm/status only says “present” or “missing”. Models and terms are also set with pnpm setup:llm.'
			]
		},
		books: {
			title: 'Accounts in the books',
			camt: 'CAMT import',
			hibiscus: 'Hibiscus',
			kraken: 'Kraken',
			wallet: 'Own wallet'
		},
		wallets: {
			title: 'Own wallets',
			intro:
				'Read-only, via the address: the bridge asks a public node of the chain for all transfers and fees of this address and for its balance. Never a key, never a seed phrase. Each asset gets its own account; valued at the daily rate (CoinGecko, Kraken as fallback).',
			source: {
				alchemy:
					'The bridge reads Ethereum, Base, Arbitrum, Optimism and Polygon via Alchemy – with your Alchemy API key, which lives only on this Mac.',
				blockscout:
					'The bridge reads Ethereum, Base, Arbitrum, Optimism and Polygon from Blockscout without a key. That way Blockscout only answers a few queries (observed: about ten per half hour) – even a second sync shortly after can fail with “too many requests”. A free Alchemy key removes this; in the terminal:',
				technicalAlchemy: [
					'Alchemy: alchemy_getAssetTransfers (from and to the address; external, erc20, internal), the gas from the receipts (eth_getTransactionReceipt: gasUsed × effectiveGasPrice), failed transactions and approvals via the nonce (eth_getTransactionCount, eth_getBlockByNumber), the balance via eth_getBalance and alchemy_getTokenBalances. For a token without a CoinGecko rate, additionally its Uniswap pools against ETH and USDC in the block of the booking (eth_call: getPair, getPool, balanceOf, getReserves, slot0; for V4 getSlot0 and getLiquidity on the StateView).',
					'Arbitrum and Optimism: Alchemy has no internal transactions there; the bridge keeps reading those from Blockscout (one query per sync).',
					'A wallet with its own API endpoint is read there, not from Alchemy.',
					'The key lives in the macOS keychain (service belege-bridge, account alchemy) and appears only in the address of requests to Alchemy – never in the log, never in the app; the app only learns that one exists. Alchemy sees the queried addresses and this Mac’s IP address.',
					'Change or delete the key: pnpm setup:alchemy (Enter keeps it, “-” deletes it).'
				],
				technicalBlockscout: [
					'Blockscout’s Etherscan-compatible API without a key: eth_chainId, txlist, txlistinternal, tokentx, balance, tokenbalance – at least six queries per sync; above the limit Blockscout answers with HTTP 429 (WALLET_RATE_LIMIT).',
					'pnpm setup:alchemy asks for the key hidden, checks it with eth_chainId on every network and stores it in the macOS keychain (service belege-bridge, account alchemy). The bridge uses it from the next sync, without a restart; this page shows it after reloading.',
					'In the Alchemy app the networks Ethereum, Base, Arbitrum, OP Mainnet and Polygon PoS must be enabled, otherwise the bridge reports WALLET_ALCHEMY_DENIED.'
				],
				wallet: 'Data source: Alchemy',
				internalVia: 'internal transactions: Blockscout',
				customReplaces:
					'With an Alchemy key the bridge reads via Alchemy; your own endpoint here replaces Alchemy for this wallet.'
			},
			addTitle: 'Add wallet',
			chain: 'Chain',
			address: 'Address',
			addressHint:
				'Only the public address. It stays encrypted in your books and only goes to the node below when syncing.',
			badAddress: 'This is not an address on {chain}.',
			bitcoinHint:
				'Belege reads Bitcoin via the account key (xpub, ypub or zpub). It lives only in the bridge’s keychain: run `pnpm setup:bitcoin` in the terminal, then take it over here. The app only knows its fingerprint.',
			bitcoinTake: 'Take over key from the bridge',
			bitcoinNoKey:
				'The bridge has no Bitcoin key yet: run `pnpm setup:bitcoin` in the terminal and restart the bridge.',
			uses: 'Queried',
			customHint: 'leave empty for the default',
			alternatives: 'Other public ones: {list}',
			explorer: 'Links go to the block explorer {name}.',
			endpoint: {
				rpc: 'RPC',
				rest: 'REST',
				indexer: 'Indexer (older history)',
				api: 'API (Blockscout)',
				apiOwn: 'Own API endpoint (optional; leave empty: Alchemy reads this wallet)'
			},
			meta: {
				name: 'Label (optional)',
				namePlaceholder: 'e.g. project or purpose',
				ledger: 'Account (financial account)',
				costCentre: 'Cost centre (KOST1)',
				hint: 'The label replaces the address on all accounts of this wallet. Account and cost centre apply to all its assets and go into the DATEV export; the cost centre only letters and digits.',
				ledgerShort: 'Account {account}',
				costCentreShort: 'Cost centre {costCentre}',
				edit: 'Label, account, cost centre',
				save: 'Save',
				cancel: 'Cancel'
			},
			own: '(own)',
			default: '(default)',
			add: 'Add',
			addressLink: 'Address in the block explorer',
			lastSync: 'last synced {date}',
			sync: 'Sync',
			syncing: 'Syncing …',
			remove: 'Remove (bookings stay)',
			unpriced:
				'{count} entries without a rate ({assets}) – booked with quantity, the euro amount is still missing (“rate missing” on the booking). Enter it there by hand, otherwise Belege looks for it again at the next fetch.',
			unknownAssets:
				'{count} further tokens or denoms not booked (not in the chain’s list, e.g. IBC vouchers or unknown contracts).',
			pruned:
				'This node only knows the chain from {date}: older bookings are missing. For the whole history, enter an archive node.',
			indexed:
				'The node only knows the chain from {date}; everything before comes from the Akash indexer (console-api.akash.network).',
			unknownAmounts:
				'{count} older transactions with staking rewards, escrow refunds or auto-restake: the indexer does not know their amounts, they are not booked. The balance check shows the gap.',
			indexerFailed: 'The Akash indexer was not reachable; the next fetch asks it again.',
			balanceGap:
				'Booked {booked}, balance {balance}: transactions are missing – older ones the node no longer knows, or tokens from unbonding, which are not a transaction.'
		},
		kraken: {
			title: 'Kraken (exchange)',
			keyProblem:
				'Kraken refuses the query. A new API key that may only “Query Funds” and “Query Ledger Entries” usually helps – in the terminal: pnpm setup:kraken.',
			notSetUp:
				'Not set up yet. Create an API key at Kraken that may only “Query Funds” and “Query Ledger Entries”, and run in the terminal:',
			intro:
				'Read-only: Belege fetches the ledger via the bridge and keeps a separate account for each asset. Amounts are valued at Kraken’s EUR rate (CoinGecko as fallback), a trade against euros at the price of the trade.',
			lastSync: 'last synced {date}',
			balanceOn: 'as of {date}',
			fromLabel: 'From date (empty: since the last fetch, the first time from 1 January)',
			sync: 'Sync Kraken',
			syncing: 'Syncing …',
			syncHint:
				'Fetches the ledger from one week before the last fetch; entries already known are skipped. Only a fetch from an earlier day adds older entries.',
			noHashes:
				'Kraken did not hand over the deposit and withdrawal lists: the bookings have no transaction hash and are not paired with your wallets. Is the API key allowed “Query Funds”? Details are in the bridge’s log.',
			syncHintFrom: 'Fetches the ledger from the chosen day.',
			unpriced:
				'{count} entries without a rate – booked, the euro amount is still missing (“rate missing” on the booking):'
		},
		counts: 'New: {new} · Updated: {updated} · Skipped: {skipped}'
	}
};
