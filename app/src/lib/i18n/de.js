// Every string the interface shows, in German. An English catalogue follows
// this shape key for key; see ./index.js.
//
// Plain text only: components render these with `{...}`, never `{@html}`, so a
// sentence here cannot carry markup. Where a sentence needs a link or a code
// span, it is split around it (`…Before`, `…After`).
export default {
	app: {
		name: 'Le Space Belege',
		// The name in two parts, so a phone can set it on two lines.
		maker: 'Le Space',
		product: 'Belege',
		tagline: 'Zahlungen und Belege, nur auf diesem Gerät'
	},
	nav: {
		label: 'Hauptnavigation',
		home: 'Home',
		zahlungen: 'Zahlungen',
		belege: 'Belege',
		export: 'Export',
		integrationen: 'Integrationen'
	},
	header: {
		did: 'Deine DID (der öffentliche Schlüssel deines Passkeys)',
		localOnly: 'Nur dieses Gerät',
		localOnlyTitle: 'Netzwerk aus: kein Peer-to-Peer, kein Relay, kein Server. Mehr dazu …',
		localFirst: 'Le Space: der Local-First-Stack hinter dieser App'
	},
	theme: {
		toLight: 'Zum hellen Modus wechseln',
		toDark: 'Zum dunklen Modus wechseln',
		light: 'Heller Modus',
		dark: 'Dunkler Modus'
	},
	technical: {
		on: 'Einfach',
		off: 'Technisch',
		title: 'Zwischen einfacher und technischer Erklärung wechseln',
		tag: 'Technisch'
	},
	pageQr: {
		open: 'Diese Seite als QR-Code',
		dialog: 'QR-Code dieser Seite',
		hint: 'Mit dem Telefon scannen – öffnet genau diese Seite.'
	},
	footer: {
		madeWith: 'Gebaut mit',
		build: 'Stand',
		source: 'Quellcode',
		privacy: 'Datenschutz & Technik'
	},
	consent: {
		title: 'Bevor du anfängst',
		intro:
			'Le Space Belege bringt deine Kontoumsätze und Belege zusammen. Hier steht, wo deine Daten liegen und was diesen Rechner verlässt – kurz für alle, und mit dem Schalter „Technisch“ im Detail.',
		earlyHeading: 'Noch früh.',
		earlyBody:
			'Le Space Belege ist in Entwicklung. Bewahre Kontoauszüge und Belege weiterhin auch anderswo auf.',
		technicalHeading: 'Unter der Haube',
		identity: {
			title: 'Identität: dein Passkey',
			simple: [
				'Ohne Passkey geht nichts. Dein Passkey ist deine Identität: Er meldet dich an und schließt deine Bücher auf. Einen Benutzernamen oder ein Passwort gibt es nicht.',
				'Dein Passkey muss eine Zusatzfunktion namens PRF können, aus der der Schlüssel für deine Daten entsteht. Kann er das nicht, bleiben die Bücher zu.'
			],
			technical: [
				'Ein WebAuthn-Passkey mit P-256 (ES256), auffindbar gespeichert. Deine DID (did:key:…) ist sein öffentlicher Schlüssel, gebildet von @le-space/orbitdb-identity-provider-webauthn-did. Der private Schlüssel verlässt den Authenticator nie.',
				'Die PRF-Erweiterung (CTAP hmac-secret) ist Pflicht. Liefert der Authenticator kein PRF-Geheimnis, bricht der Start ab; einen unverschlüsselten Ersatzweg gibt es nicht.',
				'Passkey-Abfragen: Anlegen 3, Entsperren 1, Wiederherstellen auf einem neuen Gerät 4.'
			]
		},
		storage: {
			title: 'Speicherung: nur in diesem Browser, immer verschlüsselt',
			simple: [
				'Deine Buchungen, Belege und Einstellungen liegen nur in diesem Browser auf diesem Gerät – nirgends sonst, auch nicht bei uns.',
				'Alles ist verschlüsselt, mit einem Schlüssel, den dein Passkey bei jedem Entsperren neu erzeugt. Der Schlüssel selbst wird nie gespeichert.'
			],
			loss: 'Verlierst du den Passkey, verlierst du den Zugang zu deinen Daten. Niemand kann sie dann wiederherstellen, auch wir nicht. Löschst du die Website-Daten dieses Browsers, sind sie ebenfalls weg.',
			lossHeading: 'Wichtig:',
			technical: [
				'Aus der PRF-Antwort des Passkeys leitet HKDF-SHA-256 den AES-GCM-Schlüssel ab, mit dem jede Datenbank versiegelt ist (info belege/db-key/v1), und die Namen der Datenbanken (belege/db-name/v1:<Sammlung>), damit sich keine Adresse aus der DID erraten lässt. Nichts davon wird gespeichert.',
				'Kein privater Schlüssel liegt auf dem Gerät: Den OrbitDB-Signaturschlüssel (secp256k1) leitet der Identity-Provider bei jedem Entsperren aus derselben PRF-Antwort ab. Er lebt nur im Arbeitsspeicher dieser Sitzung.',
				'Gespeichert werden die OrbitDB-Dokumentdatenbanken transactions, receipts, partners, accounts und settings, auf Helia mit LevelBlockstore und LevelDatastore in IndexedDB (belege/helia-blocks, belege/helia-data, belege/orbitdb). Jeder Eintrag ist mit AES-GCM verschlüsselt, Belegdateien mit einem eigenen Schlüssel (belege/blob-key/v1).',
				'Im localStorage liegt nur Öffentliches: die Angaben zum Passkey (Credential-ID, öffentlicher Schlüssel, DID, PRF-Eingabe), die Signatur des Passkeys über das Identitätsdokument und drei Merker dieser Seite (Hinweis gelesen, Hell/Dunkel, Technisch).'
			]
		},
		network: {
			title: 'Netzwerk: aus',
			simple: [
				'Le Space Belege verbindet sich mit niemandem. Kein Peer-to-Peer, kein Relay, kein Server: Deine Bücher verlassen diesen Browser nicht.'
			],
			options: 'Einstellungen',
			collaboration: 'Zusammenarbeit',
			collaborationText:
				'Gemeinsame Bücher mit Kolleginnen, Kollegen oder der Steuerberatung, Chat und später Video. Das kommt später und wird dann hier ausdrücklich eingeschaltet – nicht vorher und nicht von selbst.',
			technical: [
				'Im Browser läuft ein libp2p-Knoten, weil OrbitDB einen braucht – ohne Transporte, ohne Bootstrap-Liste und ohne Peer-Discovery. Er kann niemanden anwählen und hört auf keiner Adresse.',
				'Sein Peer-Schlüssel (Ed25519) entsteht in jeder Sitzung neu und wird nirgends gespeichert.',
				'Die Seite lädt keine Schriften, Skripte oder Bilder von Dritten.'
			]
		},
		services: {
			title: 'Externe Dienste',
			simple: ['Nur wenn du sie benutzt, und nur mit dem, was hier steht.'],
			leaves: 'Was den Rechner verlässt:',
			bridge: {
				name: 'Bridge auf diesem Rechner (127.0.0.1)',
				text: 'Holt Umsätze aus Hibiscus und Belege aus deinem Postfach. Bei der App kommen nur Konten an, die du auf der Bridge freigegeben hast, und nur E-Mails an die Buchhaltungsadresse.',
				leaves:
					'Die Bridge fragt dein Postfach (IMAP) ab und schickt zum Auslesen geschwärzten Text an das Sprachmodell (siehe unten). Die Verbindung zur GLS Bank (FinTS) baut Hibiscus auf.',
				technical:
					'Die Bridge hört nur auf 127.0.0.1 (Port 8765) und startet auf keiner anderen Adresse. Gekoppelt wird mit einem Einmalcode; das Bearer-Token liegt verschlüsselt in den Einstellungen der App, auf der Bridge nur sein Hash. CORS lässt nur die eingetragenen App-Adressen zu, der Host-Header muss 127.0.0.1 oder localhost sein. Das Zertifikat von Jameica ist gepinnt; Hibiscus-Passwort, IMAP-Token und API-Schlüssel liegen im macOS-Schlüsselbund. Konten ohne freigegebene IBAN-Endung werden gar nicht erst abgefragt. Postfächer öffnet die Bridge nur lesend.'
			},
			camt: {
				name: 'Kontoauszug-Import (CAMT.053)',
				text: 'Die Datei wird nur hier im Browser gelesen.',
				leaves: 'Nichts. Die Datei wird nicht hochgeladen.',
				technical:
					'Gelesen mit DOMParser im Browser. Vom Konto bleiben die letzten vier Stellen der IBAN und ein Hash davon.'
			},
			enableBanking: {
				name: 'Enable Banking',
				text: 'Geplant für Banken ohne Hibiscus: ein Kontoinformationsdienst mit EU-Lizenz.',
				leaves: 'Deine Umsätze würden über seine Server laufen.',
				technical:
					'Ein Kontoinformationsdienst (AIS) nach PSD2: Nach deiner Freigabe bei der Bank ruft er Konten und Umsätze ab und reicht sie weiter; sie passieren dabei seine Server. Bisher nur in einem Versuch (spikes/enablebanking), in der App nicht eingebaut.'
			},
			deepseek: {
				name: 'DeepSeek (Belege auslesen)',
				text: 'Liest Betrag, Datum und Rechnungsnummer aus Belegen – nur wenn du „Auslesen“ drückst.',
				leaves:
					'Nur geschwärzter Text eines Belegs, ohne Namen und Anschriften. Die Server stehen außerhalb der EU.',
				technical:
					'Die Bridge schickt nur die Textebene eines PDFs (oder den Text einer E-Mail) mit Betreff und Absender, nachdem sie Namen aus ihrer Liste, IBANs (bis auf die letzten vier Stellen), eigene E-Mail-Adressen, Straßen und Postleitzahlen geschwärzt hat – nie die Datei selbst. DeepSeek betreibt seine Server in China. Der API-Schlüssel liegt im macOS-Schlüsselbund der Bridge, nie im Browser. E-Mails von Absendern ohne bestandene DKIM/SPF-Prüfung liest die Bridge erst nach deiner Freigabe aus.'
			}
		},
		status: {
			off: 'aus',
			active: 'aktiv',
			whenPaired: 'wenn gekoppelt',
			planned: 'geplant',
			notYet: 'noch nicht aktiv',
			whenSetUp: 'wenn eingerichtet'
		},
		where: {
			heading: 'Was wo liegt',
			items: [
				'In diesem Browser: deine Bücher, verschlüsselt.',
				'In diesem Browser, lesbar: die öffentlichen Angaben zu deinem Passkey und drei Merker dieser Seite.',
				'Auf deinem Passkey: der einzige Schlüssel zu allem.',
				'Auf diesem Rechner außerhalb des Browsers, nur wenn du die Bridge einrichtest: ihre Einstellungen, das Hibiscus-Passwort, das IMAP-Token und der API-Schlüssel im Schlüsselbund.',
				'Bei uns: nichts. Wir betreiben keinen Server und bekommen keine Kopie.'
			],
			cookies: 'Keine Cookies, kein Tracking.'
		},
		proceed: 'Verstanden',
		close: 'Schließen',
		reopenHint:
			'Du findest diesen Hinweis jederzeit unten auf der Seite unter „Datenschutz & Technik“.'
	},
	onboarding: {
		title: 'Deine Bücher aufschließen',
		intro:
			'Deine Buchhaltungsdaten bleiben auf diesem Gerät und werden mit einem Schlüssel aus deinem Passkey verschlüsselt. Ohne den Passkey kann niemand sie lesen – auch wir nicht.',
		unlock: 'Mit gespeichertem Passkey entsperren',
		newHeading: 'Neu hier',
		label: 'Name für den Passkey',
		labelPlaceholder: 'z. B. Firma Mustermann',
		labelHint:
			'Nur eine Beschriftung in der Passkey-Auswahl. Die Identität kommt aus dem Schlüssel, nicht aus diesem Namen.',
		create: 'Passkey anlegen',
		restoreHeading: 'Schon einen Passkey?',
		restore: 'Mit vorhandenem Passkey wiederherstellen',
		busy: 'Bitte den Passkey bestätigen …'
	},
	home: {
		morning: 'Guten Morgen',
		day: 'Guten Tag',
		evening: 'Guten Abend',
		intro: 'Hier steht, was in deinen Büchern liegt.',
		transactions: 'Zahlungen',
		receipts: 'Belege',
		partners: 'Partner',
		identity: 'Deine Identität',
		identityHint:
			'Die DID ist der öffentliche Schlüssel deines Passkeys. Sie verrät nichts über deine Daten.',
		technical: [
			'Die Bücher sind fünf OrbitDB-Dokumentdatenbanken (transactions, receipts, partners, accounts, settings), jeder Eintrag mit AES-GCM versiegelt; Beträge in ganzen Cent, gelöscht wird weich (deleted).',
			'Schlüssel und Datenbanknamen kommen per HKDF-SHA-256 aus der PRF-Antwort des Passkeys und werden bei jedem Entsperren neu abgeleitet.'
		]
	},
	belege: {
		title: 'Belege',
		empty: 'Noch keine Belege. E-Mails abrufen, Dateien hochladen oder einen Ordner freigeben.',
		upload: 'Belege hochladen',
		uploadHint: 'PDFs und Bilder, auch per Drag & Drop hierher.',
		drop: 'Loslassen zum Hochladen',
		folder: 'Ordner freigeben',
		folderAgain: 'Ordner „{name}“ einlesen',
		folderForget: 'Ordner vergessen',
		folderHint:
			'Der Ordner wird nur gelesen. Die Freigabe fragt der Browser in jeder Sitzung neu ab.',
		folderDenied: 'Der Browser hat keinen Lesezugriff auf den Ordner erhalten.',
		mailTitle: 'E-Mails abrufen',
		mailIntro:
			'Holt über die Bridge die E-Mails an {address} aus den gewählten Monaten, nur lesend. Private Post bleibt im Postfach.',
		mailFrom: 'Von Monat',
		mailTo: 'Bis Monat',
		mailFetch: 'E-Mails abrufen',
		mailFetching: 'Rufe ab …',
		mailNoBridge: 'Für E-Mails und das Auslesen die Bridge unter ',
		mailNoBridgeLink: 'Integrationen',
		mailNoBridgeAfter: ' koppeln.',
		mailNotSetUp:
			'Das Postfach ist auf der Bridge nicht eingerichtet: pnpm setup:mail, dann die Bridge neu starten.',
		llmNotSetUp:
			'Das Auslesen ist auf der Bridge nicht eingerichtet: pnpm setup:llm, dann die Bridge neu starten.',
		mailResult: '{mails} E-Mails · neu: {new} · schon vorhanden: {known} · doppelt: {duplicate}',
		importResult: 'Neu: {new} · doppelt: {duplicate} · nicht unterstützt: {unsupported}',
		sources: 'Quellen',
		sourceAll: 'Alle',
		sourceMail: 'E-Mail {address}',
		sourceUpload: 'Hochgeladen',
		sourceFolder: 'Ordner',
		search: 'Belege durchsuchen',
		searchPlaceholder: 'Suchen: Anbieter, Betrag, Datum, Rechnungsnummer',
		extractAll: 'Alle neuen auslesen ({count})',
		extracting: 'Lese aus … {done}/{count}',
		list: 'Belegliste',
		noMatches: 'Keine Belege für diese Auswahl.',
		noDate: 'Ohne Datum',
		textMail: 'E-Mail ohne Anhang',
		status: {
			new: 'Neu',
			unassigned: 'Nicht zugeordnet',
			question: 'Rückfrage',
			assigned: 'Zugeordnet',
			ignored: 'Ignoriert'
		},
		unverified: 'Absender prüfen',
		detail: 'Beleg',
		chooseOne: 'Einen Beleg links auswählen.',
		warningTitle: 'Absender nicht bestätigt',
		warningFail:
			'Diese E-Mail hat die Absenderprüfung (DKIM/SPF) nicht bestanden. Sie könnte gefälscht sein – etwa eine Phishing-Mail, die wie eine Rechnung aussieht.',
		warningNone:
			'Für diese E-Mail liegt keine bestandene Absenderprüfung (DKIM/SPF) vor. Prüfe, ob du den Absender kennst.',
		warningAfter: 'Die Datei wird erst angezeigt und ausgelesen, wenn du sie freigibst.',
		confirm: 'Absender geprüft – öffnen und freigeben',
		preview: 'Vorschau',
		previewFailed: 'Die Vorschau ließ sich nicht erzeugen.',
		extract: 'Auslesen',
		extractAgain: 'Erneut auslesen',
		extractBusy: 'Lese aus …',
		imageGap: 'Bild – Auslesen folgt (noch keine Texterkennung).',
		noText: 'Kein Text im PDF (vermutlich ein Scan) – Auslesen folgt.',
		fields: {
			vendor: 'Anbieter',
			amount: 'Betrag',
			date: 'Rechnungsdatum',
			invoiceNumber: 'Rechnungsnummer',
			summary: 'Inhalt',
			model: 'Ausgelesen mit',
			from: 'Von',
			subject: 'Betreff',
			received: 'Eingegangen',
			file: 'Datei',
			source: 'Quelle',
			sender: 'Absenderprüfung'
		},
		verdict: {
			pass: 'bestanden',
			fail: 'nicht bestanden',
			none: 'keine Angabe',
			outgoing: 'eigene E-Mail (Gesendet)'
		},
		sourceName: { mail: 'E-Mail', upload: 'Hochgeladen', folder: 'Ordner' },
		technical: [
			'Jede Datei wird im Browser mit AES-GCM versiegelt (Schlüssel per HKDF aus der PRF-Antwort des Passkeys, info belege/blob-key/v1) und in 1-MiB-Blöcken in Helias Blockstore abgelegt. Doppelte erkennt die App am SHA-256 des Inhalts, der nur im versiegelten Datensatz steht.',
			'Zum Auslesen geht nur die Textebene des PDFs an die Bridge. Die Bridge schwärzt Namen, IBANs, eigene E-Mail-Adressen, Straßen und Postleitzahlen und fragt dann das Sprachmodell; die Datei selbst verlässt den Browser nicht.'
		]
	},
	export: {
		title: 'Export',
		empty: 'Der monatliche DATEV-Export folgt in einem späteren Schritt.'
	},
	zahlungen: {
		title: 'Zahlungen',
		addTest: 'Testbuchung anlegen',
		emptyBefore: 'Noch keine Zahlungen – unter ',
		emptyLink: 'Integrationen',
		emptyAfter: ' die Bank anbinden oder einen Kontoauszug importieren.',
		account: 'Konto',
		allAccounts: 'Alle Konten',
		search: 'Suchen',
		searchPlaceholder: 'Suchen: Name, Betrag, Datum',
		receiptFilter: 'Belegfilter',
		withoutReceipt: 'Nur ohne Beleg ({count})',
		all: 'Alle ({count})',
		months: 'Monate',
		coverage: 'Belegabdeckung {month}',
		coverageText: '{percent} % mit Beleg',
		noMatches: 'Keine Treffer',
		bookings: 'Buchungen',
		noneForSelection: 'Keine Zahlungen für diese Auswahl.'
	},
	integrationen: {
		title: 'Integrationen',
		bridge: {
			title: 'Bridge',
			check: 'Status prüfen',
			intro:
				'Die Bridge läuft auf diesem Rechner (127.0.0.1) und holt Umsätze aus Hibiscus. Konten, deren IBAN nicht freigegeben ist, verlassen sie nie.',
			checking: 'Prüfe …',
			online: 'Bridge erreichbar',
			paired: 'dieses Gerät ist gekoppelt',
			unpaired: 'nicht gekoppelt',
			noHibiscus: 'Hibiscus ist noch nicht eingerichtet',
			offline: 'Bridge nicht erreichbar',
			unknown: 'Status unbekannt',
			url: 'Bridge-Adresse',
			code: 'Kopplungscode',
			pair: 'Koppeln',
			codeHint: 'Den Code zeigt die Bridge beim Start im Terminal an ({when}).',
			codeHintPaired: 'schon ein Gerät gekoppelt: mit --pair neu starten',
			codeHintFirst: 'einmalig, 10 Minuten gültig',
			unpair: 'Kopplung lösen',
			unpairOffline:
				'Die Bridge war nicht erreichbar: Die Kopplung ist nur auf diesem Gerät gelöst. Auf der Bridge entfernt `pnpm bridge -- --revoke-all` alle Kopplungen.'
		},
		hibiscus: {
			title: 'Hibiscus',
			none: 'Keine freigegebenen Konten.',
			reload: 'Neu laden',
			lastSync: 'zuletzt {date}',
			balanceOn: 'am {date}',
			sync: 'Jetzt synchronisieren',
			syncing: 'Synchronisiere …',
			syncHint: 'Beim ersten Mal die letzten 90 Tage, danach ab der letzten Synchronisierung.',
			fromLabel: 'Ab Datum (optional)',
			syncHintFrom:
				'Holt alle Umsätze ab diesem Tag, soweit Hibiscus sie von der Bank abgerufen hat. Schon vorhandene werden nicht doppelt angelegt.'
		},
		camt: {
			title: 'Kontoauszug importieren (CAMT.053)',
			intro:
				'Für Banken ohne Hibiscus-Anbindung (etwa Revolut): die CAMT.053-Datei des Kontoauszugs. Sie wird nur hier im Browser gelesen.',
			pending: ' · {count} vorgemerkt (nicht importiert)'
		},
		books: {
			title: 'Konten in den Büchern',
			camt: 'CAMT-Import',
			hibiscus: 'Hibiscus'
		},
		counts: 'Neu: {new} · Aktualisiert: {updated} · Übersprungen: {skipped}'
	}
};
