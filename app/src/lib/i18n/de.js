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
		network: {
			both: 'Im Netz: Geräte + Rechnungs-App',
			only: { devices: 'Im Netz: eigene Geräte', 'invoice-app': 'Im Netz: Rechnungs-App' },
			title: 'Netzwerk an – über ein Le-Space-Relay (TLS-WebSocket), Ende zu Ende verschlüsselt:',
			part: {
				devices: {
					connecting: '• Eigene Geräte: verbindet …',
					online: '• Eigene Geräte: im Netz, kein Gerät verbunden',
					connected: '• Eigene Geräte: {count} verbunden',
					failed: '• Eigene Geräte: Fehler – {error}'
				},
				'invoice-app': {
					connecting: '• Rechnungs-App: verbindet …',
					online: '• Rechnungs-App: im Netz, nicht gekoppelt',
					connected: '• Rechnungs-App: gekoppelt',
					failed: '• Rechnungs-App: Fehler – {error}'
				}
			},
			more: 'Was dabei wer sieht …',
			menu: 'Netzwerk',
			paused: 'Netzwerk pausiert',
			pausedTitle:
				'Netzwerk pausiert: keine Verbindung, auch nicht beim nächsten Entsperren – bis du fortsetzt.',
			pausedShort: 'pausiert',
			pause: 'Alles pausieren',
			resume: 'Fortsetzen',
			locked: 'Nach dem Entsperren kannst du hier Verbindungen ein- und ausschalten.',
			devices: 'Eigene Geräte',
			app: 'Rechnungs-App',
			off: 'aus',
			switchOff: 'Aus',
			switchOn: 'Ein',
			switchOnFirst: 'Einschalten …',
			setUp: 'Einrichten …',
			reloadNeeded:
				'Geräte gehen beim nächsten Entsperren online – der Knoten war beim Entsperren offline.',
			reload: 'Jetzt neu laden und entsperren',
			mode: 'Wo sich Geräte treffen',
			modes: {
				public: 'Öffentlich (Le-Space-Relays)',
				qr: 'Ohne Relay, per QR',
				lan: 'Nur im eigenen Netz (Relay in deiner Bridge)',
				both: 'Beides: neue Geräte nur im eigenen Netz oder per QR, danach überall'
			},
			modeHints: {
				public: 'Überall; der Relay sieht IP-Adressen und Zeitpunkte, nie den Inhalt.',
				qr: 'Kein Relay, kein Server: beide Geräte im selben Netz, und nach jedem Neuladen einmal Codes tauschen.',
				lan: 'Geräte treffen sich am Relay deiner Bridge, nur im selben Netz; kein öffentlicher Relay, kein STUN.',
				both: 'Ein Gerät, das die Bücher noch nicht kennen, kommt nur per QR oder über den Relay deiner Bridge herein; bekannte Geräte auch über die öffentlichen Relays.'
			},
			lanUnavailable:
				'Erst auf dem Rechner mit der Bridge `pnpm setup:relay` ausführen, die Bridge neu starten und hier koppeln.',
			modePending: 'Gilt für alle Geräte dieser Bücher, hier ab dem nächsten Entsperren.'
		},
		localFirst: 'Le Space: der Local-First-Stack hinter dieser App'
	},
	assets: {
		// How a rate's source is named in the app (assets/valuation.js).
		sources: {
			coingecko: 'CoinGecko',
			kraken: 'Kraken',
			ecb: 'EZB-Referenzkurs',
			trade: 'Preis des Handels',
			dex: 'DEX-Pool',
			migration: 'Wert der verbrannten alten Token',
			manual: 'von Hand eingetragen'
		},
		valuationLine: '{rate} EUR je {asset} · {source}{when}'
	},
	// Storage and factory reset (issue #212).
	storage: {
		title: 'Speicher & Zurücksetzen',
		intro: 'Was die Bücher in diesem Browser belegen, und wo es liegt.',
		where:
			'Alles liegt im Speicher dieses Browsers für diese Seite (IndexedDB), versiegelt mit einem Schlüssel aus deinem Passkey. Nichts davon liegt bei Le Space.',
		measuring: 'Messe …',
		database: 'Datenbank',
		records: 'Datensätze',
		entries: 'Versionen',
		size: 'Größe',
		entriesHint:
			'Eine Datenbank vergisst nichts: Jede Änderung ist eine neue Version. Die Größe ist geschätzt.',
		databases: {
			transactions: 'Zahlungen',
			receipts: 'Belege (Daten)',
			partners: 'Partner',
			accounts: 'Konten',
			settings: 'Einstellungen',
			matches: 'Zuordnungen',
			questions: 'Rückfragen',
			events: 'Verlauf'
		},
		allDatabases: 'Alle Datenbanken',
		files: 'Belegdateien ({count})',
		other: 'Übriges (Indizes, App-Cache, Verwaltung)',
		total: 'Vom Browser gemeldet',
		quota: 'von {quota} verfügbar',
		persisted: 'Der Browser hält diesen Speicher dauerhaft.',
		notPersisted: 'Der Browser darf diesen Speicher räumen, wenn der Platz knapp wird.',
		persist: 'Dauerhaft speichern',
		elsewhere:
			'Nicht hier: der Passkey (im Passwort-Manager), Kopien auf deinen anderen Geräten, und was die Bridge auf dem Rechner ablegt (~/.config/belege und der Schlüsselbund).',
		technical: {
			databases: 'IndexedDB: {names}',
			caches: 'Cache Storage (App-Hülle): {names}',
			local: 'localStorage ({count} Einträge, nichts Geheimes): {names}',
			none: 'keine'
		},
		reset: {
			title: 'Alles in diesem Browser löschen',
			button: 'Alles in diesem Browser löschen …',
			fromLock: 'Diesen Browser zurücksetzen …',
			what: 'Löscht alle Datenbanken und Belegdateien, die Einstellungen dieser Seite, den App-Cache und den gemerkten Ordner – in diesem Browser, für diese Seite. Danach beginnt Belege wie beim ersten Besuch.',
			staysTitle: 'Das bleibt:',
			stays: [
				'Dein Passkey. Eine Webseite kann ihn nicht löschen; er bleibt im Passwort-Manager und lässt sich dort entfernen.',
				'Kopien auf deinen anderen Geräten. Mit Gerätesync können die Bücher von dort zurückkommen.',
				'Die Bridge mit ihrer Kopplung und ihren Einstellungen, und die Kopplung der Rechnungs-App auf deren Seite.'
			],
			lost: 'Ohne anderes Gerät und ohne Export sind die Bücher danach endgültig weg. Niemand kann sie wiederherstellen.',
			beforeTitle: 'Vorher, wenn du magst:',
			before: {
				export: 'Monate exportieren',
				bridge: 'Bridge-Kopplung lösen',
				invoiceApp: 'Rechnungs-App entkoppeln',
				devices: 'Dieses Gerät bei den anderen entfernen'
			},
			word: 'LÖSCHEN',
			typeLabel: 'Tippe {word}, um zu bestätigen',
			confirm: 'Endgültig löschen',
			cancel: 'Abbrechen',
			running: 'Lösche alles in diesem Browser …',
			blocked:
				'Belege ist noch in einem anderen Tab oder Fenster offen. Schließe es; dann geht es hier weiter.',
			retry: 'Erneut versuchen'
		}
	},
	// Sample books (issue #200, step 3).
	sample: {
		title: 'Beispieldaten.',
		what: 'Alles hier ist erfunden, zum Ausprobieren.',
		remove: 'Beispieldaten entfernen',
		removing: 'Entferne …'
	},
	// The setup checklist on Home (issue #200).
	setup: {
		title: 'Einrichtung',
		intro:
			'Schritt für Schritt bis zum ersten Monat im Export. Was erledigt ist, erkennt Belege selbst.',
		progress: '{done} von {total} erledigt',
		now: 'Jetzt',
		later: 'Später',
		resume: 'Wieder aufnehmen',
		state: { done: 'erledigt', open: 'offen', later: 'später' },
		optional: 'optional',
		needs: { bridge: 'braucht die Bridge', terminal: 'im Terminal' },
		laterTitle: 'Für später ({count})',
		finished: 'Alles Nötige ist eingerichtet oder für später vorgemerkt.',
		settingsHint:
			'Die Einrichtung verschwindet von Home, sobald nichts mehr offen ist; hier bleibt sie.',
		start: {
			title: 'Wie willst du anfangen?',
			intro:
				'Die Wahl lässt sich ändern, solange die Bücher noch leer sind. Einrichten kannst du alles auch später.',
			look: {
				title: 'Erst umsehen',
				text: 'Die App mit erfundenen Beispieldaten ansehen: Zahlungen, Belege und Rückfragen zum Ausprobieren. Ein Klick entfernt sie wieder.'
			},
			file: {
				title: 'Mit einer Kontoauszug-Datei',
				text: 'Einen CAMT.053-Kontoauszug deiner Bank hochladen. Das geht ohne Bridge und ist der schnellste Weg zu echten Zahlungen.'
			},
			bridge: {
				title: 'Vollständig, mit der Bridge',
				text: 'Bank über Hibiscus, Postfach, KI, Börse und Wallets. Braucht einmal das Terminal, etwa 10 Minuten.'
			},
			change: 'Anders anfangen'
		},
		step: {
			passkey: {
				title: 'Passkey absichern',
				why: 'Wer den einzigen Passkey verliert, verliert die Bücher. Ein zweites Gerät mit denselben Büchern sichert sie.',
				time: 'etwa 5 Minuten'
			},
			bridge: {
				title: 'Bridge einrichten',
				why: 'Die Bridge läuft auf deinem Rechner und holt, was ein Browser nicht kann: die Bank über Hibiscus, das Postfach, die KI, Kundenportale, Börse und Wallets.',
				time: 'etwa 10 Minuten'
			},
			payments: {
				title: 'Zahlungen holen',
				why: 'Die Bank über Hibiscus, über Enable Banking oder als CAMT.053-Datei – die geht auch ohne Bridge. Dazu Kraken und eigene Wallets, wenn du sie hast.',
				ways: [
					'Kontoauszug-Datei (CAMT.053): im Online-Banking exportieren und unter Integrationen → Bank hochladen. Sofort, ohne Bridge.',
					'Hibiscus: Banken mit FinTS, über die Bridge; einmal einrichten mit',
					'Enable Banking: Banken in Europa per PSD2, über die Bridge. Eine eigene Anwendung bei Enable Banking anlegen (Redirect-URL: diese App unter /integrationen/bank/verbunden), dann einrichten mit'
				],
				time: 'etwa 5 Minuten'
			},
			receipts: {
				title: 'Belege holen',
				why: 'Aus dem Buchhaltungs-Postfach, per Upload, aus einem Ordner oder von Kundenportalen.',
				time: 'etwa 5 Minuten'
			},
			ai: {
				title: 'KI zum Auslesen',
				why: 'Liest Anbieter, Betrag, Datum und Nummer aus Belegen – mit deinem eigenen Modell in der Bridge, vorher geschwärzt. Ohne KI trägst du das von Hand ein.',
				time: 'etwa 5 Minuten'
			},
			books: {
				title: 'Buchhaltung einstellen',
				why: 'Rechtsform, Beginn des Geschäftsjahres, Berater- und Mandantennummer und das Sachkonto je Konto mit Buchungen. Nötig erst vor dem ersten Export.',
				time: 'etwa 5 Minuten'
			},
			export: {
				title: 'Ersten Monat exportieren',
				why: 'Rückfragen durchgehen, Konten bestätigen, dann das DATEV-Paket eines Monats herunterladen.',
				time: 'je nach Monat'
			},
			more: {
				title: 'Mehr, wenn du es brauchst',
				why: 'Eigene Geräte, die Rechnungs-App oder eine Lese-Freigabe für eine Assistenz.',
				time: 'je nach Wahl'
			}
		},
		bridge: {
			commands: 'Im Terminal, einmal:',
			commandsAfter:
				'Die Bridge zeigt dann einen Kopplungscode. Diese Seite merkt von selbst, wenn sie läuft.',
			copy: 'Befehle kopieren',
			waiting: 'Warte auf die Bridge unter {url} …',
			found: 'Bridge gefunden – jetzt mit dem Code aus dem Terminal koppeln.',
			diagnosis: {
				origin:
					'Die Bridge läuft, lässt aber diese Seite ({origin}) nicht herein. Trag die Adresse in ~/.config/belege/bridge.json unter appOrigins ein und starte die Bridge neu.',
				mixed:
					'Eine https-Seite darf eine http-Adresse nur auf diesem Rechner fragen (127.0.0.1). Starte die Bridge auf diesem Rechner oder öffne die App lokal (pnpm dev).',
				'bad-url': 'Das ist keine Adresse. Üblich ist http://127.0.0.1:8765.',
				unreachable:
					'Unter {url} antwortet nichts. Läuft die Bridge (pnpm bridge)? Stimmt der Port? Blockiert der Browser die Anfrage, hilft die lokal geöffnete App (pnpm dev).'
			},
			more: 'Die Bridge im Detail (Hibiscus, Postfach, Schlüsselbund)'
		}
	},
	// Messages the code throws or shows, moved here from the modules (#192).
	messages: {
		sync: {
			off: 'Die Synchronisation ist auf diesem Gerät nicht an.',
			notProved:
				'Das andere Gerät hat den Passkey nicht bewiesen – es gehört nicht zu diesen Büchern.',
			noQrSession: 'Ohne Relay verbinden geht erst nach dem Entsperren in diesem Modus.',
			notQrCode: 'Das ist kein Code zum Verbinden ohne Relay.',
			unknownMode: 'Unbekannter Modus: {mode}',
			bothNeedsLocal:
				'In „Beides“ kommt ein neues Gerät per QR-Code oder über den Relay deiner Bridge dazu – hier ist keiner eingerichtet.',
			deviceLabel: '{browser} auf {system}',
			removed: 'Dieses Gerät wurde entfernt.',
			notDeviceId: 'Das ist keine Gerätekennung.',
			removeFromOther: 'Ein Gerät wird von einem anderen aus entfernt.'
		},
		passkey: {
			createFailed: 'Der Passkey konnte nicht angelegt werden.',
			notFound: 'Auf diesem Gerät wurde kein Passkey für Belege gefunden.',
			notStored: 'In diesem Browser ist kein Passkey gespeichert.',
			noPrf:
				'Dieser Passkey liefert kein PRF-Geheimnis. Belege verschlüsselt alle Daten mit einem Schlüssel aus diesem Geheimnis und öffnet ohne ihn keine Daten. Bitte einen Passkey in einem Browser und Passwort-Manager mit PRF-Unterstützung verwenden (z. B. aktuelles Chrome, Safari oder Firefox mit iCloud-Schlüsselbund, Google Passwortmanager oder 1Password).'
		},
		receipts: {
			senderUnconfirmed: 'Der Absender ist nicht bestätigt: erst prüfen und freigeben.'
		},
		booking: {
			accountDigits: 'Ein Konto hat 4 bis 8 Ziffern.',
			taxKeyDigits: 'Ein BU-Schlüssel hat bis zu 4 Ziffern.',
			rateFormat: 'Der Kurs ist eine Zahl ab 0, z. B. 0,0042 – oder 0 für einen wertlosen Token.',
			rateAmbiguous:
				'„{value}“ kann beides sein: mit Tausenderpunkt oder mit drei Nachkommastellen – ein Unterschied um das Tausendfache. Schreib den Kurs ohne Tausendertrennzeichen (58123) oder mit einer Nachkommastelle mehr (2,3450).',
			rateNoQuantity: 'Diese Buchung hat keine Menge, zu der ein Kurs gehört.'
		},
		camt: {
			notXml: 'Die Datei ist kein gültiges XML.',
			notCamt: 'Die Datei ist kein CAMT.053-Kontoauszug (BkToCstmrStmt fehlt).',
			noIban: 'Der Kontoauszug nennt keine IBAN (Acct/Id/IBAN).',
			noAmount: 'Buchung ohne Betrag am {date}'
		},
		bridge: {
			unreachable:
				'Die Bridge ist nicht erreichbar (läuft sie, und ist diese Adresse in appOrigins erlaubt?).',
			unknownDevice: 'Die Bridge kennt dieses Gerät nicht (neu koppeln).',
			originNotAllowed: 'Diese App-Adresse ist in der Bridge nicht erlaubt.',
			wrongCode: 'Falscher Kopplungscode.',
			noCode: 'Kein Kopplungscode aktiv: Bridge mit --pair neu starten.',
			alephNotKept:
				'Aleph hat die Sicherung nicht behalten: Auf dem Konto der Bridge sind {credits} Credits, für einen Tag braucht diese Sicherung {required}. Lade Credits auf (app.aleph.cloud → Credits) und sichere noch einmal.',
			alephRejected: 'Aleph hat die Sicherung nicht behalten ({error}).',
			mailNotSetUp: 'Das Postfach ist auf der Bridge nicht eingerichtet (pnpm setup:mail).',
			llmNotSetUp: 'Das Auslesen ist auf der Bridge nicht eingerichtet (pnpm setup:llm).',
			senderUnverified: 'Der Absender ist nicht bestätigt (DKIM/SPF): erst freigeben.',
			noModel: 'Kein Modell lieferte eine brauchbare Antwort ({reasons}).'
		},
		ucep: {
			unreachable: 'Die Rechnungs-App ist gerade nicht erreichbar. Ist sie offen und entsperrt?',
			oldVersion:
				'Diese Version der Rechnungs-App kennt das Abgleichen noch nicht. Bitte die Rechnungs-App aktualisieren.',
			scopeMissing:
				'Die Kopplung erlaubt das noch nicht: Bitte die Rechnungs-App neu koppeln (Entkoppeln, dann wieder verbinden), damit Belege ausgestellte Rechnungen lesen und Zahlungen melden darf.',
			invoicePdfMismatch:
				'Das PDF der Rechnung {number} stimmt nicht mit dem überein, was die App angibt.',
			notInvoiceApp: 'Diese Einladung ist nicht von einer Rechnungs-App.',
			peerUnreachable: 'Die Rechnungs-App ist unter dieser Peer-ID gerade nicht erreichbar.',
			eigenbelegPdfLater:
				'Der Eigenbeleg {number} ist erstellt, aber sein PDF kommt nur über eine direkte Verbindung – die gerade nicht zustande kam. Bitte später noch einmal.',
			eigenbelegPdfMismatch:
				'Das PDF des Eigenbelegs stimmt nicht mit dem überein, was die App erstellt hat.'
		},
		eigenbeleg: {
			needWhat: 'Was wurde bezahlt? Das gehört auf den Eigenbeleg.',
			needWhy: 'Warum gibt es keinen Beleg der Gegenseite? Ein Satz genügt.',
			exists: 'Für diese Zahlung gibt es schon den Eigenbeleg {number}.',
			saveFailed: 'Der Eigenbeleg konnte nicht gespeichert werden.'
		},
		aleph: {
			exists: 'Für diesen Monat gibt es schon den Verbrauchsnachweis {number}.',
			nothing: 'In diesem Monat hat das Konto keine Credits bewegt: kein Nachweis nötig.',
			saveFailed: 'Der Verbrauchsnachweis konnte nicht gespeichert werden.'
		},
		wallets: {
			costCentre: 'Kostenstelle: bis zu 36 Buchstaben und Ziffern, ohne Leerzeichen – {value}'
		},
		export: {
			notReady: 'Dieser Monat ist noch nicht bereit für den Export.'
		},
		classify: {
			ownAccount: 'eigenes Konto',
			ibanOnOtherSide: 'IBAN dieses Kontos auf der Gegenseite'
		}
	},
	language: {
		label: 'Sprache',
		de: 'Deutsch',
		en: 'English',
		// A word or name quoted in running text.
		quoted: '„{text}“'
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
	portals: {
		title: 'Kundenportale',
		intro:
			'Rechnungen direkt aus deinem Kundenkonto holen. Ein Browser auf dem Mac der Bridge meldet sich an und lädt nur die Rechnungen herunter.',
		unpaired: 'Erst die Bridge koppeln.',
		none: 'Die Bridge kennt keine Kundenportale.',
		state: {
			'logged-in': 'angemeldet',
			'needs-login': 'Anmeldung abgelaufen',
			never: 'noch nie angemeldet'
		},
		lastLogin: 'angemeldet am {date}',
		lastRun: 'zuletzt geholt am {date}: {count} Rechnungen',
		lastRunFailed: 'letzter Abruf am {date} fehlgeschlagen',
		lastRunRefused: ', {count} abgelehnt',
		login: 'Anmelden',
		loggingIn: 'Warte auf die Anmeldung im Browserfenster …',
		loginHint:
			'Auf dem Mac der Bridge öffnet sich ein Browserfenster. Melde dich dort an – einen Code oder eine Sicherheitsprüfung gibst du selbst ein. Danach schließt sich das Fenster.',
		cancel: 'Abbrechen',
		fetch: 'Rechnungen holen',
		fetching: 'Hole Rechnungen …',
		fromMonth: 'ab Monat',
		logout: 'Abmelden',
		logoutHint: 'Beendet die Sitzung und löscht das Browserprofil auf dem Mac.',
		result:
			'{listed} Rechnungen ab {since} · neu: {new} · schon vorhanden: {known} · doppelt: {duplicate}',
		refused: ' · abgelehnt (kein PDF o. Ä.): {count}',
		read: ' · ausgelesen: {count}',
		error: {
			offline: 'Die Bridge ist nicht erreichbar.',
			unpaired: 'Die Bridge kennt dieses Gerät nicht (neu koppeln).',
			needsLogin: 'Die Anmeldung ist abgelaufen: bitte „Anmelden“.',
			busy: 'Das Portal ist gerade mit einem anderen Vorgang beschäftigt.',
			cancelled: 'Anmeldung abgebrochen.',
			timeout: 'In 10 Minuten kam keine Anmeldung zustande.',
			step: 'Das Portal sah anders aus als erwartet (Schritt „{step}“). Siehe bridge/README.md, Kundenportale.',
			browser:
				'Der Browser für die Portale fehlt auf der Bridge: pnpm --filter @belege/bridge exec playwright install chromium',
			profile: 'Das Browserprofil des Portals ist noch geöffnet.',
			unknownInvoice: 'Diese Rechnung ist nicht mehr auf der Bridge: bitte erneut holen.',
			recordingOff: 'Diese Bridge kann keine Portale aufzeichnen.',
			notRecorded: 'Es liegt keine Aufzeichnung vor.',
			noDownload:
				'In der Aufzeichnung wurde keine Rechnung heruntergeladen: bitte noch einmal aufzeichnen und eine herunterladen.',
			unusable:
				'Der Download-Knopf hat weder einen Namen noch ein festes Merkmal: so lässt er sich nicht wiederfinden.',
			rejected:
				'Das Rezept enthielte persönliche Daten (E-Mail, IBAN oder eine lange Nummer) und wurde nicht gespeichert.',
			noRecipe: 'Für dieses Portal ist kein aufgezeichnetes Rezept gespeichert.',
			credentialsCancelled: 'Kein Passwort eingegeben – nichts gespeichert.',
			credentialsEmpty: 'Das Passwort war leer – nichts gespeichert.',
			credentialsInvalid:
				'Bitte einen Benutzernamen oder eine E-Mail-Adresse eingeben (eine Zeile).',
			credentialsUnsupported:
				'Das Passwortfenster gibt es nur auf dem Mac. Auf dem Rechner der Bridge: pnpm setup:portal',
			credentialsOff: 'Diese Bridge kann keine Zugangsdaten von hier speichern.',
			hostsUnconfirmed: 'Bitte erst jede weitere Adresse bestätigen, die der Weg besucht.',
			newInvalid:
				'Bitte einen Namen (ohne E-Mail-Adresse und lange Nummern) und eine Startseite mit https:// angeben.',
			notLocal: 'Nur eigene Portale lassen sich entfernen.'
		},
		local: {
			badge: 'eigenes Rezept, lokal',
			pending:
				'Neues Portal – noch nicht gespeichert. Beende die Aufzeichnung und speichere sie, sonst verschwindet es wieder.',
			remove: 'Portal entfernen',
			removeHint:
				'Löscht das Rezept, das Browserprofil und die Zugangsdaten dieses Portals auf dem Mac.',
			removeConfirm:
				'„{name}“ entfernen? Rezept, Browserprofil (die Sitzung) und gespeicherte Zugangsdaten werden auf dem Mac gelöscht. Schon geholte Belege bleiben.'
		},
		new: {
			title: 'Neues Portal aufzeichnen',
			intro:
				'Für einen Anbieter, den die Bridge noch nicht kennt: Name und Startseite eingeben, im Fenster der Bridge anmelden, zu einer Rechnung klicken und sie herunterladen. Danach holt die Bridge die Rechnungen dort selbst.',
			name: 'Name',
			namePlaceholder: 'z. B. Anthropic',
			start: 'Startseite',
			button: 'Neues Portal aufzeichnen',
			starting: 'Öffne das Fenster …',
			hint: 'Die Anmeldung machst du selbst im Fenster – auch Codes, „Mit Google anmelden“ und Sicherheitsprüfungen. Passwörter und Eingaben werden nie aufgezeichnet.',
			recording:
				'Melde dich im Fenster der Bridge an, klicke zu einer Rechnung und lade sie herunter. Dann hier „Aufzeichnung beenden“.',
			saved: '„{name}“ gespeichert – es steht jetzt unter Integrationen → Kundenportale.',
			imported: ' Die heruntergeladene Rechnung ist als Beleg übernommen.',
			technical: [
				'Die Bridge legt ein eigenes Portal an (Kennung local-<name>) mit einem eigenen Browserprofil unter ~/.config/belege/portals/local-<name>/ und öffnet ihr Chromium auf der Startseite. Von der Adresse bleiben nur Herkunft und Pfad; Parameter und Anker (oft mit Tokens) werden verworfen.',
				'Aufgezeichnet werden echte Klicks auf Links und Knöpfe als Rolle und Name. Anmeldeseiten (Passwortfeld, Adressen wie …/login oder accounts.…) werden nicht aufgezeichnet, und was davor lag, fällt weg: Der spätere Abruf beginnt angemeldet.',
				'Liegt die Rechnung auf einer anderen Adresse (etwa invoice.stripe.com), zeigt die Prüfung sie an, und du bestätigst jede einzeln. Nur diese Adressen (allowedHosts) darf der Abruf außer der Seite des Anbieters besuchen; jede andere Navigation wird abgebrochen.',
				'Das Rezept liegt nur auf dem Mac: ~/.config/belege/recipes/local-<name>.json (0600), ohne E-Mail-Adressen, IBANs und lange Nummern. Die heruntergeladene PDF wird ein Beleg wie jede geholte Rechnung.'
			]
		},
		credentials: {
			title: 'Zugangsdaten',
			username: 'Benutzername oder E-Mail',
			save: 'Zugangsdaten speichern',
			saving: 'Warte auf das Passwortfenster …',
			hint: 'Das Passwort gibst du in einem Fenster deines Macs ein – es geht direkt in den Schlüsselbund und nie durch diese Seite.',
			stored: 'Zugangsdaten gespeichert: die Bridge füllt künftig das Anmeldeformular aus.',
			storedBadge: 'Zugangsdaten gespeichert',
			delete: 'Zugangsdaten löschen',
			deleted: 'Zugangsdaten gelöscht.',
			technical: [
				'Die App schickt nur den Benutzernamen an die Bridge (POST /portals/<portal>/credentials). Die Bridge öffnet mit osascript einen macOS-Dialog mit verdeckter Eingabe; Name und Adresse des Portals gehen als Argumente hinein, nicht in das Skript.',
				'Das Passwort landet im macOS-Schlüsselbund (Dienst belege-bridge, Konto portal:<portal>), der Benutzername in ~/.config/belege/bridge.json. Kein Protokoll und keine Antwort enthält das Passwort; die App erfährt nur, dass Zugangsdaten da sind.',
				'„Zugangsdaten löschen“ entfernt beides. Codes (SMS, E-Mail) und Sicherheitsprüfungen gibst du weiterhin selbst im Fenster ein.'
			]
		},
		record: {
			start: 'Portal aufzeichnen',
			startHint:
				'Einmal selbst zu den Rechnungen klicken – die Bridge merkt sich den Weg und geht ihn künftig allein.',
			hint: 'Klicke im Fenster der Bridge zu deinen Rechnungen und lade eine herunter. Passwörter und Eingaben werden nie aufgezeichnet.',
			stop: 'Aufzeichnung beenden',
			reviewTitle: 'Aufgezeichnete Schritte',
			none: 'Kein Klick aufgezeichnet.',
			noDownload: 'Kein Download erkannt – so lässt sich die Aufzeichnung nicht speichern.',
			paused: 'Auf Anmeldeseiten ({count} Klicks) wurde nichts aufgezeichnet.',
			download: ' (Download)',
			unusable: ' – nicht wiederzufinden, wird übersprungen',
			page: 'Seite {path}',
			on: ' auf {host}',
			invoiceKept: 'Die heruntergeladene Rechnung wird beim Speichern als Beleg übernommen.',
			hostsTitle: 'Weitere Adressen',
			hostsHint:
				'Der Weg führt über Adressen außerhalb der Seite des Anbieters. Nur was du hier bestätigst, darf der Abruf später besuchen.',
			hostConfirm: '{host} gehört zum Rechnungsweg',
			savedInvoice: ' Die heruntergeladene Rechnung ist als Beleg übernommen.',
			save: 'Als Rezept speichern',
			discard: 'Verwerfen',
			saved: 'Rezept gespeichert: der nächste Abruf geht diesen Weg.',
			export: 'Rezept exportieren',
			exportHint:
				'Lädt das Rezept als JSON herunter – zum Teilen, etwa für eine künftige offene Rezeptsammlung (@le-space/portal-recipes). Es enthält nur Rollen, Namen von Knöpfen und Links und Muster, keine Eingaben.',
			role: {
				link: 'Link',
				button: 'Button',
				tab: 'Reiter',
				menuitem: 'Menüpunkt',
				element: 'Element'
			}
		},
		technical: [
			'Die Bridge startet ein eigenes Chromium (Playwright) mit einem Profil pro Portal unter ~/.config/belege/portals/<portal>/profile (0700) – nicht dein Alltags-Chrome. Die Sitzung bleibt in diesem Profil; „Abmelden“ beendet sie und löscht es.',
			'Ein Passwort, falls du es mit „Zugangsdaten speichern“ oder pnpm setup:portal hinterlegst, liegt im macOS-Schlüsselbund (belege-bridge, portal:<portal>). Codes und Sicherheitsprüfungen gibst immer du ein. Kein Sprachmodell und keine Bildschirmfotos sind beteiligt.',
			'Jede Datei muss nach ihren Bytes ein PDF sein (höchstens 15 MB). Doppelte erkennt die App an der Rechnungskennung (vodafone:<id>) und am SHA-256.',
			'„Portal aufzeichnen“ merkt sich nur echte Klicks auf Links und Knöpfe als Rolle und Namen (Ziffern als Muster \\d+) und besuchte Seiten als maskierte Pfade. Eingabefelder, Tastendrücke und alles auf Seiten mit Passwortfeld bleiben außen vor; die heruntergeladene Rechnung (ein PDF) wird beim Speichern ein Beleg. Das Rezept liegt als ~/.config/belege/recipes/<portal>.json (0600) auf dem Mac und wird abgelehnt, wenn es eine E-Mail-Adresse, eine IBAN oder fünf Ziffern am Stück enthielte. Der Abruf spielt die Klicks danach ohne Sprachmodell nach.'
		]
	},
	footer: {
		verlauf: 'Verlauf',
		madeWith: 'Gebaut mit',
		build: 'Stand',
		releaseExact: 'Veröffentlichte Version – die Notizen stehen im Release auf GitHub.',
		releaseAfter: '{count} Änderungen nach der Version {release}, noch nicht veröffentlicht.',
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
		// The names of what Belege works with, where they carry words (consent/integrations.js).
		integrationNames: {
			monero: 'Monero (Export der Wallet, nur im Browser gelesen)',
			'aleph-backup': 'Aleph Cloud (Backup über die OrbitDB Storage Bridge)',
			hibiscus: 'Hibiscus (Banken per FinTS/HBCI)',
			camt: 'CAMT.053-Kontoauszüge, z. B. Revolut Business',
			enablebanking: 'Enable Banking (Banken in Europa per PSD2, mit eigener Anwendung)',
			alchemy: 'Alchemy (EVM, mit eigenem Schlüssel)',
			blockscout: 'Blockscout (EVM, ohne Schlüssel)',
			'cosmos-nodes': 'Nym, Nodes Guru, PublicNode, Polkachu (Cosmos-Knoten)',
			'akash-indexer': 'Akash Console (Indexer, ältere Akash-Geschichte)',
			aleph: 'Aleph Cloud (Credits eigener Konten, nur gelesen)',
			coingecko: 'CoinGecko (Kurse)',
			'kraken-rates': 'Kraken (Kurse)',
			ecb: 'Europäische Zentralbank (USD-Kurs)'
		},
		// What Belege can do, by category (docs/features.de.md says the same in more words).
		features: {
			title: 'Was Le Space Belege kann',
			more: 'Alle Funktionen, ausführlicher: docs/features.de.md im Quellcode.',
			privacy: {
				name: 'Datenschutz & Speicherung',
				items: [
					'Passkey statt Passwort; jeder Eintrag und jede Belegdatei ist mit einem Schlüssel aus dem Passkey versiegelt.',
					'Alles bleibt in diesem Browser – Le Space betreibt keinen Server für deine Bücher.',
					'Das Netzwerk lässt sich oben jederzeit pausieren, eigene Geräte und Rechnungs-App einzeln an- und ausschalten.'
				]
			},
			payments: {
				name: 'Zahlungen',
				items: [
					'Bankumsätze aus Hibiscus und über Enable Banking (beides über die Bridge) und Kontoauszüge als CAMT.053, etwa von Revolut oder GLS.',
					'Ein Geschäftsjahr nach dem anderen; zusammengehörige Buchungen sind einen Klick entfernt.',
					'Private Zahlungen vom Geschäftskonto markieren, dokumentieren und verrechnen.'
				]
			},
			receipts: {
				name: 'Belege',
				items: [
					'Aus dem Buchhaltungs-Postfach, per Upload, aus einem Ordner und aus Kundenportalen (Vodafone, eigene per Aufzeichnung).',
					'Absender ohne DKIM/SPF warten auf deine Freigabe; Anzeichen für Betrug werden genannt.',
					'Kopien einer Rechnung werden erkannt; für eine Zahlung ohne Beleg gibt es einen Eigenbeleg.'
				]
			},
			matching: {
				name: 'Abgleich',
				items: [
					'Punkte aus Betrag, Rechnungs- und Kundennummer, IBAN, Lieferant und Datum: sichere Paare werden verknüpft, der Rest wird eine Frage.',
					'Umbuchungen zwischen eigenen Konten (auch über Chains und Bridges), Bankgebühren und Erstattungen brauchen keinen Beleg.',
					'Lieferantenkonten für Guthaben- und Sammelabrechnungen; Belege lernt aus deinen Verknüpfungen.'
				]
			},
			ai: {
				name: 'KI – nur auf Klick (✦)',
				items: [
					'Belege auslesen, im privaten Postfach weitersuchen, einen Beleg oder eine Gegenbuchung vorschlagen, Ungereimtheiten erklären.',
					'Mit deinem eigenen Modell in der Bridge, nach Schwärzung; Le Space betreibt keine KI.',
					'Verbrauch an Tokens und Kosten im Blick.'
				]
			},
			crypto: {
				name: 'Krypto',
				items: [
					'Kraken und eigene Wallets auf Cosmos-Chains (Nym, Akash), EVM-Chains (Ethereum, Base, …) und Bitcoin.',
					'Jede Buchung in Euro mit Menge und Tageskurs samt Quelle: CoinGecko, Kraken, EZB, DEX-Pool (Uniswap), Handelspreis, Migration oder von Hand.',
					'Swaps – auch über Chains –, Token-Migrationen und Staub; Aleph-Guthaben als Monatsauszug.'
				]
			},
			export: {
				name: 'Buchhaltung & Export',
				items: [
					'Jede Buchung mit SKR-03-Konto und BU-Schlüssel; dein Kontenrahmen lässt sich einlesen.',
					'Monatlich ein ZIP: DATEV-Buchungsstapel (EXTF) für MonkeyOffice, die Belege als PDF und ein Auszug je Konto.'
				]
			},
			devices: {
				name: 'Geräte & Zusammenarbeit',
				items: [
					'Dieselben Bücher auf Telefon und Rechner; ein Gerät bekommt sie erst, wenn es den Passkey beweist.',
					'Geräte treffen sich über öffentliche Relays, am Relay deiner eigenen Bridge im selben Netz oder ganz ohne Relay per QR-Code – oder über alle, wobei ein neues Gerät nur im eigenen Netz hereinkommt.',
					'Das Telefon nutzt die Bridge des Rechners; Belege lässt sich als App installieren.',
					'Rechnungs-App (UCEP): Eigenbelege erstellen lassen und bezahlte Rechnungen melden; eine Lese-Freigabe für eine Assistenz.'
				]
			}
		},
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
				'Gespeichert werden die OrbitDB-Dokumentdatenbanken transactions, receipts, partners, accounts, settings, matches, questions und events, auf Helia mit LevelBlockstore und LevelDatastore in IndexedDB (belege/helia-blocks, belege/helia-data, belege/orbitdb). Jeder Eintrag ist mit AES-GCM verschlüsselt, Belegdateien mit einem eigenen Schlüssel (belege/blob-key/v1).',
				'Im localStorage liegt nur Öffentliches: die Angaben zum Passkey (Credential-ID, öffentlicher Schlüssel, DID, PRF-Eingabe), die Signatur des Passkeys über das Identitätsdokument und drei Merker dieser Seite (Hinweis gelesen, Hell/Dunkel, Technisch).'
			]
		},
		network: {
			title: 'Netzwerk: aus',
			simple: [
				'Le Space Belege verbindet sich mit niemandem. Kein Peer-to-Peer, kein Relay, kein Server: Deine Bücher verlassen diesen Browser nicht.'
			],
			titleDevices: 'Netzwerk: nur eigene Geräte',
			options: 'Einstellungen',
			devices: 'Eigene Geräte synchronisieren',
			devicesText:
				'Deine Bücher und Belege auch auf deinem Telefon oder einem zweiten Rechner mit demselben Passkey. Die Geräte verbinden sich über ein Le-Space-Relay (gefunden über Aleph, siehe „Le-Space-Relays“) und, wo möglich, direkt; alles ist verschlüsselt, bevor es das Gerät verlässt. Oder, im Netzwerk-Menü oben unter „Wo sich Geräte treffen“, ohne Relay per QR: Zwei Geräte im selben Netz scannen gegenseitig einen Code und verbinden sich direkt – dann fragt Belege weder Aleph noch ein Relay noch einen STUN-Server, und der Code zeigt nur die Kennung des Geräts und seine Adressen im lokalen Netz. Oder „Nur im eigenen Netz“: Die Geräte treffen sich am Relay deiner eigenen Bridge (auf dem Rechner mit `pnpm setup:relay` eingerichtet) – dann fragt Belege weder Aleph noch einen öffentlichen Relay noch einen STUN-Server, und dein Rechner sieht nur die Adressen im lokalen Netz und wann die Geräte verbunden sind. Oder „Beides“: alle drei Wege zugleich, aber ein Gerät, das die Bücher noch nicht kennen, kommt nur per QR oder über den Relay deiner Bridge herein – erst danach auch über die öffentlichen Relays. Ein Gerät bekommt die Bücher erst, wenn es beweist, dass es denselben Passkey hat; der Relay und andere Peers bekommen nichts davon, auch nicht verschlüsselt. Der Relay sieht, dass zwei Geräte miteinander reden, ihre IP-Adressen und die Kennungen (Hash-Werte) der Datenbanken, nie Inhalte. Gilt für dieses Gerät, ab dem nächsten Entsperren. Auf einem Rechner mit Bridge kannst du sie zusätzlich für deine eigenen Geräte freigeben (Integrationen → Eigene Geräte): Dann nutzt das Telefon Bank, Postfach, KI und Wallets über diesen Rechner – nur die freigegebenen Abfragen, verschlüsselt, der Zugang der Bridge bleibt auf dem Rechner.',
			collaboration: 'Zusammenarbeit',
			collaborationText:
				'Gemeinsame Bücher mit Kolleginnen, Kollegen oder der Steuerberatung, Chat und später Video. Das kommt später und wird dann hier ausdrücklich eingeschaltet – nicht vorher und nicht von selbst.',
			technical: [
				'Im Browser läuft ein libp2p-Knoten, weil OrbitDB einen braucht – ohne Transporte, ohne Bootstrap-Liste und ohne Peer-Discovery. Er kann niemanden anwählen und hört auf keiner Adresse. Nur wenn du Belege mit deiner Rechnungs-App koppelst, kommt ein zweiter, eigener Knoten dazu, der sich mit einem Relay verbindet (siehe „Rechnungs-App“ unten); an deine Bücher kommt er nicht.',
				'Sein Peer-Schlüssel (Ed25519) entsteht in jeder Sitzung neu und wird nirgends gespeichert.',
				'Mit „Eigene Geräte synchronisieren“ bekommt dieser Knoten die Transporte des Rechnungs-App-Knotens: WebSocket zum Relay, eine Reservierung dort, WebRTC für die direkte Verbindung, dazu gossipsub für OrbitDB. Sein Peer-Schlüssel kommt dann aus dem Passkey und einem Zufallswert dieses Browsers, damit jedes Gerät seine eigene, gleichbleibende Kennung hat. Die Geräte kennen einander über versiegelte Einträge in den Einstellungen (`device:<Kennung>`). Bevor ein Gerät etwas bekommt, beweist es den Passkey: ein HMAC über beide Kennungen mit einem Schlüssel, der aus dem Passkey abgeleitet und nie übertragen wird. Bis dahin beantwortet der Knoten nur identify und den Relay – kein gossipsub, keine OrbitDB-Heads, kein Bitswap, keine Bridge.',
				'Im Modus „Ohne Relay, per QR“ hat der Knoten nur den Transport von @le-space/libp2p-webrtc-qr: kein WebSocket, keine Relay-Adresse, keine Abfrage bei Aleph. Einladung und Antwort sind je eine WebRTC-SDP mit nur lokalen Kandidaten (kein STUN), signiert mit dem Peer-Schlüssel des Geräts und gegen die Peer-ID darin geprüft; weil die SDP den DTLS-Fingerabdruck enthält, bindet die Signatur die Verbindung an beide Kennungen, wie sonst Noise. Ein Code gilt zehn Minuten. Der Passkey-Beweis läuft auf dieser Verbindung wie auf jeder anderen. Der Modus liegt versiegelt in den Einstellungen (`network-mode`) und als Kopie in diesem Browser.',
				'Im Modus „Nur im eigenen Netz“ wählt der Knoten den Relay der Bridge per WebRTC-Direct an (`/ip4/<Adresse im lokalen Netz>/udp/<Port>/webrtc-direct/certhash/…`): Der Browser prüft das Zertifikat des Relays über dessen Hash in der Adresse, ohne Zertifizierungsstelle und ohne Installation. Die Bridge lauscht nur auf der einen gewählten Adresse, nie auf allen, und nutzt ein eigenes, zehn Jahre gültiges P-256-Zertifikat, damit die Adresse gleich bleibt. Die Adresse steht versiegelt in den Einstellungen (`lan-relay`); die App holt sie mit der Kopplung von der Bridge. Die Verbindungen zwischen den Geräten nutzen nur lokale Kandidaten (kein STUN), und Noise verschlüsselt sie Ende zu Ende wie beim öffentlichen Relay.',
				'Im Modus „Beides“ hat der Knoten alle Transporte: QR, WebRTC-Direct zum Relay der Bridge, WebSocket zu den öffentlichen Relays. Beweist ein Gerät den Passkey, das die Bücher noch nicht kennen (kein Eintrag `device:<Kennung>`), zählt der Beweis nur auf einer Verbindung, die per QR entstand oder über den Relay der Bridge läuft; auf jedem anderen Weg bricht der Knoten ab, auf beiden Seiten. Wer den Passkey hat, aber nicht im eigenen Netz ist, bekommt so nichts.',
				'Die Seite lädt keine Schriften, Skripte oder Bilder von Dritten.'
			]
		},
		ai: {
			title: 'KI: wo ein Sprachmodell hilft',
			simple: [
				'Le Space betreibt keine KI und bekommt nichts davon zu sehen. Die Bridge auf deinem Rechner fragt das Sprachmodell, das du selbst einstellst: ein öffentliches wie DeepSeek oder ein lokales auf deinem eigenen Rechner. Ist keins eingestellt, läuft nichts davon.',
				'KI hilft nur dort, wo ein Knopf das Zeichen ✦ trägt, und nur, wenn du ihn drückst. Was dabei hinausgeht, steht beim Darüberfahren mit der Maus.'
			],
			usesHeading: 'Mit KI',
			uses: [
				'Belege auslesen: Anbieter, Betrag, Datum, Rechnungs- und Kundennummer aus dem Text eines Belegs – und ob es überhaupt ein Beleg ist (Anmelde-Mails und Newsletter nicht). Bei „Auslesen“, „Alle neuen auslesen“, „Beleg hochladen“, „Als Beleg übernehmen“ und „Rechnungen holen“.',
				'„Mit KI weitersuchen“ im privaten Postfach: Suchwörter und Absender vorschlagen, dann unter den Treffern den Beleg wählen – nach Betreff, Absender-Domain und Dateinamen, nie nach dem Text der E-Mails.',
				'„KI-Vorschlag“ unter „Beleg zuordnen“: unter bis zu 25 deiner Belege den passenden zu einer Buchung nennen – nach Anbieter, Betrag, Datum, Rechnungsnummer und Kurzbeschreibung. Zuordnen tust du.',
				'„KI-Vorschlag“ unter „Als Gegenbuchung verknüpfen …“: unter bis zu 8 Buchungen auf deinen anderen Konten die andere Seite einer eigenen Umbuchung nennen – nach Richtung, Betrag, Menge, Tag, Kontoart, Gegenpartei und Zweck, ohne Adressen, IBANs und Hashes. Verknüpfen tust du.',
				'„Ungereimtheiten erklären“ im Lieferantenkonto: in wenigen Sätzen sagen, was bei einem Lieferanten nicht aufgeht – nach Daten, Beträgen, Zeiträumen und Positionen, ohne Rufnummern, Kunden- und Rechnungsnummern. Gebucht wird nichts.'
			],
			withoutHeading: 'Ohne KI, nach festen Regeln',
			without:
				'Zuordnen mit Punkten, Rückfragen, Sortierung der Suchtreffer, Umbuchungen und Bankgebühren, was der Abgleich aus deinen Entscheidungen lernt, und die Portal-Rezepte. Jede Zuordnung begründet „Warum diese Zuordnung?“.',
			check:
				'Was die KI liefert, prüfst du: Am Beleg stehen das Modell und der gesendete Text, ein KI-Vorschlag wird erst auf deinen Klick übernommen, und der Verlauf nennt jeden Aufruf.',
			technical: [
				'Das Sprachmodell stellst du in der Bridge ein (pnpm setup:llm): jede Schnittstelle im OpenAI-Format (/chat/completions) – per https, oder per http nur auf diesem Rechner (127.0.0.1, localhost), etwa Ollama oder LM Studio. Voreingestellt sind deepseek-flash, mit deepseek-v4-pro als zweitem Versuch.',
				'Vor jedem Aufruf schwärzt die Bridge Namen aus ihrer Liste und deine Firmennamen aus den Einstellungen, Namen nach einer Anrede oder einem Etikett („Herr“, „Ansprechpartner:“), IBANs und Kartennummern bis auf die letzten vier Stellen, E-Mail-Adressen (von fremden bleibt die Domain), Telefonnummern, Geburtsdaten, Steuernummern, Straßen, Postleitzahlen und Links (nur der Host bleibt). Das begrenzt, was hinausgeht, anonym macht es den Text nicht: Ein Name, der auf keiner Liste steht und hinter keinem Etikett, geht durch, ebenso Anbieter, Beträge, Rechnungsnummern und worum es im Beleg geht. Soll nichts hinausgehen, stell ein Modell auf diesem Rechner ein (etwa Ollama). Die Antworten sind JSON und werden geprüft (Summen, Datumsformate, Kandidatennummern); was nicht passt, wird verworfen.',
				'Der API-Schlüssel liegt im macOS-Schlüsselbund der Bridge, nie im Browser. Das Protokoll der Bridge nennt nur Zahlen, nie Text. Im Verlauf der App stehen Modell, Dauer und Tokens jedes Aufrufs.'
			]
		},
		integrations: {
			title: 'Womit Belege arbeitet',
			simple:
				'Banken, Börsen und Blockchains, deren Buchungen Belege liest, und die Dienste, die es dafür fragt – nur wenn du sie einrichtest oder benutzt. Die Logos sind in die App eingebaut; dieser Dialog lädt nichts von fremden Servern.',
			groups: {
				banks: 'Banken und Kontoauszüge',
				exchanges: 'Börsen',
				chains: 'Blockchains (eigene Wallets)',
				data: 'Daten- und Kursquellen',
				explorers: 'Block-Explorer (nur als Link)',
				ai: 'KI-Modelle (du wählst eins)',
				backup: 'Backup (versiegelt, nur auf deinen Klick)',
				portals: 'Kundenportale',
				apps: 'Verbundene Apps'
			},
			marks:
				'Marken und Logos gehören ihren Inhabern; sie zeigen nur, womit Belege zusammenarbeitet. Logos: Simple Icons (CC0).'
		},
		services: {
			title: 'Externe Dienste',
			simple: ['Nur wenn du sie benutzt, und nur mit dem, was hier steht.'],
			leaves: 'Was den Rechner verlässt:',
			bridge: {
				name: 'Bridge auf diesem Rechner (127.0.0.1)',
				text: 'Holt Umsätze aus Hibiscus und Belege aus deinem Postfach. Bei der App kommen nur Konten an, die du auf der Bridge freigegeben hast, und nur E-Mails an die Buchhaltungsadresse.',
				leaves:
					'Die Bridge fragt dein Postfach (IMAP) ab und schickt zum Auslesen geschwärzten Text an das Sprachmodell (siehe unten). Die Verbindung zu deiner Bank (FinTS) baut Hibiscus auf.',
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
				name: 'Enable Banking (Banken ohne Hibiscus)',
				text: 'Wenn eingerichtet: Die Bridge verbindet über deine eigene Enable-Banking-Anwendung Banken, die Hibiscus nicht abruft. Die Freigabe gibst du auf der Seite deiner Bank.',
				leaves:
					'An Enable Banking: welche Bank du verbindest, nach deiner Freigabe deine Konten (IBAN, Name, Währung) und die Umsätze der Konten, die du in die Bücher holst – sie laufen über seine Server. Dazu die IP-Adresse dieses Rechners. Dein Bank-Passwort sehen weder Belege noch die Bridge.',
				technical:
					'Ein Kontoinformationsdienst (AIS) nach PSD2. Nur die Bridge spricht mit api.enablebanking.com; jede Anfrage ist mit dem Schlüssel deiner Anwendung signiert (RS256-JWT). Schlüssel und Sitzungen liegen versiegelt neben der Konfiguration der Bridge, nie im Browser und nicht in den Büchern; die App bekommt von einem Konto nur die letzten vier Stellen der IBAN. Der Browser geht nur zur Bank und zurück nach /integrationen/bank/verbunden. Der Einmal-Code der Bank steht dabei in der Adresse und geht so auch über das Gateway, das die Seite ausliefert; ohne den Schlüssel ist er wertlos, und die Seite nimmt ihn sofort aus der Adresse. Nur Konten, deren IBAN-Endung in der Bridge freigegeben ist (pnpm setup:enablebanking -- --accounts), verlassen die Bridge, und geholt wird nur auf deinen Klick. Eine Freigabe gilt höchstens 180 Tage; „Trennen“ beendet sie bei Enable Banking.'
			},
			backup: {
				name: 'Backup bei Aleph Cloud',
				text: 'Wenn eingerichtet und nur auf deinen Klick: alles, was Belege hält, versiegelt mit einem Schlüssel aus deinem Passkey, als eine Datei bei Aleph Cloud.',
				leaves:
					'An Alephs IPFS-Host, direkt aus diesem Browser: die versiegelte Datei (Aleph sieht ihre Größe und die IP-Adresse dieses Computers, nicht den Inhalt). Von der Bridge an Aleph: ein mit dem eigenen Backup-Schlüssel der Bridge unterschriebener Auftrag, der die Datei nennt. Zum Wiederherstellen holt der Browser die versiegelte Datei über ihre CID von Alephs Gateway.',
				technical:
					'Das CAR aller Datenbank-Blöcke (Einträge schon versiegelt, Manifeste, Access-Controller, Identitäten der Schreiber) und der versiegelten Blöcke jeder Belegdatei wird noch einmal mit AES-256-GCM versiegelt, unter einem Schlüssel aus dem PRF des Passkeys (HKDF, belege/backup-key/v1). Upload: POST https://ipfs.aleph.cloud/api/v0/add, ohne Schlüssel. Die Bridge unterschreibt eine STORE-Nachricht (personal_sign, Kanal BELEGE-BACKUP) mit einem secp256k1-Schlüssel, den sie selbst erzeugt hat (pnpm setup:aleph) und im Schlüsselbund hält; Aleph bewahrt die Datei auf, solange dieses Konto Credits hat.'
			},
			deepseek: {
				name: 'Sprachmodell – voreingestellt DeepSeek (Belege auslesen, KI-Suche)',
				text: 'Das Modell, das du in der Bridge einstellst. Nur bei Knöpfen mit ✦ (siehe „KI“ oben).',
				leaves:
					'Beim Auslesen der geschwärzte Text eines Belegs; bei „Mit KI weitersuchen“ Gegenpartei und Verwendungszweck sowie Betreff, Absender-Domain und Dateinamen der Treffer, geschwärzt. Bei DeepSeek stehen die Server außerhalb der EU; ein lokales Modell verlässt diesen Rechner nicht. Unser Rat derzeit: ein lokales Modell, oder mit der KI warten, bis schnelle Modelle in einer prüfbar vertraulichen Umgebung (TEE) verfügbar sind.',
				technical:
					'Die Bridge schickt nur die Textebene eines PDFs (oder den Text einer E-Mail) mit Betreff und Absender, nachdem sie Namen aus ihrer Liste und deine Firmennamen aus den Einstellungen, Namen nach einer Anrede oder einem Etikett („Herr“, „Ansprechpartner:“), IBANs und Kartennummern bis auf die letzten vier Stellen, E-Mail-Adressen (von fremden bleibt die Domain), Telefonnummern, Geburtsdaten, Steuernummern, Straßen, Postleitzahlen und Links (nur der Host bleibt) geschwärzt hat – nie die Datei selbst. Das begrenzt, was hinausgeht, anonym macht es den Text nicht: Ein Name, der auf keiner Liste steht und hinter keinem Etikett, geht durch, ebenso Anbieter, Beträge, Rechnungsnummern und worum es im Beleg geht. Soll nichts hinausgehen, stell ein Modell auf diesem Rechner ein (etwa Ollama). DeepSeek betreibt seine Server in China. Der API-Schlüssel liegt im macOS-Schlüsselbund der Bridge, nie im Browser. E-Mails von Absendern ohne bestandene DKIM/SPF-Prüfung liest die Bridge erst nach deiner Freigabe aus.'
			},
			portals: {
				name: 'Kundenportale (Vodafone)',
				text: 'Ein Browser auf diesem Mac meldet sich in deinem Kundenkonto an und lädt nur die Rechnungen herunter – nur wenn du „Anmelden“ oder „Rechnungen holen“ drückst.',
				leaves:
					'Deine Anmeldung beim Portal (Vodafone) und die Abrufe der Rechnungsseiten, direkt von diesem Mac. Die Sitzung bleibt in einem Browserprofil auf dem Mac; ein Passwort nur, wenn du es im Schlüsselbund hinterlegst.',
				technical:
					'Die Bridge startet ein eigenes Chromium (Playwright) mit einem Profil pro Portal unter ~/.config/belege/portals/<portal>/profile (Verzeichnis 0700), nicht deinen Alltags-Browser. Beim ersten Mal (und wenn die Sitzung abläuft) öffnet es ein sichtbares Fenster: Du meldest dich an, Codes (SMS, E-Mail) und Sicherheitsprüfungen gibst immer du ein. Danach holt es die Rechnungen ohne Fenster. Ein optionales Passwort (pnpm setup:portal vodafone) liegt im macOS-Schlüsselbund und wird nur in das Anmeldeformular des Portals getippt. Nur PDFs (nach ihren Bytes, höchstens 15 MB) kommen in der App an. Kein Sprachmodell, keine Bildschirmfotos; das Protokoll nennt nur den Schritt, der scheiterte. Wer dein macOS-Konto benutzen kann, kann auch die Sitzung im Profil benutzen: FileVault einschalten, „Abmelden“ löscht das Profil. Die Nutzungsbedingungen eines Portals können automatisierten Zugriff einschränken.'
			},
			blockchain: {
				name: 'Blockchain-Abfrage (Nym/Cosmos, Ethereum/EVM, Bitcoin, Filecoin)',
				text: 'Nur für eigene Wallets, die du unter Integrationen einträgst, und nur wenn du „Synchronisieren“ drückst: Die Bridge fragt einen öffentlichen Knoten nach den Überweisungen und dem Bestand der Adresse.',
				leaves:
					'Die Adresse der Wallet und die IP-Adresse dieses Macs – an den Betreiber des Knotens: voreingestellt Nym (rpc.nymtech.net) für Nyx, PublicNode für Akash (für die ältere Geschichte zusätzlich den Akash-Indexer console-api.akash.network, betrieben vom Akash-Team), Blockscout für Ethereum, Base, Arbitrum, Optimism und Polygon – oder Alchemy, wenn du einen Alchemy-API-Schlüssel eingerichtet hast –, oder den Knoten, den du selbst einträgst. Er kann daraus ablesen, dass diese Adresse zu dir gehört; Alchemy ordnet die Abfragen zudem deinem Alchemy-Konto zu. Hat ein Token keinen CoinGecko-Kurs, fragt die Bridge Alchemy außerdem nach seinem Uniswap-Pool im Block der Buchung – Alchemy sieht dann den Token-Vertrag und den Block. Bei Bitcoin fragt die Bridge mempool.space (oder deinen eigenen Esplora-Server) nach jeder Adresse, die sie aus deinem Kontoschlüssel ableitet, kurz nacheinander von derselben IP: Der Betreiber kann daraus schließen, dass alle diese Adressen zusammengehören. Bei Filecoin fragt die Bridge Filfox (filfox.info) nach der Adresse. Für Aleph Cloud, nur wenn du unter Integrationen „Eigene Ethereum-Adressen bei Aleph prüfen“ einschaltest oder ein Aleph-Konto einträgst: jede dieser Adressen an Aleph (api2.aleph.im), nur gelesen – Aleph kann daraus schließen, dass sie zusammengehören.',
				technical:
					'Gefragt wird per HTTPS: bei Cosmos-Chains die CometBFT-RPC (tx_search nach transfer.sender und transfer.recipient, header, status) und die REST-API (Bestand), bei EVM-Chains die Etherscan-kompatible API von Blockscout (txlist, txlistinternal, tokentx, balance) oder, mit Schlüssel, Alchemy (alchemy_getAssetTransfers, Quittungen, Nonce, Bestand; interne Transaktionen auf Arbitrum und Optimism weiter bei Blockscout; für einen Token ohne CoinGecko-Kurs eth_call an die Uniswap-Factories (V2, V3) und den StateView von Uniswap V4 nach seinen Pools gegen ETH und USDC im Block der Buchung; es zählt der tiefste, wenn er auf der ETH- oder USDC-Seite mindestens 3.000 € hält). Der Alchemy-Schlüssel liegt im macOS-Schlüsselbund der Bridge (pnpm setup:alchemy) und steht nur in der Adresse der Anfragen an Alchemy – nie im Browser, nie im Protokoll. Die App schickt die Adresse im Rumpf einer Anfrage an die Bridge, nie in einer URL (an Blockscout geht sie, wie dessen API es verlangt, in der Abfrage-URL); das Protokoll der Bridge nennt nur Zahlen. Kein Schlüssel, keine Signatur: die Adresse ist öffentlich, die Liste deiner Wallets liegt verschlüsselt in deinen Büchern, nicht in der Bridge. Gebucht werden nur Assets aus der Liste der Chain (NYM, NYX, AKT, ETH, POL, USDC mit geprüftem Vertrag); andere Token werden gezählt und ausgelassen. Bei Bitcoin liegt der Kontoschlüssel (xpub, ypub oder zpub) nur im macOS-Schlüsselbund der Bridge; die Bridge leitet daraus die Adressen ab (bis 20 unbenutzte in Folge) und fragt deren bestätigte Transaktionen ab (Esplora-API: address, address/txs/chain). Die App kennt nur einen Fingerabdruck des Schlüssels. Bei Filecoin die öffentliche API von Filfox (address, address/transfers; die Adresse steht in der Abfrage-URL), ohne Schlüssel; Senden, Empfangen und die Gebühren einer Nachricht kommen von dort, die Nachrichten-CID ist der Hash. Links zum Block-Explorer öffnen erst, wenn du sie anklickst.'
			},
			ucep: {
				name: 'Rechnungs-App (UCEP über ein Relay)',
				text: 'Nur wenn du Belege unter Integrationen mit deiner Rechnungs-App koppelst: Belege verbindet sich über ein Relay mit ihr, um für eine Zahlung ohne Beleg einen Eigenbeleg erstellen zu lassen, und – auf deinen Klick „Rechnungen abgleichen“ – um deine ausgestellten Rechnungen zu holen und ihr zu sagen, welche bezahlt sind.',
				leaves:
					'Die IP-Adresse dieses Geräts und die Peer-ID von Belege – an den Betreiber des Relays (eines der Le-Space-Relays, siehe unten). Für einen Eigenbeleg die Angaben dieser einen Zahlung (Datum, Betrag, Beschreibung, Grund, die Gegenpartei, wie du sie einträgst, die interne Kennung der Zahlung in Belege, bei Krypto Chain, Menge, Kurs mit Quelle und Zeitpunkt und den Hash der Transaktion). Für eine bezahlte Rechnung nur: an welchem Tag, welcher Betrag und die interne Kennung der Zahlung – nie Konto, IBAN oder Verwendungszweck. Beides an deine Rechnungs-App, sonst niemanden; deine übrigen Bücher nie.',
				technical:
					'libp2p mit WebSocket zum Relay (Circuit Relay v2) und WebRTC für die direkte Verbindung; Noise verschlüsselt jede Verbindung Ende zu Ende, das Relay sieht nur Chiffretext. Die Peer-ID kommt aus einem Schlüssel, der aus deinem Passkey abgeleitet und nie gespeichert wird. Die Kopplung (UCEP, Le-Space/ucep-spec) gibt Belege nur die Rechte „Eigenbelege erstellen“, „eigene Dokumente lesen“, „ausgestellte Rechnungen lesen“ und „Zahlungen melden“. Ohne Kopplung baut Belege keine Verbindung auf.'
			},
			relays: {
				name: 'Le-Space-Relays (gefunden über Aleph)',
				text: 'Nur wenn Belege ins Netz geht – für die Rechnungs-App oder für deine eigenen Geräte: Belege fragt api.aleph.im nach den aktuellen Adressen der Le-Space-Relays und verbindet sich mit ihnen. Es zählen nur Einträge der beiden Wallets, die Le Space dafür betreibt; fremde Einträge werden ignoriert.',
				leaves:
					'An Aleph (api.aleph.im): die IP-Adresse dieses Geräts, beim Nachschlagen. An den Betreiber des Relays: die IP-Adresse, die Peer-ID von Belege und der Gegenseite, wann ihr verbunden seid und wie viele Bytes fließen – nie Inhalte. Belege nennt dem Relay weder seine Datenbanken noch die Protokolle, die es mit deinen Geräten spricht; die erfährt ein Gerät erst, wenn es den Passkey bewiesen hat. Für eine direkte Verbindung (WebRTC) an öffentliche STUN-Server (Google, Twilio, Cloudflare, Mozilla): die IP-Adresse.',
				technical:
					'Aleph-POST-Nachrichten im Kanal simple-todo (ref simple-todo-bootstrap, Typ relay-bootstrap-v2, Registrierung relay:orbitdb-relay:orbitdb-relay), wie Le-Space/relay-button sie schreibt; genommen wird der neueste Eintrag je Le-Space-Wallet und davon eine TLS-WebSocket-Adresse. Antwortet Aleph nicht, nimmt Belege die zuletzt bekannten Relays. Jede Verbindung über ein Relay ist mit Noise Ende zu Ende verschlüsselt; das Relay kann nichts lesen, nichts verändern und sich nicht als die Gegenseite ausgeben (Noise prüft die Peer-ID). Ein fremdes Relay könnte höchstens sehen, wer wann mit wem verbunden ist, oder Verbindungen verweigern – deshalb nur die Le-Space-Wallets. Die Peer-ID kommt aus deinem Passkey und bleibt gleich; wer sie kennt, kann Verbindungen von Belege wiedererkennen.'
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
				'Auf diesem Rechner, nur wenn du ein Kundenportal anmeldest: dessen Browserprofil mit der Sitzung, und ein Portal-Passwort nur, wenn du es im Schlüsselbund hinterlegst.',
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
	share: {
		title: 'Einblick für einen Assistenten',
		what: 'Ein Assistent auf diesem Rechner (z. B. Claude Code) kann sich Zahlungen, Belege und Rückfragen eines Jahres ansehen, statt mit Bildschirmfotos zu arbeiten. Du wählst, was er sieht und wie lange; die Bridge hält die Freigabe nur im Arbeitsspeicher und zählt jeden Abruf.',
		note: 'Was ein Assistent liest, geht als Gesprächsinhalt an seinen Anbieter.',
		needsBridge: 'Dafür muss die Bridge gekoppelt sein.',
		collections: 'Was freigegeben wird',
		scope: {
			transactions: 'Zahlungen',
			receipts: 'Belege',
			questions: 'Rückfragen',
			redacted: 'geschwärzt'
		},
		redacted:
			'Geschwärzt (IBANs bis auf die letzten vier, keine E-Mail-Adressen, Rufnummern, Kunden- und Vertragsnummern, Dateinamen oder Absender)',
		unredactedWarning:
			'Ungeschwärzt: IBANs, Dateinamen, Absender und alle Nummern gehen so hinaus, wie sie gespeichert sind.',
		duration: 'Gültig für',
		create: 'Freigabe für {year} erstellen',
		command: 'Der Assistent liest die Freigabe mit diesem Befehl:',
		copyCommand: 'Befehl kopieren',
		until: 'bis {time}',
		reads: '{count}× gelesen',
		revoke: 'Widerrufen',
		refresh: 'Abrufe aktualisieren'
	},
	restore: {
		title: 'Wiederherstellen',
		what: 'Ein Backup dieses Passkeys zurück in die Bücher hier. Was hier ist, bleibt; was das Backup enthält, kommt dazu – gelöscht wird nichts. Am Ende lädt die Seite neu, und der Passkey öffnet die Bücher wieder.',
		leaves:
			'Geht hinaus: die CID des Backups an Alephs Gateway (es sieht die IP-Adresse dieses Computers). Die Datei kommt versiegelt zurück und wird hier geöffnet.',
		none: 'Noch kein Backup bekannt. Koppel die Bridge, dann zeigt sie die ihres Aleph-Kontos, oder gib eine CID ein.',
		cidLabel: 'Oder die CID eines Backups',
		pick: 'Wiederherstellen',
		notACid: 'Das ist keine CID.',
		confirm:
			'Dieses Backup in diese Bücher wiederherstellen? Sie werden zusammengeführt; am Ende lädt die Seite neu.',
		yes: 'Ja, wiederherstellen',
		no: 'Abbrechen',
		fetching: 'Backup wird von Aleph geholt …',
		opening: 'Backup wird geöffnet …',
		database: 'Datenbank {index} von {total}: {name} …',
		done: 'Wiederhergestellt. Die Seite lädt neu – entsperre mit dem Passkey.',
		wrongPasskey:
			'Dieses Backup lässt sich mit diesem Passkey nicht öffnen: Es wurde mit einem anderen gemacht.',
		notFetched: 'Alephs Gateway hat das Backup nicht zurückgegeben. Versuch es gleich noch einmal.'
	},
	backup: {
		title: 'Backup',
		what: 'Alles, was Belege in diesem Browser hält – die Bücher und jede Belegdatei – als eine Datei, versiegelt mit einem Schlüssel aus deinem Passkey, aufbewahrt bei Aleph Cloud. Öffnen kannst nur du sie.',
		needsBridge:
			'Die Bridge muss gekoppelt sein: Sie unterschreibt den Auftrag, mit dem Aleph das Backup aufbewahrt.',
		notSetUp: 'Die Bridge hat noch keinen Backup-Schlüssel. Im Terminal, im Ordner von Belege:',
		account: 'Aleph-Konto',
		copyAddress: 'Adresse kopieren',
		credits: 'Credits',
		creditsUnknown: 'unbekannt – Aleph hat nicht geantwortet',
		noCredits:
			'Das Konto hat keine Credits. Aleph bewahrt ein Backup nur auf, solange das Konto zahlen kann: lade Credits unter app.aleph.cloud auf oder schick ALEPH an die Adresse.',
		leaves:
			'Geht hinaus: die versiegelte Datei an Alephs IPFS-Host (er sieht die IP-Adresse dieses Computers und die Größe) und von der Bridge ein mit ihrem Backup-Schlüssel unterschriebener Auftrag, der die Datei nennt.',
		now: 'Jetzt sichern',
		step: {
			packing: 'Wird gepackt und versiegelt …',
			uploading: 'Wird zu Aleph hochgeladen …',
			keeping: 'Aleph wird beauftragt …'
		},
		paused: 'Das Netz ist pausiert.',
		made: 'Gesichert: {size}, {entries} Einträge, {files} Belegdateien – {kept}.',
		kept: 'von Aleph aufbewahrt',
		pending: 'Aleph hat noch nicht bestätigt',
		cid: 'Zurück bekommst du es über:',
		copyCid: 'CID kopieren',
		missing:
			'{count} Blöcke waren nicht in diesem Browser und fehlen im Backup. Mit Gerätesync: öffne die Bücher auf dem Gerät, das sie hat.',
		progress: {
			database: 'Datenbank {index} von {total}: {name}, {entries} Einträge …',
			files: 'Belegdateien: {done} von {total} …',
			sealing: '{size} werden versiegelt …'
		},
		contents: 'Was drin ist',
		files: 'Belegdateien',
		blocks: 'Blöcke insgesamt',
		history: 'Bisherige Backups'
	},
	aleph: {
		title: 'Aleph Cloud (Hosting-Credits)',
		what: 'Aleph stellt keine Rechnung aus: Hosting und Speicher werden mit Credits bezahlt. Hier entsteht pro Aleph-Konto und Monat ein Verbrauchsnachweis als Eigenbeleg – Anfangs- und Endbestand, Aufladungen, Verbrauch je Tag (Speicher gesammelt, jede Instanz einzeln) mit Euro-Wert. Nur gelesen: nichts wird signiert oder bewegt.',
		needsBridge: 'Braucht die gekoppelte Bridge.',
		scanLabel: 'Eigene Ethereum-Adressen bei Aleph prüfen',
		scanPrivacy:
			'Die Adressen unter „Eigene Wallets“ (Ethereum und andere EVM-Chains) werden bei Aleph nach Credits gefragt. Aleph kann daraus schließen, dass sie zusammengehören.',
		extraLabel: 'Weiteres Aleph-Konto (0x…)',
		extraAdd: 'Hinzufügen',
		badAddress: 'Das ist keine Aleph-Kontoadresse (0x und 40 Hex-Zeichen).',
		scan: 'Bei Aleph prüfen',
		scanning: 'Prüfe …',
		scanned: '{asked} Adressen geprüft, {found} davon mit Aleph-Credits.',
		none: 'Noch kein Aleph-Konto gefunden. Prüfung einschalten oder ein Konto eintragen, dann „Bei Aleph prüfen“.',
		credits: '{credits} Credits (Stand {date})',
		month: 'Monat',
		make: 'Verbrauchsnachweis erstellen',
		making: 'Erstelle …',
		exists: 'Nachweis {number} liegt unter Belege.',
		made: 'Eigenbeleg {number} für {month} erstellt ({eur}); er liegt unter Belege.'
	},
	pwa: {
		update: 'Eine neue Version von Belege ist da. Neu laden – danach mit dem Passkey entsperren.',
		reload: 'Neu laden',
		installWhat:
			'Belege lässt sich als App installieren: eigenes Fenster und Symbol, startet auch offline. Die Bücher bleiben auf diesem Gerät.',
		install: 'Als App installieren',
		later: 'Nicht jetzt'
	},
	devices: {
		title: 'Eigene Geräte',
		what: 'Dieselben Bücher auf deinem Telefon oder einem zweiten Rechner: Beide Geräte brauchen denselben Passkey (über den Schlüsselbund synchronisiert) und die eingeschaltete Synchronisation.',
		off: 'Auf diesem Gerät ist die Synchronisation aus. Einschalten im Hinweis „Datenschutz & Technik“ unter „Eigene Geräte synchronisieren“; sie gilt ab dem nächsten Entsperren.',
		openConsent: 'Hinweis öffnen',
		pending: 'Eingeschaltet – gilt ab dem nächsten Entsperren (Seite neu laden).',
		self: 'Kennung dieses Geräts',
		selfHint: 'Auf dem anderen Gerät unter „Gerät hinzufügen“ eintragen.',
		reachable: 'über den Relay erreichbar',
		notReachable: 'wartet auf den Relay …',
		copy: 'Kennung kopieren',
		add: 'Gerät hinzufügen',
		addLabel: 'Kennung des anderen Geräts',
		addButton: 'Verbinden',
		list: 'Bekannte Geräte',
		none: 'Noch kein anderes Gerät.',
		connected: 'verbunden',
		direct: 'direkt',
		viaRelay: 'über den Relay',
		bridgeShare: 'Bridge dieses Rechners für eigene Geräte freigeben',
		bridgeShareText:
			'Nur auf dem Rechner, auf dem die Bridge läuft und gekoppelt ist: Deine anderen Geräte (dasselbe Buch, in der Liste unten) nutzen Bank, Postfach, KI, Kurse und Wallets über ihn. Nur lesende und fragende Abfragen, keine Einrichtung, nichts wird gelöscht; der Zugang zur Bridge bleibt hier. Gilt ab dem nächsten Entsperren, solange dieser Tab offen und entsperrt ist.',
		bridgeServed: 'Die Bridge dieses Rechners steht deinen Geräten zur Verfügung.',
		bridgePending: 'Freigegeben – gilt ab dem nächsten Entsperren (Seite neu laden).',
		notConnected: 'nicht verbunden',
		unnamed: 'Gerät ohne Namen',
		showQr: 'Als QR-Code zeigen',
		hideQr: 'QR-Code ausblenden',
		qrLabel: 'QR-Code mit der Kennung dieses Geräts',
		qrHint: 'Auf dem anderen Gerät unter „Gerät hinzufügen“ mit „QR-Code scannen“ erfassen.',
		scan: 'QR-Code scannen',
		scanStop: 'Scannen abbrechen',
		scanHint:
			'Den QR-Code des anderen Geräts vor die Kamera halten. Das Bild bleibt auf diesem Gerät.',
		scanFailed:
			'Die Kamera ließ sich nicht öffnen ({reason}). Die Kennung lässt sich auch einfügen.',
		scanWrong: 'Dieser QR-Code ist keine Gerätekennung.',
		bothMode:
			'„Beides“: Ein neues Gerät kommt per QR-Code oder über den Relay deiner Bridge dazu; danach treffen sich die Geräte auch über die öffentlichen Relays.',
		qrMode: {
			what: 'Ohne Relay: Ein Gerät zeigt eine Einladung, das andere scannt sie und zeigt seine Antwort, das erste scannt die Antwort. Dann sind beide direkt verbunden – kein Relay, kein Server dazwischen.',
			invite: 'Einladung zeigen',
			inviteLabel: 'QR-Code mit der Einladung dieses Geräts',
			inviteHint:
				'Mit dem anderen Gerät scannen und dann dessen Antwort hier mit „QR-Code scannen“ erfassen. Gilt zehn Minuten.',
			answerLabel: 'QR-Code mit der Antwort dieses Geräts',
			answerHint: 'Mit dem Gerät scannen, das die Einladung gezeigt hat.',
			copy: 'Code kopieren',
			pasteLabel: 'Oder den Code des anderen Geräts einfügen',
			use: 'Verwenden',
			connected: 'Verbunden: Das andere Gerät hat den Passkey bewiesen und ist hinzugefügt.',
			limits:
				'Beide Geräte müssen im selben Netz sein (WLAN ohne Client-Isolation). Nach einem Neuladen oder einer abgerissenen Verbindung tauschen sie einmal neu Codes.'
		},
		remove: 'Entfernen',
		removeConfirm: 'Wirklich entfernen',
		removeCancel: 'Abbrechen',
		removeWhat:
			'Die Geräte synchronisieren nicht mehr mit ihm, und es schaltet seine Synchronisation ab, sobald es davon erfährt. Wer den Passkey hat, kann die Bücher trotzdem öffnen – bei einem verlorenen Gerät den Passkey im Schlüsselbund löschen.',
		removed:
			'Dieses Gerät wurde auf einem anderen Gerät entfernt; die Synchronisation ist hier ausgeschaltet. Wieder einschalten im Hinweis „Datenschutz & Technik“ – dann gilt das neuere Einschalten.'
	},
	vendorAccount: {
		open: 'Lieferantenkonto ansehen',
		title: 'Lieferantenkonto: {name}',
		back: 'Zu den Zahlungen',
		intro:
			'Alle Zahlungen und Belege dieses Lieferanten auf einer Zeitleiste, mit laufendem Saldo: Anfangsbestand + Zahlungen − Verbrauch laut Belegen. Für Guthaben- und Sammelabrechnungen, bei denen eine Zahlung nie zu genau einem Beleg passt.',
		opening: 'Anfangsbestand {date}',
		unknown: 'unbekannt',
		topUps: 'Zahlungen / Aufladungen',
		usage: 'Verbrauch laut Belegen',
		closing: 'Saldo {date}',
		wholeYear: 'Ganzes Jahr {year} zeigen',
		findings: 'Was nicht zusammenpasst',
		finding: {
			negative:
				'Am {date} ist der Saldo negativ ({amount}): mehr verbraucht als bezahlt – eine Zahlung oder der Anfangsbestand fehlt.',
			gap: 'Für {month} gibt es keinen Beleg – vermutlich fehlt eine Rechnung.',
			'no-statements': 'Es gibt Zahlungen, aber keinen einzigen Beleg dieses Lieferanten.',
			january:
				'Der Beleg vom {date} ({amount}) kann noch das Vorjahr abrechnen – bitte prüfen, bevor er diesem Jahr zugerechnet wird.',
			'unknown-opening':
				'Der erste Vorgang ist ein Beleg ({date}): Ohne Anfangsbestand ist der Saldo davor unbekannt.',
			'previous-year':
				'Der Beleg vom {date} ({amount}) rechnet einen Zeitraum des Vorjahres ab – er gehört zum Verbrauch des Vorjahres.'
		},
		period: 'Zeitraum',
		items: 'Positionen',
		explain: 'Ungereimtheiten erklären',
		explainTitle:
			'Schickt die Zeitleiste an dein Sprachmodell: Daten, Beträge, Zeiträume, Positionen und die Befunde – geschwärzt, ohne Rufnummern, Kunden- und Rechnungsnummern. Nur Hinweise, gebucht wird nichts.',
		explainNeedsBridge: 'Dafür muss die Bridge mit einem Sprachmodell gekoppelt sein.',
		notes: 'Hinweise der KI',
		pdf: 'Als PDF herunterladen',
		isPrepaid:
			'Als Guthabenkonto geführt: Aufladungen brauchen keinen eigenen Beleg, die Verbrauchsnachweise gelten als zugeordnet.',
		openingLabel: 'Anfangsbestand am 1.1.{year} (EUR, z. B. aus dem Kundenkonto)',
		save: 'Speichern',
		prepaidOff: 'Nicht mehr als Guthabenkonto führen',
		suggest:
			'Sieht aus wie ein Guthabenkonto: Zahlungen und Belege passen nicht einzeln zusammen, die Aufladungen sind runde Beträge oder die Belege sind keine Zahlungsaufforderung.',
		prepaidWhat:
			'Als Guthabenkonto geführt, belegen die Verbrauchsnachweise die Aufladungen: keine Rückfragen mehr zu einzelnen Aufladungen, die Belege erscheinen als „Guthabenkonto“. Die Zeitleiste zeigt, ob alles aufgeht.',
		prepaidOn: 'Als Guthabenkonto führen',
		payment: 'Zahlung',
		statement: 'Beleg',
		empty: 'Keine Zahlungen oder Belege dieses Lieferanten in diesem Zeitraum.',
		col: { date: 'Datum', what: 'Vorgang', topUp: 'Zahlung', usage: 'Verbrauch', balance: 'Saldo' }
	},
	year: {
		label: 'Jahr',
		fromYear: 'Beleg aus {year}',
		fromYearTitle: 'Der Beleg ist von {year}; die Zahlung fällt in dieses Jahr.',
		hidden: '{count} weitere in anderen Jahren'
	},
	home: {
		ownIban: {
			title: 'Ist das ein eigenes Konto?',
			what: 'Von diesen IBANs kommt Geld unter eurem Firmennamen – meist ein eigenes Konto, dessen Auszüge die IBAN nicht nennen (Wise zum Beispiel). Als eigene IBAN gespeichert, gilt jede Zahlung dorthin als eigene Umbuchung.',
			sends: 'schickt unter „{name}“ ({count}×)',
			explainsOne: 'Erklärt 1 Zahlung ohne Beleg an diese IBAN.',
			explains: 'Erklärt {count} Zahlungen ohne Beleg an diese IBAN.',
			explainsNone: 'Noch keine Zahlung ohne Beleg an diese IBAN.',
			open: 'Zahlung ansehen',
			yes: 'Ja, eigenes Konto',
			no: 'Nein, nicht unseres'
		},
		integrationNeeds: 'Integrationen brauchen dich',
		privateOpen: {
			title: 'Privat bezahlt, noch nicht ausgeglichen: {count} ({amount})',
			what: 'Private Zahlungen vom Geschäftskonto. Zahl sie vom Privatkonto zurück und verknüpfe die Rückzahlung an der Zahlung.'
		},
		transferReceipts: {
			title: 'Umbuchung mit Beleg: {count} zu prüfen',
			what: 'Diese Zahlungen gelten jetzt als eigene Umbuchung und brauchen keinen Beleg, haben aber noch einen zugeordnet – oft aus der Zeit, bevor die Umbuchung erkannt wurde. Löse die Zuordnung, wenn der Beleg nicht dazugehört; sonst bestätige ihn.',
			receipt: 'Zugeordnet: {vendor}',
			open: 'Zahlung öffnen',
			unlink: 'Zuordnung lösen',
			keep: 'Beleg ist richtig'
		},
		resume: {
			extract:
				'{count} Belege wurden nicht fertig ausgelesen, als die Seite neu geladen oder gesperrt wurde. Weitermachen?',
			suggest:
				'Für {count} Rückfragen fehlen noch KI-Vorschläge, weil der Lauf unterbrochen wurde. Weitermachen?',
			go: 'Weitermachen',
			drop: 'Verwerfen',
			noBridge: 'Ohne gekoppelte Bridge geht das nicht – unter Integrationen koppeln.'
		},
		morning: 'Guten Morgen',
		day: 'Guten Tag',
		evening: 'Guten Abend',
		intro: 'Hier steht, was in deinen Büchern liegt.',
		transactions: 'Zahlungen',
		receipts: 'Belege',
		partners: 'Partner',
		totals: {
			title: 'Einnahmen und Ausgaben {year}',
			what: 'Was von außen hereinkam und nach außen ging, wie gebucht (brutto). Umbuchungen zwischen eigenen Konten, Tausch und Handel zählen nicht; Erstattungen sind mit ihrer Belastung verrechnet.',
			income: 'Einnahmen',
			expenses: 'Ausgaben',
			bank: 'Bank',
			crypto: 'Krypto',
			total: 'Gesamt',
			balance: 'Saldo',
			private: 'Privat vom Geschäftskonto bezahlt',
			privateLine: '{paid} bezahlt · {repaid} zurückgezahlt',
			loans: 'Darlehen',
			loansLine: '{received} erhalten · {paid} gezahlt',
			taxes: 'Steuern ans Finanzamt',
			taxesLine: '{paid} gezahlt · {refunded} erstattet',
			unpricedOne: '1 Krypto-Buchung ohne Kurs ist nicht mitgezählt.',
			unpricedMany: '{count} Krypto-Buchungen ohne Kurs sind nicht mitgezählt.',
			show: 'ansehen',
			none: 'Noch keine Zahlungen in diesem Jahr.'
		},
		identity: 'Deine Identität',
		identityHint:
			'Die DID ist der öffentliche Schlüssel deines Passkeys. Sie verrät nichts über deine Daten.',
		agentTitle: 'Dein Beleg-Agent wartet auf dich',
		agentKind: 'Rückfrage',
		agentOpenOne: '1 offene Rückfrage',
		agentOpenMany: '{count} offene Rückfragen',
		agentNone: 'Keine offenen Rückfragen – alles zugeordnet, was sich zuordnen lässt.',
		vat: {
			title: 'Vorsteuer {year}',
			what: 'Die Mehrwertsteuer aus deinen Belegen zu 19 % und 7 %, nach Belegdatum. So, wie die Belege ausgelesen wurden – eine Hilfe für die Voranmeldung, nicht die Voranmeldung selbst.',
			period: 'Zeitraum',
			rate19: '19 %',
			rate7: '7 %',
			sum: 'Vorsteuer',
			year: 'Jahr',
			quarter: 'Q{n}',
			unlinked:
				'Davon {amount} aus Belegen, die noch mit keiner Zahlung verknüpft sind (Belege: {count}).',
			foreign:
				'Ausländische Mehrwertsteuer: {amount} (Belege: {count}) – keine deutsche Vorsteuer, nicht mitgezählt.',
			reverse:
				'§13b (Leistung aus dem Ausland): {amount} (Belege: {count}). Du schuldest die Umsatzsteuer darauf und ziehst sie zugleich als Vorsteuer ab – unterm Strich null, aber anzugeben.',
			noLines:
				'Belege ohne Steuerzeile: {count}. Nichts abzuziehen, oder nicht ausgelesen – ansehen lohnt sich.',
			other: 'Belege in fremder Währung, nicht mitgezählt: {count}.',
			undated: 'Belege ohne Datum, keinem Zeitraum zugeordnet: {count}.',
			smallBusiness:
				'Als Kleinunternehmer (§19 UStG) ziehst du keine Vorsteuer ab. In deinen Belegen dieses Jahres stecken {amount} Mehrwertsteuer.',
			outputLater:
				'Die Umsatzsteuer aus deinen Ausgangsrechnungen und die Zahllast folgen, sobald die Rechnungs-App die Steuer je Satz liefert.'
		},
		agentProgress: '{done} von {total} erledigt',
		agentAnswer: 'Rückfragen beantworten',
		coverage: 'Zahlungen mit Beleg',
		coverageText: '{covered} von {count} ({percent} %)',
		matchRun: 'Abgleich starten',
		matchRunning: 'Gleiche ab …',
		matchResult: '{sure} zugeordnet · {questions} · {classified} ohne Beleg-Pflicht',
		matchWaiting: ' · {count} warten noch',
		matchQuestionsOne: '1 Rückfrage',
		matchQuestionsMany: '{count} Rückfragen',
		matchFailed: 'Der Abgleich ist fehlgeschlagen.',
		matchStep: {
			read: 'Lese Zahlungen und Belege …',
			score: 'Vergleiche {receipts} Belege mit {transactions} Zahlungen …',
			write: 'Schreibe die Zuordnungen …',
			done: 'Fertig.'
		},
		matchHow:
			'Der Abgleich vergleicht jeden Beleg mit jeder offenen Zahlung und vergibt Punkte für Betrag, Rechnungsnummer, Anbieter, IBAN und Datum. Das macht die App selbst, auf diesem Gerät – die KI liest nur die Belege aus.',
		verlaufLink: 'Im Verlauf ansehen',
		technical: [
			'Die Bücher sind acht OrbitDB-Dokumentdatenbanken (transactions, receipts, partners, accounts, settings, matches, questions, events), jeder Eintrag mit AES-GCM versiegelt; Beträge in ganzen Cent, gelöscht wird weich (deleted).',
			'Schlüssel und Datenbanknamen kommen per HKDF-SHA-256 aus der PRF-Antwort des Passkeys und werden bei jedem Entsperren neu abgeleitet.'
		]
	},
	matching: {
		reason: {
			instalment: 'Teilzahlung',
			'remaining-amount': 'Restbetrag',
			amount: 'Betrag',
			'invoice-number': 'Rechnungsnummer',
			'customer-number': 'Kundennummer',
			iban: 'IBAN',
			vendor: 'Anbieter',
			'vendor-in-purpose': 'Anbieter im Zweck',
			'vendor-learned': 'Anbieter (gelernt)',
			date: 'Datum',
			'far-date': 'Datum weit weg',
			'wrong-direction': 'Richtung falsch',
			manual: 'von Hand',
			eigenbeleg: 'Eigenbeleg',
			'crypto-hash': 'Tx-Hash im Beleg',
			'crypto-address': 'Adresse im Beleg',
			'crypto-amount': 'Menge im Beleg'
		},
		badge: {
			receipt: 'Beleg',
			'no-receipt': 'Kein Beleg nötig',
			'private-mistake': 'Privat (Irrläufer)',
			'private-repayment': 'Rückzahlung privat',
			'own-transfer': 'Eigene Umbuchung',
			'bank-fee': 'Kontoauszug',
			loan: 'Darlehen',
			wage: 'Lohn',
			'payroll-tax': 'Lohnsteuer',
			'social-security': 'Sozialabgaben',
			'tax-payment': 'Steuer',
			'crypto-reward': 'Ertrag der Börse',
			'crypto-stake': 'Staking',
			refund: 'Erstattung',
			'prepaid-topup': 'Guthabenkonto',
			'crypto-swap': 'Tausch',
			'token-burn': 'Vom Projekt verbrannt',
			'token-migration': 'Token-Migration',
			'crypto-dust': 'Staub',
			'rule-ignore': 'Ignoriert',
			'rule-private': 'Privat'
		},
		kind: {
			'own-transfer': 'Eigene Umbuchung (1360) – kein Beleg nötig',
			'bank-fee': 'Bankentgelt – der Kontoauszug ist der Beleg',
			loan: 'Darlehen – der Vertrag ist der Beleg',
			wage: 'Lohnzahlung – der Beleg ist die Lohnabrechnung aus der Lohnbuchhaltung',
			'payroll-tax': 'Lohnsteuer an das Finanzamt – der Beleg ist die Lohnsteuer-Anmeldung',
			'social-security': 'Sozialabgaben – der Beleg ist der Beitragsnachweis',
			'tax-payment': 'Steuerzahlung – der Beleg ist die Anmeldung oder der Bescheid',
			'crypto-reward': 'Staking- oder Earn-Ertrag – der Kontoauszug der Börse ist der Beleg',
			'crypto-stake': 'Delegiert ins Staking – kein Beleg nötig, nicht auf 1360',
			refund: 'Belastung und Erstattung – kein Beleg nötig',
			'prepaid-topup': 'Aufladung eines Guthabenkontos – belegt durch die Verbrauchsnachweise',
			'crypto-swap': 'Tausch über eine DEX – die Transaktion im Block-Explorer ist der Beleg',
			'token-burn': 'Vom Token-Projekt verbrannt – keine Zahlung, kein Beleg',
			'token-migration': 'Token-Migration – beide Transaktionen im Block-Explorer sind der Beleg',
			'crypto-dust': 'Staub unter einem Cent – kein Beleg nötig',
			'rule-ignore': 'Ignoriert nach eigener Anweisung: {reason}',
			'rule-private': 'Privat nach eigener Anweisung: {reason}',
			'no-receipt': 'Kein Beleg nötig: {reason}'
		},
		state: { auto: 'automatisch', confirmed: 'bestätigt' },
		score: '{score} Punkte',
		waiting: 'wartet noch ({days} Tage)',
		waitingOne: 'wartet noch (1 Tag)'
	},
	explain: {
		reason: {
			instalment: 'eine Teilzahlung: weniger als noch offen',
			'remaining-amount': 'Betrag gleich dem noch offenen Rest',
			amount: 'Betrag gleich',
			amountValue: 'Betrag gleich ({amount})',
			invoice: 'Rechnungsnummer im Verwendungszweck',
			invoiceValue: 'Rechnungsnummer {number} im Verwendungszweck',
			customer: 'Kundennummer im Verwendungszweck',
			customerValue: 'Kundennummer {number} im Verwendungszweck',
			vendor: 'Anbieter passt',
			vendorValue: 'Anbieter {vendor}',
			vendorLearned: 'Anbieter passt – so hast du es schon einmal zugeordnet',
			vendorLearnedValue:
				'Anbieter {vendor} – „{counterparty}“ hast du ihm schon einmal zugeordnet',
			vendorInPurpose: 'Anbieter im Verwendungszweck',
			vendorInPurposeValue: 'Anbieter {vendor} im Verwendungszweck',
			iban: 'IBAN des Anbieters ist das Gegenkonto',
			date: 'Datum passt',
			'far-date': 'Datum liegt weit weg',
			'wrong-direction': 'Richtung passt nicht (Eingang statt Ausgang oder umgekehrt)',
			'crypto-hash': 'der Transaktions-Hash steht im Beleg',
			'crypto-address': 'die Gegenadresse steht im Beleg',
			'crypto-amount': 'die Menge mit Asset steht im Beleg'
		},
		how: {
			auto: 'automatisch zugeordnet',
			confirmed: 'von dir bestätigt',
			manual: 'von dir zugeordnet'
		},
		points: '{score} Punkte',
		thresholds:
			'Automatisch zugeordnet wird ab {sure} Punkten, und nur, wenn kein anderer Beleg und keine andere Zahlung näher als {lead} Punkte herankommt. Sonst fragt die App nach.',
		field: {
			counterparty: 'Gegenpartei',
			purpose: 'Verwendungszweck',
			any: 'Gegenpartei oder Zweck'
		},
		rule: {
			noReceipt: 'Von dir entschieden: Kein Beleg nötig – {reason}',
			noReason: 'ohne Grund',
			ownCompany: 'Eigene Umbuchung: Die Gegenpartei ist deine Firma „{company}“',
			ownIban: 'Eigene Umbuchung: Das Gegenkonto ist dein Konto {account}',
			ownIbanFound: '– die Gegenbuchung dort vom {date} ist verknüpft.',
			ownIbanMissing:
				'– dort ist keine Gegenbuchung mit diesem Betrag in den Tagen darum. Ist der Kontoauszug dieses Kontos vollständig importiert?',
			ownCounter:
				'Eigene Umbuchung: Die Gegenbuchung steht auf {account} am {date} – gleicher Betrag in die andere Richtung, und „{sign}“ sagt Umbuchung. Kein Beleg nötig (Konto 1360).',
			otherAccount: 'deinem anderen Konto',
			ownMirrored:
				'Eigene Umbuchung: Das Gegenkonto endet wie dein Konto {account}, und dort steht die Gegenbuchung',
			bankFee: 'Bankentgelt: Buchungsart „{type}“ – der Kontoauszug ist der Beleg',
			bankFeeCode:
				'Bankentgelt: Buchungscode der Bank „{code}“ (Gebühren) – der Kontoauszug ist der Beleg',
			bankFeeWords:
				'Bankentgelt: „{word}“ im Verwendungszweck, und außer der Bank keine Gegenpartei – der Kontoauszug ist der Beleg',
			bankFeeLearned:
				'Bankentgelt: So hast du eine Buchung mit diesem Verwendungszweck schon einmal eingeordnet – der Kontoauszug ist der Beleg',
			loan: 'Darlehen: „Darlehen“ im Verwendungszweck – der Vertrag ist der Beleg',
			wageEmployee:
				'Lohn an {employee} (auf deiner Mitarbeiterliste){period}: Der Beleg ist die Lohnabrechnung aus der Lohnbuchhaltung, nicht diese Zahlung.',
			wageWords:
				'„Lohn“, „Gehalt“ oder „Minijob“ im Verwendungszweck{period}: Der Beleg ist die Lohnabrechnung aus der Lohnbuchhaltung, nicht diese Zahlung.',
			payrollTax:
				'Lohnsteuer an das Finanzamt{period}: Der Beleg ist die Lohnsteuer-Anmeldung aus der Lohnbuchhaltung.',
			social: 'Beiträge an {counterparty}{period}: Der Beleg ist der Beitragsnachweis.',
			tax: '{tax} an {office}{period}: Der Beleg ist die Voranmeldung oder der Steuerbescheid.',
			taxName: {
				vat: 'Umsatzsteuer',
				corporate: 'Körperschaftsteuer',
				trade: 'Gewerbesteuer',
				other: 'Steuer'
			},
			taxOffice: 'das Finanzamt',
			taxNumber: 'das Finanzamt (Steuernummer im Verwendungszweck)',
			period: ' für {period}',
			exchangeFee:
				'Gebühr der Börse: Kraken hat sie zu dieser Buchung berechnet – der Kontoauszug der Börse ist der Beleg',
			networkFee: 'Netzwerkgebühr der Blockchain: die Transaktion im Block-Explorer ist der Beleg',
			ownAddress:
				'Eigene Übertragung: Die Gegenadresse {address} ist deine Wallet {account}. Kein Beleg nötig (Konto 1360).',
			ownIbc:
				'Eigene Übertragung per IBC: Der Empfänger {address} auf der anderen Chain ist deine Wallet {account}. Kein Beleg nötig (Konto 1360).',
			ownManual:
				'Eigene Umbuchung, von dir verknüpft: Die Gegenbuchung steht auf {account} am {date}. Kein Beleg nötig (Konto 1360).',
			ownBridge:
				'Eigene Übertragung über eine Bridge: Die Gegenbuchung steht auf {account} am {date} – dieselbe Kryptowährung, dieselbe Menge abzüglich der Bridge-Gebühr (höchstens 3 %), innerhalb von 8 Tagen. Kein Beleg nötig (Konto 1360).',
			prepaidTopup:
				'Aufladung des Guthabenkontos bei {vendor}: belegt durch dessen Verbrauchsnachweise im Lieferantenkonto – kein eigener Beleg nötig.',
			refunded:
				'Voll erstattet: Die Erstattung steht auf {account} am {date} ({how}). Belastung und Erstattung heben sich auf – kein Beleg nötig.',
			refundOf:
				'Erstattung zur Belastung auf {account} vom {date} ({how}). Die Erstattung braucht keinen eigenen Beleg; bei einer Teilerstattung braucht die Belastung weiter ihren.',
			refundAuto: 'gleiche Gegenpartei, „Erstattung“ im Text',
			refundManual: 'von dir verknüpft',
			swap: 'Tausch über eine dezentrale Börse (DEX): Die Wallet hat ein Asset gegeben und ein anderes bekommen, in einer Transaktion. Die Transaktion im Block-Explorer ist der Beleg. Steuerlich eine Veräußerung und eine Anschaffung zum Tageswert – das klärt ihr mit dem Steuerberater.',
			swapCross:
				'Tausch über eine andere Chain (Skip Go, Osmosis): Das Ergebnis kam am {date} auf {account} an. Beide Transaktionen im Block-Explorer sind der Beleg. Steuerlich eine Veräußerung und eine Anschaffung zum Tageswert – das klärt ihr mit dem Steuerberater.',
			swapCrossArrival:
				'Ankunft eines Tauschs über eine andere Chain (Skip Go, Osmosis): gesendet am {date} von {account}. Beide Transaktionen im Block-Explorer sind der Beleg.',
			swapCrossMissing:
				'Tausch über eine andere Chain (Skip Go, Osmosis) an {address} – dieselbe Adresse wie diese Wallet, aber nicht als eigene Wallet angelegt. Leg sie unter Integrationen → Eigene Wallets an, dann findet Belege die Ankunft.',
			swapCrossNone:
				'Tausch über eine andere Chain (Skip Go, Osmosis) an deine Wallet {address} – die Ankunft ist dort noch nicht gebucht. Synchronisiere die Wallet, oder verknüpfe sie von Hand als Tausch.',
			swapCrossMany:
				'Tausch über eine andere Chain (Skip Go, Osmosis) an deine Wallet {address} – {count} Ankünfte passen. Verknüpfe die richtige von Hand als Tausch.',
			swapManual: 'Von dir als Tausch verknüpft mit {account} am {date}.',
			tokenBurn:
				'Vom Projekt verbrannt: Die Transaktion hat nicht diese Wallet gesendet, sondern das Token-Projekt (ein Rebase oder eine Migration) – keine Zahlung an jemanden, kein Beleg. Gab es dafür einen neuen Token, verknüpfe ihn als Migration.',
			tokenMigration:
				'Token-Migration: verknüpft mit {account} am {date}. Der neue Token übernimmt den Wert (die Anschaffungskosten) des verbrannten – keine Veräußerung. Die Beurteilung liegt beim Steuerberater.',
			staking:
				'Staking: Die Tokens sind delegiert und bleiben deine. Kein Beleg nötig. Nicht auf 1360 – ihre Rückkehr nach dem Unbonding ist keine Transaktion, eine Umbuchung ginge nie auf; das Konto klärt ihr mit dem Steuerberater.',
			dust: 'Staub: weniger als ein Cent wert, empfangen, ohne dass du etwas getan hast. Kein Beleg nötig. Oft ein Test oder Werbung – oder der Anfang einer Adressvergiftung: Verwende die Absenderadresse nie als Empfänger.',
			dustLookalike:
				'Staub von einer Adresse, die aussieht wie {known}, aber eine andere ist – sehr wahrscheinlich Adressvergiftung. Kein Beleg nötig.',
			cryptoReward:
				'Staking- oder Earn-Ertrag der Börse – der Kontoauszug ist der Beleg. Auf welches Konto er gehört, klärt ihr mit dem Steuerberater.',
			ignore: 'Eigene Anweisung: {field} enthält „{contains}“ → ignoriert ({reason})',
			private: 'Eigene Anweisung: {field} enthält „{contains}“ → privat ({reason})'
		},
		why: 'Warum diese Zuordnung?',
		whyNone: 'Warum kein Beleg nötig?',
		question: 'Offene Rückfrage: diese Belege kommen in Frage',
		noCandidates: 'Kein Beleg erreicht genug Punkte, um ihn vorzuschlagen.',
		waiting: 'Noch kein Beleg – der Abgleich wartet noch {days} Tage, dann fragt er nach.',
		waitingOne: 'Noch kein Beleg – der Abgleich wartet noch 1 Tag, dann fragt er nach.',
		notAi: 'Die Zuordnung macht die App selbst nach Punkten, nicht die KI.',
		technical: [
			'Die Punkte kommen aus app/src/lib/matching/score.js: Betrag 40, Rechnungsnummer im Zweck oder in der End-to-End-ID 50, Kundennummer 20, IBAN 15, Anbieter 20 (im Zweck 10), Datum im Fenster Rechnungsdatum −5 bis Fälligkeit +10 Tage 10; mehr als 60 Tage daneben −30, falsche Richtung −40.',
			'Gespeichert sind Punkte und Gründe im versiegelten Datensatz der Zuordnung (matches), so wie der Abgleich sie damals vergeben hat.'
		]
	},
	statistik: {
		title: 'Speicher und KI',
		back: 'Zurück',
		intro:
			'Was deine Bücher in diesem Browser belegen und was die KI verbraucht hat. Nichts davon verlässt den Browser.',
		storage: 'Speicher in diesem Browser',
		ofQuota: 'von {quota} verfügbar',
		files: 'Belegdateien (verschlüsselt)',
		fileCount: '{count} Dateien',
		database: 'Bücher (Datenbank) und Übriges',
		storageUnknown: 'Dieser Browser nennt den belegten Speicher nicht.',
		persisted: 'Der Browser hält die Daten dauerhaft.',
		notPersisted: 'Der Browser darf die Daten bei Platzmangel löschen.',
		persist: 'Dauerhaft speichern beantragen',
		persistYes: 'Gewährt: Der Browser löscht die Bücher nicht mehr von sich aus.',
		persistNo:
			'Nicht gewährt. Manche Browser gewähren es erst, wenn die Seite als App installiert oder oft genutzt wird.',
		records: 'Einträge',
		collection: {
			transactions: 'Zahlungen',
			receipts: 'Belege',
			matches: 'Zuordnungen',
			questions: 'Rückfragen',
			events: 'Verlauf',
			partners: 'Partner',
			accounts: 'Konten'
		},
		ai: 'KI-Verbrauch',
		today: 'Heute',
		week: 'Letzte 7 Tage',
		month: 'Dieser Monat',
		cost: 'Kosten (ca.)',
		tokens: 'Tokens',
		kind: {
			extract: 'Auslesen',
			'match-assist': 'KI-Vorschlag',
			'transfer-assist': 'KI-Gegenbuchung',
			'vendor-assist': 'KI-Lieferantenkonto',
			'mail-assist': 'Postfach-Suche'
		},
		perReceipt: 'Pro ausgelesenem Beleg in diesem Monat etwa {tokens} Tokens.',
		perReceiptNone: 'In diesem Monat wurde noch kein Beleg ausgelesen.',
		pricesFrom: 'Preise vom {date} in {currency}, zur Haupt- und Nebenzeit des Anbieters.',
		estimated: ' Ältere Einträge ohne Einzelaufrufe sind geschätzt.',
		unpriced: ' Ohne Preis und nicht mitgezählt: {models}.',
		holidays:
			' Chinesische Feiertage (Nebenzeit) kennt die App nicht; dort ist die Schätzung zu hoch.',
		editPrices: 'Preise ändern',
		toVerlauf: 'Im Verlauf ansehen',
		workers: 'Gleichzeitige KI-Anfragen je Lauf',
		workersHint:
			'Gilt für „Alle neuen auslesen“ und „KI-Vorschläge für alle offenen Rückfragen“. Begrenzt der Anbieter die Anfragen, wartet der Lauf und macht dann weiter. Bei häufigen Wartepausen weniger wählen.',
		pricesHint:
			'Je 1 Million Tokens in {currency}, zur Hauptzeit; die Nebenzeit rechnet die App daraus.',
		priceInput: 'Eingabe',
		priceCached: 'Eingabe aus Cache',
		priceOutput: 'Ausgabe',
		savePrices: 'Preise speichern',
		resetPrices: 'Auf die Preise des Anbieters zurücksetzen',
		home: 'Speicher und KI',
		homeLine: '{storage} belegt · KI diesen Monat {cost}',
		homeOpen: 'Details'
	},
	rueckfragen: {
		ai: {
			button: 'KI-Vorschläge für alle offenen Rückfragen ({count})',
			what: 'Für {count} Zahlungen ohne Beleg fragt die Bridge dein Sprachmodell, welcher Beleg passt – je Zahlung eine Anfrage mit der geschwärzten Buchung und den bis zu 25 nächstgelegenen Belegen.',
			tokens: 'Nach deinen letzten KI-Vorschlägen etwa {tokens} Tokens.',
			tokensUnknown: 'Wie viele Tokens das braucht, zeigt der Verlauf nach dem ersten Lauf.',
			only: 'Es sind nur Vorschläge: Zugeordnet wird nichts, bis du einen übernimmst.',
			start: 'Vorschläge holen',
			no: 'Abbrechen',
			progress: 'KI-Vorschläge … {done}/{count}',
			cancel: 'Abbrechen',
			cancelling: 'Hält nach dieser Rückfrage an …',
			failed:
				'Bei {count} Rückfragen hat die KI nicht geantwortet – ein neuer Lauf fragt sie noch einmal.',
			pick: 'KI-Vorschlag ({confidence}): {reason}',
			nonePick: 'KI-Vorschlag: Keiner der Belege passt.',
			take: 'Übernehmen',
			dismiss: 'Verwerfen',
			takeSure: 'Alle sicheren Vorschläge übernehmen ({count})',
			transferFirst: 'Zuerst prüfen, ob es eine eigene Umbuchung ist',
			transferFirstWhat:
				'Bei {count} dieser Zahlungen gibt es auf einem anderen eigenen Konto eine Gegenbuchung mit ähnlichem Betrag: Für sie fragt die Bridge vorher, ob eine davon die andere Seite ist – je eine Anfrage mehr. Findet das Modell eine, wird kein Beleg gesucht.',
			transferPick: 'KI-Vorschlag ({confidence}): eigene Umbuchung – {reason}',
			transferTake: 'Als Gegenbuchung verknüpfen'
		},
		title: 'Rückfragen',
		intro:
			'Wo der Abgleich nicht sicher ist, fragt er dich. Deine Antwort gilt: Ein späterer Abgleich überschreibt sie nicht.',
		back: 'Zurück zu Home',
		empty: 'Keine offenen Rückfragen.',
		emptyNew:
			'Noch nichts zu fragen: Sobald Zahlungen und Belege da sind, stehen hier die Fälle, die Belege nicht selbst zuordnen kann.',
		answered: 'Erledigt ({count})',
		kind: {
			'unsure-match': 'Welche Zahlung gehört zu diesem Beleg?',
			'missing-receipt': 'Für diese Zahlung fehlt ein Beleg',
			'missing-income': 'Zu diesem Zahlungseingang fehlt die Ausgangsrechnung',
			'unknown-sender': 'Absender nicht bestätigt'
		},
		unknownSender:
			'Diese E-Mail hat die Absenderprüfung (DKIM/SPF) nicht bestanden. Erst freigeben, dann wird sie ausgelesen und abgeglichen.',
		candidates: 'Vorschläge',
		receiptCandidates: 'Passende Belege',
		noCandidates: 'Kein passender Beleg gefunden.',
		choose: 'Das ist es',
		none: 'Keiner davon',
		noReceipt: 'Kein Beleg nötig',
		reason: 'Grund',
		reasonPlaceholder: 'z. B. Bewirtung, Beleg verloren',
		ignore: 'Ignorieren',
		confirmSender: 'Absender geprüft – freigeben',
		openTx: 'Zahlung öffnen',
		auto: 'hat sich erledigt',
		answer: {
			candidate: 'zugeordnet',
			none: 'keiner davon',
			'no-receipt': 'kein Beleg nötig',
			ignore: 'ignoriert',
			'confirm-sender': 'freigegeben',
			auto: 'hat sich erledigt'
		}
	},
	ai: {
		mark: 'KI',
		extract:
			'Mit KI: Die Bridge schickt den Text des Belegs – geschwärzt, nie die Datei – an das Sprachmodell, das du eingestellt hast, und bekommt Anbieter, Betrag, Datum und Nummern zurück.',
		upload:
			'Mit KI: Nach dem Hochladen liest die Bridge den Beleg mit deinem Sprachmodell aus (nur der Text, geschwärzt). Zugeordnet wird er ohne KI.',
		import:
			'Mit KI: Nach der Übernahme liest die Bridge die E-Mail oder ihren Anhang mit deinem Sprachmodell aus (nur der Text, geschwärzt). Zugeordnet wird ohne KI.',
		portal:
			'Mit KI: Die geholten Rechnungen liest die Bridge mit deinem Sprachmodell aus (nur der Text, geschwärzt). Anmelden und Holen kommen ohne KI aus.'
	},
	settings: {
		title: 'Einstellungen',
		intro: 'Was der Abgleich und der Export über dich und deine Buchhaltung wissen müssen.',
		nav: {
			storage: 'Speicher & Zurücksetzen',
			setup: 'Einrichtung',
			company: 'Firma & eigene Konten',
			matching: 'Abgleich & Regeln',
			learned: 'Gelerntes',
			books: 'Buchhaltung (DATEV)',
			chart: 'Kontenplan',
			privacy: 'Datenschutz & Technik'
		}
	},
	anweisungen: {
		title: 'Firma, Abgleich und Buchhaltung',
		intro:
			'Was der Abgleich über dich wissen muss: dein Firmenname, deine eigenen Konten und Zahlungen, die keinen Beleg brauchen.',
		companyNames: 'Firmenname(n)',
		companyHint:
			'Ein Name je Zeile, z. B. „le space UG“. Zahlungen an diesen Namen gelten als eigene Umbuchung (Konto 1360), Rechnungen von ihm als deine Ausgangsrechnungen.',
		ownNames: 'Eigene Namen (Inhaber, Gesellschafter)',
		ownNamesHint:
			'Ein Name je Zeile, z. B. „Erika Mustermann“. Steht einer davon als Gegenpartei, sucht „Beleg finden“ im Postfach nicht nach ihm, sondern nach einem Wort aus dem Verwendungszweck.',
		employees: 'Mitarbeiter (Lohn, Minijob)',
		employeesHint:
			'Ein Name je Zeile. Eine Zahlung an einen davon ist Lohn: Ihr Beleg ist die Lohnabrechnung aus der Lohnbuchhaltung, nicht ein Beleg im Postfach.',
		ownIbans: 'Eigene IBANs',
		ownIbansHint:
			'Eine IBAN je Zeile. Zahlungen an diese Konten gelten als eigene Umbuchung. Konten aus den Büchern kennt der Abgleich schon: {list}.',
		ownIbansNone: 'noch keine',
		rules: 'Regeln',
		noRules: 'Noch keine Regeln.',
		field: 'Wo',
		fieldCounterparty: 'Gegenpartei enthält',
		fieldPurpose: 'Verwendungszweck enthält',
		fieldAny: 'Gegenpartei oder Zweck enthält',
		contains: 'Text',
		action: 'Dann',
		actionIgnore: 'ignorieren (kein Beleg nötig)',
		actionPrivate: 'als privat markieren',
		reason: 'Grund',
		reasonPlaceholder: 'z. B. Steuerbescheid liegt vor',
		add: 'Regel hinzufügen',
		remove: 'Entfernen',
		learnedFees: 'Gelernte Bankgebühren',
		learnedFeesHint:
			'Buchungen, die du als Bankgebühr eingeordnet hast: Konto und Verwendungszweck ohne Zahlen. Die nächste gleiche Buchung braucht keinen Beleg.',
		noLearnedFees: 'Noch keine.',
		learned: 'Gelernte Anbieter',
		learnedHint:
			'Wenn du einen Beleg einer Zahlung zuordnest oder eine Zuordnung bestätigst, merkt sich der Abgleich, dass diese Gegenpartei auf dem Kontoauszug zu diesem Anbieter gehört – und woher seine Belege per E-Mail kommen. Beim nächsten Mal zählt das 40 Punkte und hilft der Suche im Postfach.',
		learnedMail: 'Belege von {domains}',
		noLearned: 'Noch nichts gelernt.',
		forget: 'Vergessen',
		grace: 'Rückfrage bei fehlendem Beleg nach',
		graceUnit: 'Tagen',
		graceHint:
			'Ein Beleg kommt oft ein paar Tage nach der Abbuchung. So lange zählt die Zahlung als ohne Beleg, aber der Abgleich fragt noch nicht. 0 = sofort fragen.',
		chart: {
			title: 'Kontenplan',
			hint: 'Lies den Kontenplan deiner Buchhaltung ein: Dann schlägt „Konto“ an jeder Zahlung deine Konten mit deinen Bezeichnungen vor statt der allgemeinen SKR-03-Liste.',
			infoTitle:
				'Eine Datei aus deiner Buchhaltung: DATEV-„Kontenbeschriftungen“ (z. B. MonKey Office: Import & Export → Export DATEV → Kontenbeschriftungen) oder eine CSV mit Kontonummer und Bezeichnung. Sie bleibt verschlüsselt in deinen Büchern in diesem Browser.',
			howTitle: 'Wie komme ich an die Datei?',
			how: [
				'MonKey Office: Seitenleiste → Import & Export → Export DATEV → „Kontenbeschriftungen“ (auf Wunsch nur ein Kontenbereich „von Konto … bis Konto“) → die CSV-Datei hier einlesen.',
				'Andere Programme mit DATEV-Schnittstelle: den Export „Kontenbeschriftungen“ bzw. „Kontenplan (DATEV-Format)“ wählen – die Datei beginnt mit „EXTF“.',
				'Sonst reicht eine CSV oder Textdatei mit einer Spalte Kontonummer (4–8 Ziffern) und einer Spalte Bezeichnung, getrennt durch Semikolon, Komma oder Tab – etwa der Kontenplan-Export aus Lexware, sevDesk oder Excel.',
				'Dein Programm ist nicht dabei oder die Datei wird nicht erkannt? Schreib uns, welches Programm du nutzt – wir nehmen es auf Anfrage auf.'
			],
			read: 'Kontenplan einlesen …',
			replace: 'Anderen Kontenplan einlesen …',
			found: '{count} Konten erkannt ({format}), {skipped} Zeilen übersprungen. Die ersten:',
			format: { datev: 'DATEV-Kontenbeschriftungen', csv: 'CSV' },
			take: 'Übernehmen',
			cancel: 'Verwerfen',
			current: 'Eingelesen: {count} Konten aus „{file}“ am {date}.',
			drop: 'Entfernen – zurück zur SKR-03-Liste',
			nothing:
				'In der Datei wurde kein Konto erkannt: Es braucht eine Spalte mit Kontonummern (4–8 Ziffern) und eine mit Bezeichnungen.',
			tooLarge: 'Die Datei ist größer als 5 MB – ist es wirklich der Kontenplan?'
		},
		books: {
			title: 'Buchhaltung (MonkeyOffice / DATEV)',
			hint: 'Was der DATEV-Export über deine Buchhaltung wissen muss. Prüfe die Werte in MonkeyOffice – dort steht, was es beim Import erwartet.',
			ledger: 'Sachkonto in MonkeyOffice',
			ledgerHint:
				'Das Sachkonto, unter dem dieses Bankkonto in deiner Buchhaltung geführt wird. Vorschlag nach SKR 03: {suggestion} – nur ein Platzhalter, trag die Nummer aus MonkeyOffice ein.',
			noAccounts: 'Noch keine Bankkonten in den Büchern.',
			vatPeriod: 'Umsatzsteuer-Voranmeldung',
			vatPeriods: { quarter: 'vierteljährlich', month: 'monatlich' },
			smallBusiness: 'Kleinunternehmer (§19 UStG)',
			vatHint:
				'Danach richtet sich die Vorsteuer-Karte auf Home. Als Kleinunternehmer weist du keine Umsatzsteuer aus und ziehst keine Vorsteuer ab.',
			legalForm: 'Rechtsform',
			legalFormUnset: 'noch nicht angegeben',
			legalForms: {
				sole: 'Einzelunternehmen',
				partnership: 'Personengesellschaft (GbR, OHG, KG)',
				corporation: 'Kapitalgesellschaft (UG, GmbH)'
			},
			shareholderAccount: 'Verrechnungskonto Gesellschafter',
			legalFormHint:
				'Bestimmt, wie eine private Zahlung vom Geschäftskonto gebucht wird („Privat (Irrläufer)“): beim Einzelunternehmen und bei Personengesellschaften als Privatentnahme (1800), eine Rückzahlung als Privateinlage (1890); bei UG und GmbH gibt es keine Privatentnahmen – die Gesellschaft hat für dich bezahlt, eine Forderung auf dem Verrechnungskonto Gesellschafter, die du zurückzahlst. Die Kontonummer legt ihr mit dem Steuerberater fest.',
			consultant: 'Beraternummer',
			client: 'Mandantennummer',
			numbersHint:
				'Für die eigene Buchhaltung ohne Steuerberatung nimmt MonkeyOffice meist 1001 und 1. Prüfe in MonkeyOffice, was es beim DATEV-Import erwartet.',
			fiscalStart: 'Wirtschaftsjahr beginnt im',
			accountLength: 'Sachkontenlänge',
			accountLengthHint: 'Stellen deiner Sachkonten, bei SKR 03 meist 4.',
			taxKeys: 'BU-Schlüssel',
			taxKeysHint:
				'Die Schlüssel, die die App aus dem Beleg vorschlägt. Voreingestellt nach SKR 03; ändere sie nur nach Rücksprache mit deiner Steuerberatung.',
			input19: 'Vorsteuer 19 %',
			input7: 'Vorsteuer 7 %',
			output19: 'Umsatzsteuer 19 %',
			output7: 'Umsatzsteuer 7 %',
			reverseCharge: '§13b (Reverse Charge)',
			reverseChargeHint: 'mit der Steuerberatung prüfen',
			invalidLedger: 'Ein Sachkonto hat 4 bis 8 Ziffern: {name}',
			learnedAccount: 'Konto {account}'
		},
		save: 'Speichern',
		saved: 'Gespeichert. Der Abgleich läuft mit den neuen Anweisungen.',
		ruleText: '{field} „{contains}“ → {action}'
	},
	belege: {
		instalments: {
			partial: 'teilweise bezahlt · {paid} von {total} ({count}×)',
			paid: 'in {count} Raten bezahlt',
			overpaid: 'überzahlt um {over} ({count}×)',
			open: 'offen'
		},
		title: 'Belege',
		empty:
			'Noch keine Belege. Dateien hochladen oder einen Ordner freigeben geht sofort; für das Buchhaltungs-Postfach brauchst du die Bridge.',
		emptyLink: 'Bridge einrichten',
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
		mailLastYear: 'Ganzes Vorjahr',
		uploadReadAfter: 'Hochgeladene Belege gleich auslesen und zuordnen',
		mailReadAfter: 'Neue Belege nach dem Abruf gleich auslesen',
		trash: {
			button: 'Mail in den Papierkorb verschieben',
			confirm:
				'Die Mail wird im Postfach in den Papierkorb verschoben (nicht gelöscht – im Mailprogramm lässt sie sich zurückholen). Der Beleg bleibt hier in den Büchern.',
			yes: 'Ja, verschieben',
			cancel: 'Abbrechen',
			busy: 'Verschiebe …',
			done: 'Mail liegt im Papierkorb des Postfachs (seit {date}).'
		},
		scam: {
			badge: 'Verdacht',
			title: 'Möglicher Betrug – bitte prüfen',
			intro:
				'Diese Zeichen passen zu einer gefälschten Rechnung. Sie sind ein Hinweis, kein Urteil. Der Beleg wird deshalb nicht automatisch zugeordnet.',
			ok: 'Ist in Ordnung',
			okHint:
				'Nur, wenn du sicher bist, dass die Rechnung echt ist – im Zweifel beim Anbieter auf dem bekannten Weg nachfragen, nicht über Kontaktdaten aus dieser Mail.',
			sign: {
				'auth-fail': 'Die Absenderprüfung (SPF/DKIM/DMARC) ist fehlgeschlagen: {detail}',
				lookalike:
					'Die Absender-Domain sieht aus wie die eines bekannten Anbieters, ist es aber nicht: {detail}',
				'other-domain': 'Dieser Anbieter schrieb bisher von einer anderen Domain: {detail}',
				'new-iban':
					'Die Rechnung nennt ein Konto ({detail}), auf das an diesen Anbieter noch nie gezahlt wurde',
				'free-mail': 'Rechnung von einer Freemail-Adresse: {detail}',
				pressure: 'Drängende Formulierung: „{detail}“',
				'foreign-links': 'Links zu anderen Hosts als dem Absender: {detail}'
			}
		},
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
		mailVerdicts: ' · Absenderprüfung aktualisiert: {count}',
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
		extractCancel: 'Abbrechen',
		extractCancelling: 'Bricht nach diesem Beleg ab …',
		list: 'Belegliste',
		noMatches: 'Keine Belege für diese Auswahl.',
		noDate: 'Ohne Datum',
		textMail: 'E-Mail ohne Anhang',
		status: {
			new: 'Neu',
			unassigned: 'Nicht zugeordnet',
			question: 'Rückfrage',
			assigned: 'Zugeordnet',
			ignored: 'Ignoriert',
			prepaid: 'Guthabenkonto'
		},
		unverified: 'Absender prüfen',
		duplicate: {
			badge: 'Doppelt',
			note: 'Doppelt: Rechnungsnummer {number} gibt es schon – {file} vom {date}, {linked}. Die Dateien unterscheiden sich, der Inhalt ist dieselbe Rechnung.',
			linked: 'einer Zahlung zugeordnet',
			unlinked: 'noch nicht zugeordnet',
			setAside: 'Als Duplikat aussortieren'
		},
		setAside: {
			action: 'Aussortieren – kein Beleg',
			title:
				'Kommt nicht in den Abgleich und nicht in den Export; eine Zuordnung wird gelöst. Lässt sich wieder aufnehmen.',
			duplicate: 'Als Duplikat aussortiert.',
			notNeeded: 'Aussortiert – kein Beleg.',
			restore: 'Wieder aufnehmen'
		},
		origin: {
			label: 'Wie zugeordnet',
			filter: {
				all: 'Alle',
				auto: 'Automatisch',
				confirmed: 'Bestätigt',
				manual: 'Von Hand',
				ai: 'KI-Fund',
				open: 'Ohne Zuordnung'
			},
			badge: {
				auto: 'Automatisch · {score} P.',
				'auto-learned': 'Automatisch (gelernt) · {score} P.',
				confirmed: 'Bestätigt',
				manual: 'Von Hand'
			},
			ai: 'KI-Fund',
			aiTitle: 'Gefunden mit „Mit KI weitersuchen“ ({confidence}): {reason}',
			aiTitleNone: 'Gefunden mit „Mit KI weitersuchen“',
			month:
				'{auto} automatisch · {confirmed} bestätigt · {manual} von Hand · {ai} KI-Fund · {open} offen'
		},
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
		sourceName: {
			mail: 'E-Mail',
			upload: 'Hochgeladen',
			folder: 'Ordner',
			portal: 'Kundenportal',
			eigenbeleg: 'Eigenbeleg',
			'invoice-app': 'Rechnungs-App (eigene Rechnung)'
		},
		recordPortal: 'Portal für {host} aufzeichnen',
		recordPortalHint:
			'Die E-Mail verweist auf die Seite des Anbieters. Zeichne einmal auf, wie du dort zu den Rechnungen kommst – die Bridge holt sie danach selbst. Als Startseite dient nur die Adresse der Seite, nie der Link aus der E-Mail.',
		linkedTo: 'Zugeordnet zu',
		openTx: 'Zahlung öffnen',
		reminderNote:
			'Mahnung – ordnet keine Zahlung selbst zu. Bei Bedarf unter Zahlungen von Hand zuordnen.',
		how: {
			line: 'Ausgelesen mit {model} · {seconds} s · {tokens} Tokens · {redactions} Stellen geschwärzt',
			lineOld: 'Ausgelesen mit {model}',
			fallback: 'zweiter Versuch mit {model}, weil {reason}',
			sent: 'An die KI gesendet (geschwärzt)',
			sentHint:
				'Genau dieser Text ging von der Bridge an das Sprachmodell. Geschwärzte Stellen stehen in eckigen Klammern, etwa [NAME] oder [IBAN …1234]. Lies ihn: Was hier noch steht, hat das Modell gesehen – ein Name ohne Etikett, der auf keiner Liste steht, bleibt stehen.',
			sentMissing:
				'Mit einer älteren Bridge ausgelesen: Welcher Text gesendet wurde, ist nicht gespeichert. „Erneut auslesen“ holt es nach.',
			redactions:
				'Geschwärzt: {terms} Namen, {iban} IBANs und Karten, {email} E-Mail-Adressen, {phone} Telefonnummern, {id} Geburtsdaten und Steuernummern, {street} Straßen, {postcode} PLZ und Ort, {link} Links',
			attempts: 'Versuche: {list}',
			tokens: 'Tokens: {prompt} hin, {completion} zurück, davon {reasoning} zum Nachdenken',
			notAi:
				'Die KI liest nur diese Felder aus. Welcher Zahlung der Beleg gehört, entscheidet danach die App nach Punkten.',
			why: {
				'stopped early: length': 'die Antwort abbrach (Token-Grenze erreicht)',
				'content is not JSON': 'die Antwort kein JSON war',
				'answer is not JSON': 'die Antwort kein JSON war',
				checks: 'die Antwort nicht aufging ({detail})',
				http: 'der Dienst einen Fehler meldete ({detail})',
				unreachable: 'der Dienst nicht erreichbar war',
				other: '{detail}'
			}
		},
		technical: [
			'Jede Datei wird im Browser mit AES-GCM versiegelt (Schlüssel per HKDF aus der PRF-Antwort des Passkeys, info belege/blob-key/v1) und in 1-MiB-Blöcken in Helias Blockstore abgelegt. Doppelte erkennt die App am SHA-256 des Inhalts, der nur im versiegelten Datensatz steht.',
			'Zum Auslesen geht nur die Textebene des PDFs an die Bridge. Die Bridge schwärzt Namen aus ihrer Liste und nach Etiketten, IBANs, E-Mail-Adressen, Telefonnummern, Straßen und Postleitzahlen und fragt dann das Sprachmodell; die Datei selbst verlässt den Browser nicht. Anonym ist der Text damit nicht – was gesendet wurde, steht danach am Beleg.'
		]
	},
	verlauf: {
		title: 'Verlauf',
		intro:
			'Was die App getan hat und was du entschieden hast, neueste zuerst. Die Einträge liegen versiegelt in deinen Büchern, wie alles andere.',
		filters: 'Filter',
		all: 'Alle ({count})',
		group: {
			auslesen: 'Auslesen ({count})',
			abgleich: 'Abgleich ({count})',
			abruf: 'Abruf ({count})',
			entscheidungen: 'Entscheidungen ({count})'
		},
		groupName: {
			auslesen: 'Auslesen',
			abgleich: 'Abgleich',
			abruf: 'Abruf',
			entscheidungen: 'Entscheidung'
		},
		empty: 'Noch nichts im Verlauf.',
		more: 'Ältere anzeigen ({count})',
		openReceipt: 'Beleg öffnen',
		openTx: 'Zahlung öffnen',
		kind: {
			'bank-sync': 'Umsätze abgerufen',
			'booking-changed': 'Buchung beim Abruf geändert',
			'mail-fetch': 'E-Mails abgerufen',
			'file-import-upload': 'Belege hochgeladen',
			'file-import-folder': 'Ordner eingelesen',
			'sender-verdict': 'Absenderprüfung aktualisiert',
			extract: 'Beleg ausgelesen',
			extractFailed: 'Auslesen fehlgeschlagen',
			'mail-assist': 'Mit KI im Postfach gesucht',
			'match-assist': 'KI-Vorschlag für eine Zuordnung',
			'transfer-assist': 'KI-Vorschlag für eine Gegenbuchung',
			'vendor-assist': 'KI-Erklärung eines Lieferantenkontos',
			matching: 'Abgleich',
			decision: 'Entscheidung',
			export: 'DATEV-Export'
		},
		text: {
			bookingChanged: 'vorher {from}, jetzt {to}{flipped}{unconfirmed}{receipt}',
			bookingChangedFlipped: ' – die Richtung hat sich umgekehrt',
			bookingChangedUnconfirmed: ' · Kontierung zurückgenommen',
			bookingChangedReceipt: ' · Beleg prüfen',
			bankSync:
				'{source}: {accounts} Konto/Konten · neu: {new} · aktualisiert: {updated} · übersprungen: {skipped}',
			mailFetch:
				'{from} bis {to}: {mails} E-Mails · neu: {new} · schon vorhanden: {skipped} · doppelt: {duplicate}',
			fileImport: 'neu: {new} · doppelt: {duplicate} · nicht unterstützt: {unsupported}',
			senderVerdict: '{vendor}: {was} → {now}',
			senderReleased: ' – zum Auslesen freigegeben',
			extract:
				'{vendor} · {model} · {seconds} s · {tokens} Tokens · {redactions} Stellen geschwärzt',
			extractFallback: ' · zweiter Versuch, weil {reason}',
			extractFailed: '{vendor}: {error}',
			mailAssist:
				'{model} · {terms} Suchwörter · {domains} Absender · {mails} Treffer · {seconds} s · {tokens} Tokens',
			mailAssistPick: ' · Vorschlag: {confidence}',
			matchAssist: '{model} · {candidates} Belege geprüft · {seconds} s · {tokens} Tokens',
			transferAssist: '{model} · {candidates} Buchungen geprüft · {seconds} s · {tokens} Tokens',
			vendorAssist: '{model} · {rows} Zeilen geprüft · {seconds} s · {tokens} Tokens',
			export: 'DATEV-Export {month}: {bookings} Buchungen, {receipts} Belege',
			matching:
				'{sure} zugeordnet · {created} neue Rückfragen · {resolved} erledigt · {classified} ohne Beleg-Pflicht · {waiting} warten noch',
			today: 'heute',
			matchingManual: 'von dir gestartet',
			matchingAuto: 'nach einem Abruf oder Auslesen',
			pairs: 'Zugeordnet: {list}'
		},
		verdict: {
			pass: 'bestanden',
			fail: 'nicht bestanden',
			none: 'keine Angabe',
			outgoing: 'eigene E-Mail'
		},
		decision: {
			confirm: 'Zuordnung bestätigt',
			link: 'Beleg von Hand zugeordnet',
			unlink: 'Zuordnung gelöst',
			reject: 'Vorschlag abgelehnt',
			'no-receipt': '„Kein Beleg nötig“ gesetzt',
			'bank-fee': 'Als Bankgebühr eingeordnet',
			'bank-fee-forget': 'Bankgebühr vergessen',
			'not-transfer': 'Als „keine Umbuchung“ markiert',
			'own-transfer-link': 'Als Gegenbuchung verknüpft (eigene Umbuchung)',
			'swap-link': 'Als Tausch verknüpft',
			'migration-link': 'Als Token-Migration verknüpft',
			'migration-unlink': 'Token-Migration gelöst',
			'manual-rate': 'Kurs von Hand eingetragen',
			'swap-unlink': 'Tausch-Verknüpfung gelöst',
			'refund-link': 'Als Erstattung verknüpft',
			'prepaid-on': 'Als Guthabenkonto geführt',
			'share-created': 'Freigabe für einen Assistenten erstellt',
			'share-revoked': 'Freigabe für einen Assistenten widerrufen',
			'prepaid-off': 'Nicht mehr als Guthabenkonto geführt',
			'not-refund': 'Als „keine Erstattung“ markiert',
			'transfer-receipt-kept': 'Beleg einer Umbuchung bestätigt',
			'company-name': 'Firmennamen übernommen',
			'own-iban': 'IBAN als eigenes Konto übernommen',
			'not-own-iban': 'IBAN als „nicht unseres“ markiert',
			'receipt-duplicate': 'Beleg als Duplikat aussortiert',
			'receipt-set-aside': 'Beleg aussortiert',
			'receipt-restore': 'Beleg wieder aufgenommen',
			'needs-receipt': '„Kein Beleg nötig“ zurückgenommen',
			'confirm-sender': 'Absender freigegeben',
			'scam-cleared': 'Scam-Verdacht als unbegründet markiert',
			'mail-trash': 'Mail in den Papierkorb verschoben',
			'upload-link': 'Beleg hochgeladen und dieser Zahlung zugeordnet',
			'receipt-moved': 'Beleg von einer anderen Zahlung hierher umgehängt',
			eigenbeleg: 'Eigenbeleg erstellt und zugeordnet',
			'aleph-statement': 'Aleph-Verbrauchsnachweis {number} für {month} erstellt',
			booking: 'Konto übernommen',
			bookings: 'Automatische Konten übernommen',
			answer: 'Rückfrage beantwortet: {choice}'
		},
		source: {
			hibiscus: 'Hibiscus',
			camt: 'CAMT-Import',
			enablebanking: 'Enable Banking',
			kraken: 'Kraken',
			nyx: 'Wallet (Nym/Nyx)',
			akash: 'Wallet (Akash)',
			ethereum: 'Wallet (Ethereum)',
			base: 'Wallet (Base)',
			arbitrum: 'Wallet (Arbitrum)',
			optimism: 'Wallet (Optimism)',
			polygon: 'Wallet (Polygon)',
			bitcoin: 'Wallet (Bitcoin)',
			filecoin: 'Wallet (Filecoin)',
			monero: 'Wallet (Monero)',
			'crypto-ledger': 'crypto-ledger-Import'
		},
		technical: [
			'Jeder Eintrag ist ein Datensatz der versiegelten OrbitDB-Sammlung events (AES-GCM wie alle anderen): Art, Zeitpunkt, die IDs von Beleg, Zahlung, Zuordnung oder Rückfrage und Zahlen – Modell, Dauer, Tokens, Schwärzungen je Art, Treffer. Kein Token, kein Schlüssel, kein Belegtext.',
			'Geschrieben wird er von der Aktion selbst: Synchronisieren, CAMT-Import, E-Mail-Abruf, Auslesen, Abgleich und jede Entscheidung. Ein automatischer Abgleich, der nichts ändert, schreibt keinen Eintrag; ein von dir gestarteter immer.'
		]
	},
	booking: {
		title: 'Konto',
		intro:
			'Auf welches Konto diese Zahlung gebucht wird (Gegenkonto, SKR 03) und mit welchem BU-Schlüssel. Die App schlägt vor, du übernimmst – exportiert wird nur, was du übernommen hast.',
		suggestion: 'Vorschlag',
		source: {
			payroll: 'nach der Art der Zahlung (Lohn, Lohnsteuer, Abgaben, Steuer)',
			transfer: 'Umbuchung',
			fee: 'Bankgebühr',
			private: 'Privat (Irrläufer), nach der Rechtsform',
			learned: 'gelernt',
			learnedFrom: 'gelernt von {vendor}',
			confirmed: 'übernommen',
			none: 'Kein Vorschlag – wähle ein Konto aus der Liste oder gib eine Nummer ein.'
		},
		account: 'Gegenkonto',
		accountPlaceholder: 'Nummer oder Name, z. B. 4930 oder Büro',
		ownNumber: 'Eigene Kontonummer, nicht im Katalog',
		notInChart: 'Nicht in deinem Kontenplan – prüfen, ob es das Konto in deiner Buchhaltung gibt',
		chartNote:
			'Vorschläge aus deinem eingelesenen Kontenplan ({count} Konten). Welches Konto richtig ist, entscheidest du mit deiner Steuerberatung.',
		taxKey: 'BU-Schlüssel',
		taxKeyPlaceholder: 'leer = ohne',
		taxVia: {
			vat19: 'Aus dem Beleg: USt 19 %',
			vat7: 'Aus dem Beleg: USt 7 %',
			'reverse-charge': 'Aus dem Beleg: §13b (Reverse Charge) – mit der Steuerberatung prüfen',
			'reverse-charge-income':
				'Beleg mit Reverse Charge auf einer Einnahme – kein Schlüssel, mit der Steuerberatung prüfen',
			'no-vat': 'Der Beleg weist keine Umsatzsteuer aus – kein Schlüssel',
			'other-rate': 'Der Beleg hat {rate} % – kein deutscher Satz, bitte selbst prüfen',
			mixed: 'Der Beleg hat mehrere Steuersätze – bitte selbst prüfen',
			'no-receipt': 'Ohne Beleg kein Schlüssel aus dem Beleg',
			automatic: 'Automatikkonto: die Umsatzsteuer steckt im Konto, kein BU-Schlüssel',
			learned: 'Vom Anbieter gelernt',
			confirmed: 'Übernommen',
			none: 'Ohne Umsatzsteuer'
		},
		confirm: 'Übernehmen',
		confirmChange: 'Änderung übernehmen',
		confirmed: 'Übernommen: {account} · {key} · am {date}',
		keyValue: 'BU {key}',
		keyNone: 'ohne BU-Schlüssel',
		notConfirmed:
			'Noch nicht übernommen – ohne übernommenes Konto kann dieser Monat nicht exportiert werden.',
		invalidAccount: 'Ein Konto hat 4 bis 8 Ziffern.',
		invalidKey: 'Ein BU-Schlüssel hat bis zu 4 Ziffern.',
		catalogueNote:
			'Die Kontenliste ist ein Ausgangspunkt nach SKR 03 – welches Konto richtig ist, entscheidest du mit deiner Steuerberatung.',
		technical: [
			'Übernommen wird auf der Zahlung selbst: booking = { account, taxKey, confirmedAt }, versiegelt wie jeder Datensatz.',
			'Vorschläge in dieser Reihenfolge: eigene Umbuchung → 1360, Bankgebühr → 4970 (beide ohne Schlüssel), sonst das Konto, das du diesem Anbieter zuletzt gegeben hast (partners: account, taxKey – über den Anbieter des Belegs oder die Gegenpartei auf dem Kontoauszug).',
			'Der BU-Schlüssel kommt aus dem ausgelesenen Beleg: USt 19 % → 9 (Einnahme 3), 7 % → 8 (Einnahme 2), reverse_charge → 94; die Schlüssel lassen sich unter Einstellungen → Buchhaltung ändern. Nichts davon fragt ein Sprachmodell.'
		]
	},
	export: {
		title: 'Export',
		intro:
			'Einmal im Monat: die Buchungen als DATEV-Buchungsstapel für MonkeyOffice und die Belege als PDF, zusammen in einer ZIP-Datei. Sie entsteht nur hier im Browser und wird auf dein Gerät geladen – nichts geht an einen Server.',
		empty: 'Noch keine Zahlungen – ohne sie gibt es nichts zu exportieren.',
		emptyLink: 'Kontoauszug hochladen oder Bank anbinden',
		month: 'Monat',
		summary:
			'{bookings} Buchungen · {lines} im Buchungsstapel · {receipts} Belege und {statements} Kontoauszüge im ZIP',
		settings:
			'Beraternummer {consultant} · Mandantennummer {client} · Wirtschaftsjahr ab {fiscal} · Sachkontenlänge {length}',
		settingsLink: 'ändern unter Einstellungen',
		checks: 'Vor dem Export',
		check: {
			tests:
				'Testbuchungen mitexportieren ({count}) – das Paket heißt dann TEST_…, zum Ausprobieren des Exports, nicht für die Buchhaltung.',
			sampleMixed:
				'In diesem Monat stehen Beispieldaten neben echten Buchungen – so geht kein Export. Entferne die Beispieldaten oben.',
			sampleAll:
				'Dieser Monat besteht aus Beispieldaten. Das Paket heißt BEISPIEL_… und ist keine Buchhaltung.',
			unpriced:
				'{count} Krypto-Buchungen ohne Kurs – ohne Euro-Betrag geht nichts in den Export. Trag den Kurs an der Buchung ein.',
			unassignedOk: 'Jede Buchung hat ein übernommenes Konto.',
			unassigned: '{count} Buchungen ohne übernommenes Konto – so lange geht kein Export.',
			autoConfirm: 'Konten aus Umbuchung und Bankgebühr übernehmen ({count})',
			autoConfirmHint:
				'Übernimmt 1360 für eigene Umbuchungen und 4970 für Bankgebühren – dieselben Vorschläge wie in der Zahlung, mit einem Klick für alle.',
			ledgerOk: 'Jedes Bankkonto hat sein Sachkonto.',
			noLedger: 'Sachkonto fehlt für {list} – unter Einstellungen → Buchhaltung eintragen.',
			noBankAccount: '{count} Buchungen gehören zu keinem Bankkonto der Bücher.',
			missingReceiptOk: 'Jede Buchung hat einen Beleg oder einen Grund, warum keiner nötig ist.',
			missingReceipt:
				'{count} Buchungen ohne Beleg und ohne „Kein Beleg nötig“ – der Export geht, prüfe sie aber.',
			unlinkedOk: 'Kein Beleg dieses Monats ist übrig.',
			unlinked: '{count} Belege dieses Monats sind keiner Zahlung zugeordnet.',
			unverifiedOk: 'Kein Beleg wartet auf die Absenderprüfung.',
			unverified: '{count} Belege mit unbestätigtem Absender – sie kommen nicht ins ZIP.',
			more: '… und {count} weitere'
		},
		open: 'öffnen',
		download: 'DATEV-Export herunterladen',
		building: 'Erstelle ZIP …',
		done: 'Heruntergeladen: {file} – {bookings} Buchungen, {receipts} Belege, {statements} Kontoauszüge.',
		blocked: 'Erst die rot markierten Punkte erledigen.',
		failed: 'Der Export ist fehlgeschlagen: {error}',
		crypto: {
			title: 'Kryptobewegungen',
			intro:
				'Alle Buchungen deiner Wallets und Börsenkonten in einem offenen Format (crypto-ledger, MIT-Lizenz), das andere Programme lesen und schreiben können – mit Menge, Euro-Wert, Kursquelle und Transaktions-Hash. Herunterladen und Einlesen geschehen hier im Browser.',
			year: 'Jahr',
			allYears: 'alle Jahre',
			json: 'Als JSON herunterladen',
			csv: 'Als CSV herunterladen',
			import: 'crypto-ledger-Datei einlesen (JSON)',
			importing: 'Lese ein …',
			imported:
				'Eingelesen: Neu {new} · Aktualisiert {updated} · Übersprungen {skipped} auf {accounts} Konten.',
			unpriced:
				'{count} ohne Kurs – der Euro-Betrag bleibt offen, bis du ihn an der Buchung einträgst.',
			left: 'Nicht eingelesen, weil Belege es noch nicht liest: {list}.',
			leftItem: '{account} ({count} Bewegungen)',
			done: 'Heruntergeladen: {file} – {movements} Bewegungen auf {accounts} Konten.',
			technical: [
				'Format crypto-ledger Version 1, beschrieben als JSON Schema in schema/crypto-ledger.v1.schema.json (MIT): Konten als CAIP-10 (Wallet) oder ccxt-Börsen-ID, Chains als CAIP-2, Assets als CAIP-19, wo das eindeutig ist.',
				'Je Buchung eine Bewegung: Menge als Dezimaltext mit Vorzeichen, Gebühren als eigene Bewegung, Euro-Wert mit Kurs, Quelle und Zeitpunkt wie gebucht; ohne Kurs steht dort null. Gelöschte Buchungen fehlen.',
				'Die CSV hat dieselben Felder, eine Zeile je Bewegung, Komma als Trenner, Punkt als Dezimalzeichen, UTF-8, CRLF; Text, den eine Tabelle als Formel läse, beginnt mit einem Apostroph.'
			]
		},
		overview: {
			noReceipt: 'ohne Beleg',
			noFile: 'Beleg {number} ohne Datei (E-Mail-Text)',
			transferLine: 'Umbuchung, Gegenbuchung am {date} ist in dieser Zeile enthalten',
			transferSide: 'nicht im Buchungsstapel: enthalten in der Gegenbuchung vom {date} ({bank})'
		},
		technical: [
			'Buchungsstapel im DATEV-Format EXTF, Version 700, Kategorie 21, Formatversion 13: Kopfzeile mit 31 Feldern, Spaltenüberschriften, eine Zeile je Buchung mit 125 Feldern; Trennzeichen „;“, Zeilenende CRLF, Zeichensatz Windows-1252 (ANSI).',
			'Konto = Sachkonto des Bankkontos, Gegenkonto = das übernommene Konto, S = Geld kam herein, H = Geld ging hinaus (aus Sicht des Bankkontos); Belegdatum TTMM = Buchungstag, Belegfeld 1 = Belegnummer JJJJ-MM-NNN, Buchungstext = Anbieter oder Gegenpartei (höchstens 60 Zeichen).',
			'Eine eigene Umbuchung, deren Gegenbuchung in den Büchern steht, kommt einmal hinein: vom Bankkonto mit dem kleineren Sachkonto gegen das Sachkonto des anderen.',
			'Die ZIP-Datei entsteht mit fflate im Browser; die Belege werden dafür aus dem versiegelten Speicher geöffnet. Die vergebenen Belegnummern bleiben am Beleg (exportNumber), ein zweiter Export vergibt dieselben.'
		]
	},
	// CopyButton.svelte (issue #114): addresses, hashes and IBANs.
	// Help in context (issue #200, step 4).
	help: {
		copyCommand: 'Befehl kopieren',
		wayOut: {
			unreachable: 'Starte die Bridge im Terminal:',
			'unknown-device': 'Die Kopplung ist auf der Bridge nicht mehr bekannt.',
			origin:
				'Trag die Adresse dieser Seite in ~/.config/belege/bridge.json unter appOrigins ein und starte die Bridge neu.',
			mail: 'Richte das Postfach einmal im Terminal ein, dann die Bridge neu starten:',
			llm: 'Richte das Sprachmodell einmal im Terminal ein, dann die Bridge neu starten:',
			hibiscus: 'Richte Hibiscus einmal im Terminal ein, dann die Bridge neu starten:',
			kraken: 'Richte Kraken einmal im Terminal ein, dann die Bridge neu starten:'
		},
		wayOutLink: {
			unreachable: 'Zur Bridge',
			'unknown-device': 'Neu koppeln',
			origin: 'Zur Bridge',
			llm: 'Zur KI-Einrichtung'
		}
	},
	copy: {
		copied: 'Kopiert',
		selected: 'Markiert – mit Strg+C bzw. ⌘C kopieren',
		failed: 'Kopieren nicht möglich',
		clickToCopy: 'Klicken zum Kopieren',
		address: 'Adresse kopieren',
		hash: 'Tx-Hash kopieren',
		iban: 'IBAN kopieren',
		ref: 'Referenz kopieren'
	},
	monthPicker: { month: '{label}: Monat', year: '{label}: Jahr' },
	zahlungen: {
		title: 'Zahlungen',
		tests: {
			title: '{count} Testbuchung(en) in den Büchern.',
			what: 'Angelegt mit „Testbuchung anlegen“ (nur in der Entwicklungsversion) – keine echten Zahlungen. Sie blockieren den Export ihres Monats.',
			remove: 'Testbuchungen entfernen',
			removing: 'Entferne …'
		},
		addTest: 'Testbuchung anlegen',
		emptyBefore: 'Noch keine Zahlungen – unter ',
		emptyLink: 'Bank',
		emptyAfter:
			' einen Kontoauszug (CAMT.053) hochladen – das geht ohne Bridge – oder die Bank über Hibiscus anbinden.',
		account: 'Konto',
		allAccounts: 'Alle Konten',
		search: 'Suchen',
		searchPlaceholder: 'Suchen: Name, Betrag, Datum',
		flow: {
			label: 'Nur:',
			clear: 'Filter aufheben',
			'bank-income': 'Einnahmen · Bank',
			'bank-expenses': 'Ausgaben · Bank',
			'crypto-income': 'Einnahmen · Krypto',
			'crypto-expenses': 'Ausgaben · Krypto',
			private: 'Privat vom Geschäftskonto',
			loan: 'Darlehen',
			tax: 'Steuern ans Finanzamt',
			unpriced: 'Krypto ohne Kurs'
		},
		receiptFilter: 'Belegfilter',
		withoutReceipt: 'Nur ohne Beleg ({count})',
		withoutAccount: 'Ohne Konto ({count})',
		changedFilter: 'Beim Abruf geändert ({count})',
		relatedMark: 'Gehört mit {count} anderen Buchung(en) zusammen',
		changedBadge: 'beim Abruf geändert',
		parties: 'Von {from} → An {to}',
		noAccountBadge: 'ohne Konto',
		noReceiptBadge: 'ohne Beleg',
		all: 'Alle ({count})',
		months: 'Monate',
		coverage: 'Belegabdeckung {month}',
		coverageText: '{percent} % mit Beleg',
		noMatches: 'Keine Treffer',
		bookings: 'Buchungen',
		noneForSelection: 'Keine Zahlungen für diese Auswahl.',
		open: 'Zahlung öffnen',
		trade: 'Tausch {arrow} {what}',
		tradeTitle: 'Getauscht',
		tradeOpen: 'andere Seite öffnen',
		time: '{time} Uhr',
		detail: {
			instalment: {
				offer: 'teilweise bezahlt ({count}×) · {open} offen',
				choose: 'Als weitere Teilzahlung zuordnen',
				line: 'Teilzahlung {index} von {count} · {number}',
				open: '{open} offen',
				paid: 'bezahlt',
				over: 'überzahlt um {over}'
			},
			ownIban: {
				question:
					'Von {iban} kommt Geld unter „{name}“ – ist das ein eigenes Konto? Dann gilt jede Zahlung dorthin als eigene Umbuchung.'
			},
			toAddress: 'An {address}',
			fromAddress: 'Von {address}',
			txHashLabel: 'Transaktion',
			where: {
				titleOut: 'Wohin ging das Geld?',
				titleIn: 'Woher kam das Geld?',
				candidate: '{account} hat am {date} {quantity} verbucht – ist das dieselbe Übertragung?',
				link: 'Ja, eigene Übertragung',
				open: 'Ansehen',
				sameOne: 'Eine weitere Buchung mit dieser Adresse.',
				same: '{count} weitere Buchungen mit dieser Adresse.',
				show: 'Anzeigen',
				first: 'Diese Adresse kommt in keiner anderen Buchung vor.',
				nameLabel: 'Adresse benennen',
				namePlaceholder: 'z. B. Kraken-Einzahlung oder Lieferant',
				nameSave: 'Benennen'
			},
			changedTitle: 'Beim Abruf am {date} geändert',
			changedText: 'Die Quelle meldet diese Buchung jetzt anders: vorher {from}, jetzt {to}.',
			changedFlipped: ' Aus einer Einnahme wurde eine Ausgabe oder umgekehrt.',
			changedAccount:
				' Die Kontierung wurde deshalb zurückgenommen – bitte unter „Konto“ neu übernehmen.',
			changedReceipt: ' Prüfe auch, ob der zugeordnete Beleg noch passt.',
			changedOk: 'Geprüft',
			details: 'Details',
			detailsHide: 'Details ausblenden',
			status: {
				receipt: { missing: 'Beleg fehlt', done: 'Beleg ✓', 'none-needed': 'Kein Beleg nötig' },
				konto: {
					missing: 'Konto fehlt',
					done: 'Konto ✓',
					missingHint: 'Noch kein Buchungskonto (SKR 03) übernommen – unten unter „Konto“.'
				}
			},
			alt: { toggle: 'Kein fremder Beleg …' },
			next: 'Nächster Schritt',
			nextKonto: 'Konto übernehmen',
			othersMissing: '{count} ohne Beleg',
			related: {
				title: 'Gehört zusammen mit',
				receipt: 'Beleg',
				kind: {
					transfer: 'Umbuchung',
					trade: 'Tausch',
					migration: 'Migration',
					fee: 'Gebühr dazu',
					refund: 'Erstattung',
					'fee-of': 'Gebühr zu'
				},
				via: {
					'counter-booking': 'Gegenbuchung',
					reference: 'gleiche Referenz',
					'own-address': 'eigene Adresse',
					bridge: 'über Bridge',
					'cross-chain': 'über eine andere Chain',
					manual: 'von dir verknüpft',
					hash: 'gleicher Tx-Hash',
					refid: 'gleiche Börsen-Referenz'
				}
			},
			find: {
				title: 'Beleg finden',
				label: 'Belege durchsuchen',
				placeholder: 'Anbieter, Betrag, Rechnungsnummer, Absender …',
				sources: 'Quelle',
				tab: {
					passend: 'Passend',
					alle: 'Alle Belege',
					postfach: 'Privates Postfach',
					portal: 'Portal'
				},
				other: 'Anderen Beleg suchen',
				open: 'Doch einen Beleg suchen',
				sameAmount: 'Betrag gleich',
				otherCurrency: 'andere Währung',
				days: '{days} Tage',
				noMatch: 'Nichts gefunden – Suchtext ändern oder eine andere Quelle wählen.',
				noSuggestion:
					'Kein Beleg erreicht genug Punkte. Unter „Alle Belege“ stehen alle offenen, im Postfach und beim Anbieter lässt sich weitersuchen.'
			},
			poisonTitle: 'Achtung: mögliche Adressvergiftung',
			poisonText:
				'Die Absenderadresse {address} beginnt und endet wie {known}, mit der du zu tun hattest, ist aber eine andere. So eine Adresse wird mit einem winzigen Betrag in deine Historie gelegt, damit du sie beim nächsten Senden versehentlich kopierst. Nie an diese Adresse senden; die Empfängeradresse immer vollständig vergleichen.',
			title: 'Zahlung',
			close: 'Schließen',
			date: 'Buchungstag',
			quantity: 'Menge',
			valuation: 'Kurs',
			original: 'Bezahlt in',
			originalAmount: '{amount} {currency}',
			originalRate: ' · Kurs der Bank {rate}',
			eigenbeleg: {
				open: 'Eigenbeleg erstellen',
				hint: 'Für eine Zahlung ohne Beleg der Gegenseite, z. B. Gebühren auf einer Blockchain. Er ist keine Rechnung; ob er anerkannt wird, klärt die Steuerberatung.',
				counterparty: 'Empfänger bzw. zahlende Seite',
				description: 'Was wurde bezahlt?',
				reason: 'Warum gibt es keinen Beleg der Gegenseite?',
				create: 'Eigenbeleg erstellen und zuordnen',
				creating: 'Erstelle …',
				cancel: 'Abbrechen',
				createRemote: 'Über die Rechnungs-App erstellen',
				creatingRemote: 'Die Rechnungs-App erstellt ihn …',
				doneRemote:
					'Die Rechnungs-App hat den Eigenbeleg {number} erstellt; er ist dieser Zahlung zugeordnet.',
				done: 'Eigenbeleg {number} erstellt und dieser Zahlung zugeordnet.'
			},
			exchangeType: 'Art bei der Börse',
			txRef: 'Referenz',
			chainTxRef: 'Transaktions-Hash',
			address: 'Gegenadresse',
			explorerAt: 'Im Block-Explorer ansehen ({explorer})',
			chainMethod: 'Netzwerk laut Börse: {method}',
			chainUnclear: 'Blockchain nicht eindeutig – in Frage kommen:',
			explorer: 'Im Block-Explorer ansehen',
			explorerQr: 'QR-Code',
			valueDate: 'Wertstellung',
			amount: 'Betrag',
			account: 'Konto',
			bookingType: 'Buchungsart',
			iban: 'IBAN der Gegenseite',
			purpose: 'Verwendungszweck (vollständig)',
			receipts: 'Beleg',
			noReceipt: 'Noch kein Beleg zugeordnet.',
			unlink: 'Zuordnung lösen',
			assign: 'Beleg zuordnen',
			suggestions: 'Vorschläge',
			allReceipts: 'Alle anderen Belege',
			choose: 'Zuordnen',
			peek: {
				label: 'Vorschau: {name}',
				hint: 'Mit der Maus über die Seite: die Lupe vergrößert, was darunter steht.',
				open: 'Vorschau'
			},
			noChoices: 'Keine Belege, die sich zuordnen lassen.',
			noReceiptNeeded: 'Kein Beleg nötig',
			reason: 'Grund',
			reasonPlaceholder: 'z. B. Bewirtung, Beleg verloren',
			save: 'Speichern',
			cancel: 'Abbrechen',
			needsReceipt: 'Doch einen Beleg zuordnen',
			bankFee: 'Bankgebühr – kein Beleg nötig',
			counterOpen: 'Gegenbuchung öffnen',
			ownName:
				'Ist „{name}“ deine Firma? Auf {account} steht am {date} derselbe Betrag in die andere Richtung, mit demselben Namen – das sieht nach einer Umbuchung zwischen deinen Konten aus.',
			ownNameYes: 'Ja, als Firmennamen übernehmen',
			ownNameNo: 'Nein, ein Anbieter',
			notTransfer: 'Keine Umbuchung – Beleg nötig',
			unlinkTransfer: 'Verknüpfung lösen – Beleg nötig',
			notRefund: 'Keine Erstattung – Beleg nötig',
			linkRefund: 'Als Erstattung verknüpfen …',
			rate: {
				missing:
					'Kurs fehlt: {reason}. Die Menge ist gebucht, der Euro-Betrag noch nicht – trag den Kurs ein, oder Belege sucht ihn beim nächsten Abruf erneut.',
				label: 'EUR je {asset}',
				save: 'Kurs eintragen',
				edit: 'Kurs von Hand ändern',
				hint: 'Wird als „von Hand eingetragen“ gekennzeichnet und bei späteren Abrufen nicht überschrieben. 0 für einen Token, den niemand mehr handelt. Woher der Kurs stammt (z. B. ein DEX-Pool oder ein Handel), gehört als Notiz zum Beleg.'
			},
			migration: {
				found:
					'Ersatz-Token: {count} Eingänge von dem, der diesen Burn ausgelöst hat, innerhalb eines halben Jahres. Welcher ist der Ersatz?',
				link: 'Als Migration verknüpfen',
				none: 'Kein Eingang von dem, der den Burn ausgelöst hat, im halben Jahr danach. Kam der neue Token von woanders, bleibt der Burn ohne Gegenstück.'
			},
			linkSwap: 'Als Tausch verknüpfen …',
			linkSwapTitle:
				'Die andere Seite eines Tauschs, den keine Regel erkennt – etwa über eine andere Chain oder eine Börse. Beide Seiten brauchen dann keinen Beleg; steuerlich eine Veräußerung und eine Anschaffung.',
			linkSwapNone:
				'Keine Buchung in die andere Richtung auf einem anderen Konto innerhalb von 31 Tagen.',
			private: {
				mark: 'Privat (Irrläufer) …',
				markTitle:
					'Eine private Zahlung, versehentlich vom Geschäftskonto bezahlt – oder privates Geld, versehentlich auf dem Geschäftskonto eingegangen: keine Betriebsausgabe bzw. -einnahme, kein Beleg. Eine kurze Aktennotiz hält den Irrtum fest; ausgeglichen wird er durch die Rückzahlung vom bzw. die Weiterleitung aufs Privatkonto.',
				noteLabel: 'Aktennotiz',
				hint: 'Nur diese eine Zahlung – andere derselben Gegenpartei bleiben, wie sie sind. Eine private Rechnung kannst du als Nachweis des Irrtums anhängen; sie zählt nicht als Betriebsausgabe.',
				save: 'Als privat festhalten',
				title: 'Privat (Irrläufer) – keine Betriebsausgabe',
				open: 'Noch nicht ausgeglichen: {amount} offen.',
				settled: 'Ausgeglichen.',
				repaidBy: 'Rückzahlung am {date}: {amount}',
				repays: 'Zahlt die private Zahlung vom {date} zurück: {amount}',
				repaymentTitle: 'Rückzahlung einer privaten Zahlung – keine Betriebseinnahme',
				repay: 'Rückzahlung verknüpfen …',
				repayPick: 'Verknüpfen',
				repayNone: 'Keine Gutschrift in den 180 Tagen um diese Zahlung.',
				titleIn: 'Privat (Irrläufer) – keine Betriebseinnahme',
				openIn: 'Noch nicht weitergeleitet: {amount} offen.',
				repaidByIn: 'Weitergeleitet am {date}: {amount}',
				repayIn: 'Weiterleitung verknüpfen …',
				repayNoneIn: 'Keine Überweisung in den 180 Tagen um diesen Eingang.',
				repaymentTitleOut: 'Weiterleitung eines privaten Eingangs – keine Betriebsausgabe',
				repaysOut: 'Leitet den privaten Eingang vom {date} weiter: {amount}',
				unlink: 'lösen',
				undo: 'Doch geschäftlich',
				noLegalForm:
					'Die Rechtsform ist noch nicht angegeben (Einstellungen → Buchhaltung). Bis dahin behandelt Belege die Zahlung wie bei UG/GmbH: auszugleichen durch eine Rückzahlung.',
				noClearing:
					'Für UG/GmbH fehlt noch das Verrechnungskonto Gesellschafter (Einstellungen → Buchhaltung); legt die Nummer mit dem Steuerberater fest.'
			},
			linkRefundTitle:
				'Diese Zahlung und eine in die andere Richtung – auf demselben oder einem anderen Konto – sind eine Belastung und ihre Erstattung. Voll erstattet braucht keine einen Beleg; bei einer Teilerstattung braucht die Belastung weiter ihren. Bleibt bei jedem Abgleich.',
			linkRefundNone: 'Keine Buchung in die andere Richtung innerhalb von 120 Tagen.',
			party: {
				from: 'Von',
				to: 'An',
				own: 'eigene',
				foreign: 'fremde Adresse',
				ownChip: 'eigene Wallet',
				unknownAddress: 'unbekannte Adresse',
				explorer: 'Explorer'
			},
			linkTransfer: 'Als Gegenbuchung verknüpfen …',
			twins:
				'{count} Buchungen mit genau diesem Betrag in der Gegenrichtung auf deinen anderen Konten, in den Tagen darum – und kein Verwendungszweck sagt, welche die Gegenbuchung ist. Verknüpfe die richtige von Hand.',
			linkTransferTitle:
				'Diese Zahlung und eine auf einem anderen deiner Konten oder Wallets sind die zwei Seiten einer eigenen Umbuchung (Konto 1360): keine braucht einen Beleg. Bleibt bei jedem Abgleich.',
			linkTransferSearch: 'Gegenbuchung suchen: Name, Zweck, Betrag …',
			linkTransferPick: 'Verknüpfen',
			linkTransferAi: 'KI-Vorschlag',
			linkTransferAiTitle:
				'Fragt dein Sprachmodell, welche dieser Buchungen die andere Seite ist: je Buchung Richtung, Betrag, Menge, Tag, Kontoart, Gegenpartei und Zweck – geschwärzt, ohne Adressen, IBANs und Hashes. Nur ein Vorschlag: Verknüpft wird erst mit deinem Klick.',
			linkTransferAiPick: 'KI-Vorschlag ({confidence}): {reason}',
			linkTransferAiNone: 'KI-Vorschlag: Keine dieser Buchungen ist die andere Seite.',
			linkTransferAiTake: 'Übernehmen',
			linkTransferAiDismiss: 'Verwerfen',
			linkTransferNone:
				'Keine Buchung in die andere Richtung auf einem anderen Konto innerhalb eines Monats.',
			bankFeeTitle:
				'Diese Buchung ist ein Entgelt der Bank; der Kontoauszug ist der Beleg. Der Abgleich merkt sich den Verwendungszweck (ohne Zahlen) auf diesem Konto und ordnet die nächste gleiche Buchung selbst ein. Unter Einstellungen → Gelerntes lässt es sich vergessen.',
			othersOut: 'Weitere Zahlungen an {name}',
			othersIn: 'Weitere Zahlungen von {name}',
			othersNone: 'Keine weiteren Zahlungen mit dieser Gegenpartei.',
			withReceipt: 'mit Beleg',
			withoutReceipt: 'ohne Beleg',
			privateSearch: 'Im privaten Postfach suchen',
			privateHint:
				'Die Bridge sucht im ganzen Postfach nach „{text}“ und {amount} zwischen {from} und {to}. Gelesen werden nur die Treffer.',
			privateHintPurpose:
				'Die Bridge sucht im ganzen Postfach nach „{text}“ aus dem Verwendungszweck und {amount} zwischen {from} und {to}. Gelesen werden nur die Treffer.',
			privateHintAmount:
				'Die Bridge sucht im ganzen Postfach nach {amount} zwischen {from} und {to}. Gelesen werden nur die Treffer.',
			privateHintCrypto:
				'Die Bridge sucht im ganzen Postfach zwischen {from} und {to} nach dem Transaktions-Hash, der Adresse und der Menge{text} – das, was Bestätigungsmails von Krypto-Zahlungen nennen. Gelesen werden nur die Treffer.',
			privateHintCryptoText: ' sowie nach „{text}“',
			memoIn:
				'Ein Eingang mit Memo „{memo}“ ist meist deine eigene Auszahlung von einer Börse, bei der du das Memo selbst eingetragen hast – keine Zahlung an dich. Die zugehörige Börsenbuchung paart sich über den Transaktions-Hash, sobald die Börse diesen Zeitraum abgerufen hat.',
			privateSearching: 'Suche …',
			privateNone: 'Keine Treffer im privaten Postfach.',
			privateHits: '{count} Treffer',
			criteria: { text: 'Suchwort', sender: 'bekannter Absender', amount: 'Betrag' },
			privateLikely: 'Wahrscheinlich der Beleg',
			aiChoice: 'KI-Vorschlag',
			aiChoiceBusy: 'KI prüft …',
			aiChoiceTitle:
				'Die Bridge schickt dein eingestelltes Sprachmodell die Buchung (Gegenpartei, Verwendungszweck, Betrag, Tag) und bis zu 25 passende Belege mit Anbieter, Betrag, Datum, Rechnungsnummer und Kurzbeschreibung – geschwärzt. Es nennt den passenden Beleg; zuordnen tust du.',
			aiChoiceNone: '{model} hat {count} Belege geprüft ({seconds} s) und hält keinen für passend',
			aiChoiceModel: 'Das Sprachmodell',
			aiChoiceChecked: 'Welche {count} Belege wurden geprüft?',
			aiChoiceEmpty: {
				crypto:
					'Für eine Krypto-Zahlung kommen nur Belege in Frage, die ihren Hash, ihre Adresse oder ihre Menge nennen – keiner tut das. Das Sprachmodell wird deshalb nicht gefragt.',
				none: 'Kein ausgelesener Beleg in dieser Richtung – das Sprachmodell hätte nichts zu prüfen und wird nicht gefragt.'
			},
			aiSearch: 'Mit KI weitersuchen',
			aiSearching: 'KI sucht …',
			aiSearchTitle:
				'Die Bridge fragt dein eingestelltes Sprachmodell zweimal: 1. Gegenpartei und Verwendungszweck (geschwärzt) → Suchwörter und Absender-Domains. 2. Betreff, Absender-Domain, Anhangnamen und Eingangstag der Treffer (geschwärzt) → welche E-Mail der Beleg ist. Kein E-Mail-Text, keine vollständige Adresse.',
			aiSearchHint:
				'Kein klarer Treffer? Das Sprachmodell schlägt Suchwörter vor und beurteilt die Treffer – nur nach Betreff, Absender-Domain und Dateinamen, nie nach dem Text der E-Mails.',
			aiSummary: 'KI-Suche: Suchwörter {terms} · Absender {domains} · {count} Treffer',
			aiSent: 'Was an das Sprachmodell ging',
			aiPick: 'KI-Vorschlag ({confidence}): {reason}',
			aiConfidence: { high: 'sicher', medium: 'wahrscheinlich', low: 'unsicher' },
			privateMore: 'Weitere {count} Treffer anzeigen',
			privateMatched: 'passt: {criteria}',
			privateAttachments: 'Anhang: {names}',
			privateNoAttachment: 'ohne Anhang (der Text der E-Mail wird übernommen)',
			privateImport: 'Als Beleg übernehmen',
			privateImporting: 'Übernehme …',
			privateImported: 'Übernommen und ausgelesen.',
			hitOutcome: {
				here: 'Er ist dieser Zahlung zugeordnet.',
				linked: 'Dieser Zahlung zugeordnet – als deine Entscheidung ({score} Punkte).',
				elsewhere: 'Er ist schon einer anderen Zahlung zugeordnet (siehe unten).',
				unverified: 'Der Absender ist nicht bestätigt: unter Belege prüfen und freigeben.',
				none: 'Keiner seiner Belege lässt sich zuordnen (siehe unten).'
			},
			privateImportedUnverified:
				'Übernommen. Der Absender ist nicht bestätigt: unter Belege prüfen und freigeben.',
			privateDuplicate: 'Diesen Beleg gibt es schon in deinen Büchern.',
			receiptHere: 'ist dieser Zahlung zugeordnet',
			receiptElsewhere: 'zugeordnet zu {name} vom {date} – öffnen',
			receiptConfirmFirst: 'Absender erst unter Belege freigeben',
			receiptAssign: 'Dieser Zahlung zuordnen',
			receiptPoints: ' ({score} P.)',
			noBridge: 'Für die Suche die Bridge unter Integrationen koppeln.',
			vendor: {
				title: 'Beim Anbieter holen',
				income:
					'Ein Zahlungseingang: Der Beleg dazu ist deine eigene Ausgangsrechnung, nicht die Rechnung eines Anbieters. Lade sie oben hoch oder ordne sie zu.',
				noBridge: 'Dafür die Bridge unter Integrationen koppeln.',
				found:
					'Kundenportal „{name}“: holt die Rechnungen ab {since} über die Bridge und prüft, ob eine zu dieser Zahlung passt.',
				login: 'Bei {name} anmelden',
				fetch: 'Rechnungen holen bei {name}',
				fetching: 'Hole Rechnungen …',
				none: 'Für „{name}“ gibt es noch kein Kundenportal. Zeichne es einmal auf: anmelden, zu einer Rechnung klicken, herunterladen.',
				result: '{listed} Rechnungen gefunden · neu: {new} · schon vorhanden: {known}.',
				linked: ' Eine davon ist dieser Zahlung zugeordnet.',
				nothingFits: ' Keine der neuen Rechnungen passt nach Betrag und Datum zu dieser Zahlung.',
				fits: 'Passt zu dieser Zahlung: {vendor} · {amount} · {date}',
				assign: 'Dieser Zahlung zuordnen',
				assigned: 'Zugeordnet.',
				technical: [
					'Das Portal wird über seinen Namen oder seine Adresse zur Gegenpartei gefunden. Die Bridge holt die Rechnungen ab dem Monat vor der Buchung; neue werden verschlüsselt als Belege abgelegt, ausgelesen (wenn ein Sprachmodell eingerichtet ist) und laufen durch den normalen Abgleich.',
					'Passt eine nach Betrag, Datum und Anbieter (mindestens 40 Punkte), wird sie hier angeboten; zugeordnet wird sie erst auf deinen Klick, wie beim Hochladen.'
				]
			},
			portal: 'Portal öffnen',
			portalFromPurpose: 'aus dem Verwendungszweck',
			portalFromPartner: 'beim Partner gespeichert',
			upload: 'Beleg hochladen und dieser Zahlung zuordnen',
			uploadHint:
				'PDF oder Bild, auch per Drag & Drop hierher. Der Beleg wird wie unter Belege verschlüsselt abgelegt, ausgelesen und dieser Zahlung zugeordnet – als deine Entscheidung, auch bei wenigen Punkten.',
			uploading: 'Lege ab und lese aus …',
			uploaded: 'Zugeordnet: {vendor}',
			uploadedPoints: ' – {line}',
			uploadedDuplicate: ' (diesen Beleg gab es schon)',
			uploadElsewhere:
				'Diese Datei ist schon der Beleg „{vendor}“ einer anderen Zahlung: {booking}. Hier ist nichts zugeordnet und dort nichts geändert.',
			uploadElsewhereUnknown: 'einer Zahlung, die hier noch nicht angekommen ist',
			uploadElsewhereOpen: 'Andere Zahlung öffnen',
			uploadMove: 'Hierher umhängen – dort fehlt er dann',
			uploadMoved:
				'Umgehängt: Der Beleg gehört jetzt zu dieser Zahlung; die andere braucht wieder einen.',
			uploadUnsupported: 'Das ist kein PDF und kein Bild.',
			uploadTooLarge: 'Die Datei ist größer als 15 MB.',
			uploadReadFailed: 'Auslesen fehlgeschlagen: {error}',
			warn: {
				amount: 'Achtung: Der Beleg nennt {receipt}, die Zahlung {tx}.',
				'invoice-number': 'Achtung: Die Rechnungsnummer {number} steht nicht im Verwendungszweck.',
				unread:
					'Der Beleg ist nicht ausgelesen: Betrag und Rechnungsnummer ließen sich nicht prüfen.'
			},
			drop: 'Loslassen: Beleg dieser Zahlung zuordnen',
			folderCheck: 'Ordner jetzt prüfen',
			folderChecking: 'Prüfe den Ordner …',
			folderResult: 'Ordner: {count} neu eingelesen und abgeglichen.',
			folderNothing: 'Ordner: nichts Neues.',
			folderDenied: 'Der Browser hat keinen Lesezugriff auf den Ordner erhalten.',
			folderHint: 'Solange die App offen ist, prüft sie den freigegebenen Ordner jede Minute.'
		}
	},
	integrationen: {
		help: {
			title: 'Was ist das, und wie richte ich es ein?',
			command: 'Im Terminal, im Ordner von Belege:',
			doc: 'Mehr dazu in der Doku',
			bridge: {
				what: 'Die Bridge ist ein kleines Programm auf deinem Rechner. Sie holt, was ein Browser nicht darf: die Bank über Hibiscus, das Postfach, das Sprachmodell, Kundenportale, Börse und Wallets.',
				how: 'Starte sie im Terminal und tipp den Kopplungscode, den sie zeigt, hier ein. Sie hört nur auf diesen Rechner.'
			},
			bank: {
				what: 'Zahlungen kommen aus Hibiscus (über die Bridge), über Enable Banking (Banken in Europa, über die Bridge) oder aus einer Kontoauszug-Datei im Format CAMT.053.',
				how: 'Die Datei geht sofort, ohne Bridge: im Online-Banking als CAMT.053 exportieren und hier hochladen. Für Hibiscus einmal das Setup im Terminal ausführen und die Konten freigeben. Für Enable Banking eine eigene Anwendung dort anlegen, pnpm setup:enablebanking ausführen, die Bank hier unten verbinden und die Konten mit pnpm setup:enablebanking -- --accounts freigeben.'
			},
			ki: {
				what: 'Ein Sprachmodell liest Anbieter, Betrag, Datum und Nummer aus Belegen und hilft an vier weiteren Stellen – immer nur auf Klick (✦).',
				how: 'Du richtest dein eigenes Modell in der Bridge ein, etwa DeepSeek oder ein lokales mit Ollama. Vor dem Senden wird geschwärzt, soweit Muster und Listen reichen; mit einem lokalen Modell geht nichts hinaus – dazu raten wir derzeit. Le Space betreibt keine KI.'
			},
			kraken: {
				what: 'Belege liest dein Kraken-Konto nur lesend: Ledger, Bestände und Trades, je Asset ein Konto, in Euro zum Tageskurs.',
				how: 'Leg bei Kraken einen API-Key nur mit „Query Funds“ und „Query Ledger Entries“ an und gib ihn beim Setup im Terminal ein. Er landet im Schlüsselbund.'
			},
			wallets: {
				what: 'Eigene Krypto-Adressen als Konten, nur lesend über die Adresse: Überweisungen, Gebühren und Bestand, nie ein Schlüssel.',
				how: 'Chain wählen, Adresse eintragen, synchronisieren. Dafür muss die Bridge laufen; ein Setup im Terminal brauchst du nur für Bitcoin (setup:bitcoin) oder optional Alchemy (setup:alchemy).'
			},
			aleph: {
				what: 'Aleph Cloud stellt keine Rechnungen aus. Belege erstellt je Konto und Monat einen Verbrauchsnachweis als Eigenbeleg.',
				how: 'Trag die Adresse des Aleph-Kontos ein oder lass eigene Ethereum-Adressen prüfen. Es wird nur gelesen, nichts signiert.'
			},
			geraete: {
				what: 'Dieselben Bücher auf Telefon und Rechner, direkt zwischen deinen Geräten synchronisiert. Ein Gerät bekommt sie erst, wenn es den Passkey beweist.',
				how: 'Synchronisation einschalten, dann das zweite Gerät per QR-Code hinzufügen. Optional treffen sich die Geräte nur im eigenen Netz, über einen Relay in deiner Bridge:'
			},
			backup: {
				what: 'Ein Backup der Bücher und jeder Belegdatei, versiegelt mit einem Schlüssel aus deinem Passkey, bei Aleph Cloud. Aleph bewahrt es auf, solange das Aleph-Konto der Bridge Credits hat.',
				how: 'Lass die Bridge einmal ihren eigenen Backup-Schlüssel erzeugen, lade Credits auf die angezeigte Adresse und klick hier auf „Jetzt sichern“. Das Wiederherstellen kommt in einem nächsten Schritt.'
			},
			portale: {
				what: 'Manche Rechnungen liegen nur im Kundenportal. Die Bridge holt sie mit einem eigenen Browser auf diesem Rechner.',
				how: 'Portal wählen oder ein eigenes einmal aufzeichnen. Die Zugangsdaten kannst du im Schlüsselbund hinterlegen:'
			},
			'rechnungs-app': {
				what: 'Die Rechnungs-App von Le Space erstellt Eigenbelege für Belege und erfährt, welche ihrer Rechnungen bezahlt sind.',
				how: 'Hier einschalten und mit der Rechnungs-App koppeln: per Einladung oder mit einem Vergleichscode auf beiden Seiten.'
			},
			assistent: {
				what: 'Eine Lese-Freigabe der Bücher für eine Assistenz: ein Jahr, geschwärzt, mit Ablaufzeit.',
				how: 'Jahr und Dauer wählen, Freigabe erstellen und den gezeigten Befehl weitergeben. Dafür muss die Bridge laufen; die Freigabe lässt sich jederzeit beenden.'
			}
		},
		overview: {
			intro: 'Was mit Belege verbunden ist – und was dich gerade braucht.',
			countOk: 'verbunden',
			countNeeds: 'brauchen dich',
			countOff: 'nicht eingerichtet',
			needsTitle: 'Braucht dich',
			needKind: { err: 'Fehler', warn: 'Hinweis' },
			need: {
				bridgeOffline: 'die Bridge antwortet nicht. Läuft sie auf diesem Mac?',
				bridgeOfflineDevices:
					'die Bridge antwortet nicht – weder hier noch über ein eigenes Gerät. Ist dein Mac mit der Bridge an und verbunden?',
				deviceRemoved:
					'dieses Gerät wurde auf einem anderen entfernt; die Synchronisation ist aus.',
				deviceError: 'die Synchronisation meldet einen Fehler.',
				consentEnded:
					'die Freigabe bei {bank} (Enable Banking) ist abgelaufen – neu freigeben, sonst kommen keine Umsätze mehr.',
				consentEnding:
					'die Freigabe bei {bank} (Enable Banking) endet am {date} – vorher erneuern.',
				neverSynced: '{name} ist eingerichtet, aber noch nie abgerufen.',
				krakenRefused: 'der letzte Abruf wurde abgelehnt. Meist hilft ein neuer API-Schlüssel.',
				walletHints: 'der letzte Abruf hat Hinweise hinterlassen (Wallets mit Hinweis: {count}).'
			},
			group: { basis: 'Grundlage', sources: 'Konten & Quellen', together: 'Zusammenarbeit' },
			groupHint: {
				basis: 'läuft auf diesem Rechner',
				basisViaDevice: 'läuft über deinen Mac',
				sources: 'woher Zahlungen und Belege kommen',
				together: 'andere Apps und Menschen'
			},
			name: {
				bridge: 'Bridge',
				ki: 'KI – Beleg-Auslesen',
				geraete: 'Eigene Geräte',
				backup: 'Backup',
				bank: 'Bank (Hibiscus, Kontoauszug)',
				kraken: 'Kraken (Börse)',
				wallets: 'Eigene Wallets',
				aleph: 'Aleph Cloud',
				mail: 'Postfach',
				portale: 'Kundenportale',
				'rechnungs-app': 'Rechnungs-App',
				assistent: 'Einblick für einen Assistenten'
			},
			state: {
				backedUp: 'gesichert',
				connected: 'verbunden',
				unpaired: 'nicht gekoppelt',
				error: 'Fehler',
				checking: 'wird geprüft',
				setUp: 'eingerichtet',
				notSetUp: 'nicht eingerichtet',
				on: 'an',
				off: 'aus',
				pending: 'ab dem nächsten Entsperren',
				removed: 'entfernt',
				none: 'keine',
				onDemand: 'bei Bedarf',
				paired: 'gekoppelt',
				notPaired: 'nicht gekoppelt',
				viaDevice: 'über deinen Mac'
			},
			line: {
				backup: 'Bücher und Belegdateien, versiegelt, bei Aleph Cloud',
				backupNone: 'Bücher und Belegdateien, versiegelt, bei Aleph Cloud',
				bridge: 'Auf diesem Mac; holt Umsätze, liest Belege, fragt Knoten',
				bridgeViaDevice:
					'Läuft auf deinem Mac; dieses Gerät nutzt sie über die Gerätesynchronisation',
				ki: 'Liest Anbieter, Betrag, Datum und Nummer aus Belegen',
				devicesOn: 'Dieselben Bücher auf deinen Geräten · {count} verbunden',
				devicesOff: 'Dieselben Bücher auf Telefon oder zweitem Rechner',
				bankAccounts: '{count} Konten in den Büchern',
				bankNone: 'Umsätze aus Hibiscus oder einer CAMT-Datei',
				kraken: 'Ledger, Bestände und Trades der Börse, nur lesend',
				wallets: '{count} Wallets, nur lesend über die Adresse',
				walletsNone: 'Krypto-Adressen als Konten, nur lesend',
				aleph: '{count} Konten mit Credits',
				alephNone: 'Hosting-Credits eigener Ethereum-Adressen',
				mail: 'Belege aus der Buchhaltungs-Adresse – unter Belege',
				portals: 'Rechnungen direkt aus Kundenkonten holen',
				invoiceApp: 'Eigenbelege mit deinem Nummernkreis und Firmenkopf',
				assistant: 'Ein Jahr lesen lassen, geschwärzt, mit Ablauf'
			},
			when: 'zuletzt {when}',
			path: 'Pfad',
			back: 'Alle Integrationen',
			unknown: 'Diese Integration gibt es nicht.',
			settingsMoved: 'Firmenname, eigene IBANs, Regeln, DATEV und Kontenplan stehen unter'
		},
		invoiceApp: {
			title: 'Rechnungs-App',
			intro:
				'Koppel Belege mit deiner Rechnungs-App (Le Space Rechnungen). Dann kann sie für eine Zahlung ohne Beleg einen Eigenbeleg erstellen – mit ihrem Nummernkreis und deinem Firmenkopf –, und Belege ordnet ihn der Zahlung zu. Die Verbindung läuft über ein Relay und ist Ende zu Ende verschlüsselt; es gehen nur die Angaben dieser einen Zahlung hinüber.',
			start: 'Verbindung aufbauen',
			issued: {
				intro:
					'Deine ausgestellten Rechnungen kommen als eigene Rechnungen in die Belege, der Abgleich ordnet sie den Zahlungseingängen zu, und die Rechnungs-App erfährt, was bezahlt ist – nur Tag und Betrag, nie Konto oder Verwendungszweck.',
				sync: 'Rechnungen abgleichen',
				result:
					'{invoices} Rechnungen in der App, {added} neu übernommen, {paid} bezahlt; {reported} Zahlungsmeldungen an die App.',
				pdfLater:
					'{count} Rechnungen kamen noch nicht: ihr PDF geht nur über eine direkte Verbindung. Beim nächsten Abgleich noch einmal.'
			},
			offHint:
				'Erst wenn du hier klickst, geht Belege ins Netz: Es fragt api.aleph.im nach den Le-Space-Relays und verbindet sich mit einem; danach nur, solange eine Rechnungs-App gekoppelt ist; nach dem Entkoppeln geht Belege wieder vom Netz. Was dabei wer sieht, steht im Datenschutz-Dialog unter „Le-Space-Relays“.',
			starting: 'Verbindung wird aufgebaut …',
			failed: 'Die Verbindung konnte nicht aufgebaut werden:',
			invitation: 'Einladungslink aus der Rechnungs-App (Verbindungen → Einladung)',
			pair: 'Mit Einladung verbinden',
			peerId: 'Oder: Peer-ID der Rechnungs-App (Verbindungen → Diese App)',
			pairByCode: 'Per Code verbinden',
			showCode: 'Tippe diesen Code in der Rechnungs-App ein und stimme dort zu:',
			busy: 'Verbinde …',
			paired: 'Gekoppelt seit {since}.',
			unpair: 'Entkoppeln',
			ownPeerId: 'Peer-ID von Belege:'
		},
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
			viaDevice: 'über deinen Mac (eigenes Gerät)',
			viaDeviceHint:
				'Dieses Gerät nutzt die Bridge deines Macs. Koppeln, Einrichten und Entkoppeln geschehen dort; hier gehen nur lesende Abfragen und das Auslesen hinüber.',
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
		enableBanking: {
			title: 'Über Enable Banking',
			intro:
				'Für Banken ohne Hibiscus: Enable Banking, ein Kontoinformationsdienst mit EU-Lizenz, liest nach deiner Freigabe bei der Bank Konten und Umsätze. Die Bridge spricht mit deiner eigenen Enable-Banking-Anwendung; dein Bank-Passwort gibst du nur auf der Seite der Bank ein.',
			needsBridge: 'Braucht die gekoppelte Bridge.',
			needTitle: 'Was du brauchst:',
			need1:
				'Eine eigene Anwendung bei Enable Banking (Control Panel, Umgebung „Production“): Sie gibt dir eine Application-ID und eine private Schlüsseldatei. Verbinde dort deine Konten („Link accounts“) – dann ist sie im eingeschränkten Modus aktiv, für genau diese Konten.',
			need2: 'Als Redirect-URL der Anwendung eingetragen:',
			need3: 'Im Terminal, im Ordner von Belege:',
			kind: { business: 'Geschäftskonto', personal: 'Privatkonto' },
			kindLabel: 'Kontoart',
			validUntil: 'freigegeben bis {date}',
			renew: 'Erneuern',
			unlink: 'Trennen',
			unlinkConfirm:
				'Die Verbindung zu {bank} trennen? Enable Banking beendet die Freigabe; schon geholte Umsätze bleiben in den Büchern.',
			leavesTitle: 'Was dabei hinausgeht',
			leaves: [
				'An Enable Banking: welche Bank du verbindest, deine Konten dort (IBAN, Name, Währung) und die Umsätze der Konten, die du freigibst und holst. Sie laufen über seine Server; dazu die IP-Adresse dieses Rechners.',
				'An deine Bank: deine Anmeldung und die Freigabe, auf ihrer eigenen Seite. Dein Bank-Passwort sehen weder Belege noch die Bridge.',
				'Nicht: Belege, Buchungen aus anderen Quellen, irgendetwas aus deinen Büchern. Der Browser spricht nie mit Enable Banking, nur die Bridge.'
			],
			technical: [
				'Nur die Bridge spricht mit api.enablebanking.com. Jede Anfrage ist mit dem privaten Schlüssel deiner Anwendung signiert (RS256-JWT, zehn Minuten gültig, kid = Application-ID); umgeleitet wird nicht, Zeit und Antwortgröße sind begrenzt.',
				'Schlüssel und Sitzungen liegen verschlüsselt (AES-256-GCM) in enablebanking.sealed neben bridge.json; den Schlüssel dazu hält der macOS-Schlüsselbund bzw. die Windows-Anmeldeinformationsverwaltung.',
				'Die Bank schickt den Browser mit einem Einmal-Code zurück auf /integrationen/bank/verbunden. Die Seite nimmt ihn sofort aus der Adresse; die Bridge nimmt ihn nur für eine Freigabe an, die sie selbst begonnen hat, einmal und binnen 30 Minuten. Ohne den Schlüssel ist er wertlos.',
				'Konten verlassen die Bridge nur mit freigegebener IBAN-Endung; die App bekommt von der IBAN nur die letzten vier Stellen und einen Hash. Geholt wird nur auf deinen Klick. Eine Freigabe gilt höchstens 180 Tage; „Trennen“ beendet sie bei Enable Banking.'
			],
			afterLink:
				'Auf der Seite Bank legst du fest, welche Konten in die Bücher kommen, und holst ihre Umsätze.',
			staysInBridge: 'Bleibt in der Bridge: nicht freigegeben.',
			continuesCamt:
				'Führt das Konto aus der Kontoauszug-Datei fort – ab dem Tag nach ihrer letzten Buchung.',
			lastFetch: 'zuletzt geholt am {date}',
			maybeHibiscus:
				' Ein Hibiscus-Konto endet ebenso – holt Hibiscus es schon, entsteht es doppelt.',
			fetch: 'Umsätze holen',
			fetching: 'Hole Umsätze …',
			fetchHint:
				'Beim ersten Mal die letzten 90 Tage, danach ab einer Woche vor dem letzten Abruf. Banken erlauben nur wenige Abrufe am Tag – geholt wird nur auf diesen Klick.',
			pending: ' {count} vorgemerkte Umsätze kommen, sobald die Bank sie bucht.',
			incomplete: ' Nicht alle Seiten geholt – noch einmal holen.',
			noneAllowed:
				'Noch verlässt kein Konto die Bridge. Welche Konten in die Bücher dürfen, legst du im Terminal fest:',
			country: 'Land',
			bank: 'Bank',
			bankPlaceholder: '{count} Banken – Namen tippen',
			start: 'Bei der Bank freigeben',
			going: 'Weiter zur Bank …',
			startHint:
				'Du gehst zur Seite deiner Bank, meldest dich dort an und gibst Lesezugriff für {days} Tage frei. Danach kommst du hierher zurück und entsperrst Belege noch einmal.',
			returned: {
				title: 'Bank verbunden?',
				working: 'Die Antwort der Bank geht an die Bridge …',
				linked: '{bank} ist verbunden: {count} Konten.',
				refused:
					'Die Bank hat keine Freigabe erteilt – abgebrochen oder abgelehnt. Nichts ist verbunden.',
				notOurs:
					'Diese Antwort gehört nicht zu der Freigabe, die in diesem Tab begonnen wurde. Nichts ist verbunden; starte die Freigabe noch einmal.',
				notPaired: 'Dieses Gerät ist nicht mit der Bridge gekoppelt.',
				none: 'Hier ist keine Antwort einer Bank angekommen.',
				pasteLabel:
					'Wenn die Bank dich auf eine andere Adresse geschickt hat (etwa beim Entwickeln auf localhost): die ganze Adresse aus der Adresszeile hier einfügen.',
				pasteUse: 'Antwort übernehmen',
				pasteInvalid: 'Diese Adresse enthält keine Antwort einer Bank.',
				back: 'Zur Seite Bank'
			}
		},
		camt: {
			choose: 'Kontoauszug wählen …',
			reading: 'Lese Kontoauszug …',
			title: 'Kontoauszug importieren (CAMT.053)',
			intro:
				'Für Banken ohne Hibiscus-Anbindung (etwa Revolut): die CAMT.053-Datei des Kontoauszugs. Sie wird nur hier im Browser gelesen.',
			pending: ' · {count} vorgemerkt (nicht importiert)'
		},
		ki: {
			title: 'KI – Beleg-Auslesen',
			simple:
				'Die KI liest nur Belege aus: Anbieter, Betrag, Datum, Rechnungsnummer. Die Zuordnung zu Zahlungen macht die App selbst, nachvollziehbar nach Punkten.',
			keyWhere:
				'Der API-Key liegt nur im Schlüsselbund der Bridge – ändern mit pnpm setup:llm. Er kommt nie in den Browser.',
			noBridge: 'Die Bridge ist nicht gekoppelt: Einstellungen erst nach dem Koppeln sichtbar.',
			unreachable: 'Die Bridge sagt nichts über das Auslesen (ältere Version?): {error}',
			provider: 'Anbieter (Host)',
			models: 'Modelle',
			modelsValue: '{primary}, beim zweiten Versuch {fallback}',
			key: 'API-Key',
			keyOk: 'eingerichtet ✓',
			keyMissing: 'fehlt – pnpm setup:llm',
			terms: 'Schwärzungsbegriffe',
			authServ: 'Server-Kennung (Absenderprüfung)',
			authServNone: 'nicht gesetzt – pnpm setup:mail',
			authServNoneHint:
				'Ohne Kennung zählt der oberste Authentication-Results-Header der E-Mail (der deines Servers). Mit Kennung nur Header genau dieses Servers.',
			notSetUp: 'nicht eingerichtet – pnpm setup:llm, dann die Bridge neu starten',
			last: 'Zuletzt ausgelesen',
			lastNone: 'noch nie',
			totals: 'Bisher',
			totalsValue: '{calls} Aufrufe · {tokens} Tokens',
			totalsFailed: ' · {count} fehlgeschlagen',
			totalsFallback: ' · {count}× zweiter Versuch',
			verlauf: 'Alle Aufrufe im Verlauf',
			technical: [
				'Die Bridge schickt die Textebene eines PDFs (oder den Text einer E-Mail) an die OpenAI-kompatible Chat-API des Anbieters (/chat/completions, JSON-Modus, max_tokens 6000). Vorher schwärzt sie Namen aus ihrer Liste und deine Firmennamen aus den Einstellungen, Namen nach einer Anrede oder einem Etikett („Herr“, „Ansprechpartner:“), IBANs und Kartennummern bis auf die letzten vier Stellen, E-Mail-Adressen (von fremden bleibt die Domain), Telefonnummern, Geburtsdaten, Steuernummern, Straßen, Postleitzahlen und Links (nur der Host bleibt). Das begrenzt, was hinausgeht, anonym macht es den Text nicht: Ein Name, der auf keiner Liste steht und hinter keinem Etikett, geht durch, ebenso Anbieter, Beträge, Rechnungsnummern und worum es im Beleg geht. Soll nichts hinausgehen, stell ein Modell auf diesem Rechner ein (etwa Ollama). Was gesendet wurde, steht beim Beleg unter „An die KI gesendet“.',
				'Die Antwort wird geprüft (Brutto da, Währung ISO, Daten gültig, Netto + USt = Brutto). Fällt sie durch oder bricht sie ab, fragt die Bridge das zweite Modell.',
				'Warum der Key nicht hier eingetragen wird: Ein Schlüssel in der Webseite ist für jedes Skript lesbar, das je auf ihr läuft. In der Bridge liegt er im macOS-Schlüsselbund, und keine Antwort der Bridge enthält ihn – GET /llm/status sagt nur „da“ oder „fehlt“. Modelle und Begriffe stellt ebenfalls pnpm setup:llm ein.'
			]
		},
		books: {
			title: 'Konten in den Büchern',
			camt: 'CAMT-Import',
			enablebanking: 'Enable Banking',
			hibiscus: 'Hibiscus',
			kraken: 'Kraken',
			wallet: 'Eigene Wallet'
		},
		wallets: {
			import: 'Verlauf importieren (CSV)',
			importing: 'Wird importiert …',
			moneroHint:
				'Monero zeigt Beträge und Absender nicht öffentlich: Belege liest nicht die Adresse, sondern den Verlauf, den deine Wallet exportiert (Monero GUI: Verlauf → Exportieren; CLI: export_transfers all). Die Datei wird nur hier im Browser gelesen. Die Adresse benennt das Konto.',
			title: 'Eigene Wallets',
			intro:
				'Nur lesend, über die Adresse: Die Bridge fragt einen öffentlichen Knoten der Chain nach allen Überweisungen und Gebühren dieser Adresse und nach ihrem Bestand. Nie ein Schlüssel, nie eine Seed-Phrase. Jedes Asset bekommt ein eigenes Konto; bewertet wird zum Tageskurs (CoinGecko, Kraken als Rückfall).',
			// Where EVM wallets are read: Alchemy with a key, Blockscout without.
			source: {
				alchemy:
					'Ethereum, Base, Arbitrum, Optimism und Polygon liest die Bridge über Alchemy – mit deinem Alchemy-API-Schlüssel, der nur auf diesem Mac liegt.',
				blockscout:
					'Ethereum, Base, Arbitrum, Optimism und Polygon liest die Bridge ohne Schlüssel bei Blockscout. Blockscout beantwortet so nur wenige Abfragen (beobachtet: etwa zehn je halbe Stunde) – schon die zweite Synchronisierung kurz nacheinander kann an „zu viele Anfragen“ scheitern. Mit einem kostenlosen Alchemy-Schlüssel entfällt das; im Terminal:',
				technicalAlchemy: [
					'Alchemy: alchemy_getAssetTransfers (von und an die Adresse; external, erc20, internal), das Gas aus den Quittungen (eth_getTransactionReceipt: gasUsed × effectiveGasPrice), fehlgeschlagene Transaktionen und Freigaben über den Nonce (eth_getTransactionCount, eth_getBlockByNumber), der Bestand über eth_getBalance und alchemy_getTokenBalances. Für einen Token ohne CoinGecko-Kurs zusätzlich seine Uniswap-Pools gegen ETH und USDC im Block der Buchung (eth_call: getPair, getPool, balanceOf, getReserves, slot0; bei V4 getSlot0 und getLiquidity am StateView).',
					'Arbitrum und Optimism: dort hat Alchemy keine internen Transaktionen; die liest die Bridge weiter bei Blockscout (eine Abfrage je Synchronisierung).',
					'Eine Wallet mit eigenem API-Endpunkt wird dort gelesen, nicht bei Alchemy.',
					'Der Schlüssel liegt im macOS-Schlüsselbund (Dienst belege-bridge, Konto alchemy) und steht nur in der Adresse der Anfragen an Alchemy – nie im Protokoll, nie in der App; die App erfährt nur, dass es einen gibt. Alchemy sieht die abgefragten Adressen und die IP-Adresse dieses Macs.',
					'Schlüssel ändern oder löschen: pnpm setup:alchemy (Enter behält ihn, „-“ löscht ihn).'
				],
				technicalBlockscout: [
					'Blockscouts Etherscan-kompatible API ohne Schlüssel: eth_chainId, txlist, txlistinternal, tokentx, balance, tokenbalance – mindestens sechs Abfragen je Synchronisierung; über der Grenze antwortet Blockscout mit HTTP 429 (WALLET_RATE_LIMIT).',
					'pnpm setup:alchemy fragt den Schlüssel verdeckt ab, prüft ihn mit eth_chainId auf jedem Netz und legt ihn im macOS-Schlüsselbund ab (Dienst belege-bridge, Konto alchemy). Die Bridge nimmt ihn ab der nächsten Synchronisierung, ohne Neustart; diese Seite zeigt es nach dem Neuladen.',
					'In der Alchemy-App müssen die Netze Ethereum, Base, Arbitrum, OP Mainnet und Polygon PoS freigeschaltet sein, sonst meldet die Bridge WALLET_ALCHEMY_DENIED.'
				],
				wallet: 'Datenquelle: Alchemy',
				internalVia: 'interne Transaktionen: Blockscout',
				customReplaces:
					'Mit Alchemy-Schlüssel liest die Bridge über Alchemy; ein eigener Endpunkt hier ersetzt Alchemy für diese Wallet.'
			},
			addTitle: 'Wallet hinzufügen',
			addCancel: 'Abbrechen',
			chain: 'Chain',
			address: 'Adresse',
			addressHint:
				'Nur die öffentliche Adresse. Sie bleibt verschlüsselt in deinen Büchern und geht nur beim Synchronisieren an den Knoten unten.',
			badAddress: 'Das ist keine Adresse auf {chain}.',
			bitcoinHint:
				'Bitcoin liest Belege über den Kontoschlüssel (xpub, ypub oder zpub). Der liegt nur im Schlüsselbund der Bridge: im Terminal `pnpm setup:bitcoin` ausführen, dann hier übernehmen. Die App kennt nur seinen Fingerabdruck.',
			bitcoinTake: 'Schlüssel aus der Bridge übernehmen',
			bitcoinNoKey:
				'In der Bridge ist noch kein Bitcoin-Schlüssel: im Terminal `pnpm setup:bitcoin` ausführen und die Bridge neu starten.',
			uses: 'Abgefragt wird',
			customHint: 'leer lassen für den voreingestellten',
			alternatives: 'Weitere öffentliche: {list}',
			explorer: 'Links führen zum Block-Explorer {name}.',
			endpoint: {
				rpc: 'RPC',
				rest: 'REST',
				indexer: 'Indexer (ältere Geschichte)',
				api: 'API (Blockscout)',
				apiOwn: 'Eigener API-Endpunkt (optional; leer lassen: Alchemy liest diese Wallet)'
			},
			meta: {
				name: 'Bezeichnung (optional)',
				namePlaceholder: 'z. B. Projekt oder Zweck',
				ledger: 'Konto (Finanzkonto)',
				costCentre: 'Kostenstelle (KOST1)',
				hint: 'Die Bezeichnung steht statt der Adresse an allen Konten dieser Wallet. Konto und Kostenstelle gelten für alle ihre Assets und gehen in den DATEV-Export; die Kostenstelle nur aus Buchstaben und Ziffern.',
				ledgerShort: 'Konto {account}',
				costCentreShort: 'Kostenstelle {costCentre}',
				edit: 'Bezeichnung, Konto, Kostenstelle',
				save: 'Speichern',
				cancel: 'Abbrechen'
			},
			own: '(eigener)',
			default: '(voreingestellt)',
			add: 'Hinzufügen',
			addressLink: 'Adresse im Block-Explorer',
			lastSync: 'zuletzt synchronisiert {date}',
			sync: 'Synchronisieren',
			syncing: 'Synchronisiere …',
			remove: 'Entfernen (Buchungen bleiben)',
			unpriced:
				'{count} Einträge ohne Kurs ({assets}) – gebucht mit Menge, der Euro-Betrag fehlt noch („Kurs fehlt“ an der Buchung). Trag ihn dort von Hand ein, sonst sucht Belege ihn beim nächsten Abruf erneut.',
			unknownAssets:
				'{count} weitere Token oder Denoms nicht gebucht (nicht in der Liste der Chain, z. B. IBC-Gutscheine oder unbekannte Verträge).',
			pruned:
				'Dieser Knoten kennt die Chain erst ab {date}: ältere Buchungen fehlen. Für die ganze Geschichte einen Archivknoten eintragen.',
			indexed:
				'Der Knoten kennt die Chain erst ab {date}; alles davor kommt aus dem Akash-Indexer (console-api.akash.network).',
			unknownAmounts:
				'{count} ältere Transaktionen mit Staking-Rewards, Escrow-Rückzahlungen oder Auto-Restake: Ihre Beträge kennt der Indexer nicht, sie sind nicht gebucht. Der Bestandsabgleich zeigt die Lücke.',
			indexerFailed: 'Der Akash-Indexer war nicht erreichbar; der nächste Abruf fragt ihn wieder.',
			balanceGap:
				'Gebucht {booked}, Bestand {balance}: Es fehlen Transaktionen – ältere, die der Knoten nicht mehr kennt, oder Tokens aus dem Unbonding, die keine Transaktion sind.'
		},
		kraken: {
			title: 'Kraken (Börse)',
			keyProblem:
				'Kraken lehnt die Abfrage ab. Meist hilft ein neuer API-Schlüssel, der nur „Query Funds“ und „Query Ledger Entries“ darf – im Terminal: pnpm setup:kraken.',
			notSetUp:
				'Noch nicht eingerichtet. Lege bei Kraken einen API-Key an, der nur „Query Funds“ und „Query Ledger Entries“ darf, und führe im Terminal aus:',
			intro:
				'Nur lesend: Belege holt das Ledger über die Bridge und führt für jedes Asset ein eigenes Konto. Beträge werden zum EUR-Kurs von Kraken bewertet (CoinGecko als Rückfall), ein Handel gegen Euro zum Preis des Handels.',
			lastSync: 'zuletzt synchronisiert {date}',
			balanceOn: 'Stand {date}',
			fromLabel: 'Ab Datum (leer: seit dem letzten Abruf, beim ersten Mal ab 1. Januar)',
			sync: 'Kraken synchronisieren',
			syncing: 'Synchronisiere …',
			syncHint:
				'Holt das Ledger ab eine Woche vor dem letzten Abruf; schon bekannte Einträge werden übersprungen. Ältere Einträge ergänzt nur ein Abruf ab einem früheren Tag.',
			noHashes:
				'Kraken hat die Ein- und Auszahlungslisten nicht herausgegeben: Die Buchungen haben keinen Transaktions-Hash und werden nicht mit deinen Wallets gepaart. Darf der API-Key „Query Funds“? Details stehen im Log der Bridge.',
			syncHintFrom: 'Holt das Ledger ab dem gewählten Tag.',
			unpriced:
				'{count} Einträge ohne Kurs – gebucht, der Euro-Betrag fehlt noch („Kurs fehlt“ an der Buchung):'
		},
		counts: 'Neu: {new} · Aktualisiert: {updated} · Übersprungen: {skipped}'
	}
};
