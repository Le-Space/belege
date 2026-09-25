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
				'Gespeichert werden die OrbitDB-Dokumentdatenbanken transactions, receipts, partners, accounts, settings, matches, questions und events, auf Helia mit LevelBlockstore und LevelDatastore in IndexedDB (belege/helia-blocks, belege/helia-data, belege/orbitdb). Jeder Eintrag ist mit AES-GCM verschlüsselt, Belegdateien mit einem eigenen Schlüssel (belege/blob-key/v1).',
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
		ai: {
			title: 'KI: wo ein Sprachmodell hilft',
			simple: [
				'Le Space betreibt keine KI und bekommt nichts davon zu sehen. Die Bridge auf deinem Rechner fragt das Sprachmodell, das du selbst einstellst: ein öffentliches wie DeepSeek oder ein lokales auf deinem eigenen Rechner. Ist keins eingestellt, läuft nichts davon.',
				'KI hilft nur dort, wo ein Knopf das Zeichen ✦ trägt, und nur, wenn du ihn drückst. Was dabei hinausgeht, steht beim Darüberfahren mit der Maus.'
			],
			usesHeading: 'Mit KI',
			uses: [
				'Belege auslesen: Anbieter, Betrag, Datum, Rechnungs- und Kundennummer aus dem Text eines Belegs – und ob es überhaupt ein Beleg ist (Anmelde-Mails und Newsletter nicht). Bei „Auslesen“, „Alle neuen auslesen“, „Beleg hochladen“, „Als Beleg übernehmen“ und „Rechnungen holen“.',
				'„Mit KI weitersuchen“ im privaten Postfach: Suchwörter und Absender vorschlagen, dann unter den Treffern den Beleg wählen – nach Betreff, Absender-Domain und Dateinamen, nie nach dem Text der E-Mails.'
			],
			withoutHeading: 'Ohne KI, nach festen Regeln',
			without:
				'Zuordnen mit Punkten, Rückfragen, Sortierung der Suchtreffer, Umbuchungen und Bankgebühren, was der Abgleich aus deinen Entscheidungen lernt, und die Portal-Rezepte. Jede Zuordnung begründet „Warum diese Zuordnung?“.',
			check:
				'Was die KI liefert, prüfst du: Am Beleg stehen das Modell und der gesendete Text, ein KI-Vorschlag wird erst auf deinen Klick übernommen, und der Verlauf nennt jeden Aufruf.',
			technical: [
				'Das Sprachmodell stellst du in der Bridge ein (pnpm setup:llm): jede Schnittstelle im OpenAI-Format (/chat/completions) – per https, oder per http nur auf diesem Rechner (127.0.0.1, localhost), etwa Ollama oder LM Studio. Voreingestellt sind deepseek-flash, mit deepseek-v4-pro als zweitem Versuch.',
				'Vor jedem Aufruf schwärzt die Bridge Namen aus deiner Liste, IBANs bis auf die letzten vier Stellen, eigene E-Mail-Adressen, Straßen, Postleitzahlen und Links (nur der Host bleibt). Die Antworten sind JSON und werden geprüft (Summen, Datumsformate, Kandidatennummern); was nicht passt, wird verworfen.',
				'Der API-Schlüssel liegt im macOS-Schlüsselbund der Bridge, nie im Browser. Das Protokoll der Bridge nennt nur Zahlen, nie Text. Im Verlauf der App stehen Modell, Dauer und Tokens jedes Aufrufs.'
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
				name: 'Sprachmodell – voreingestellt DeepSeek (Belege auslesen, KI-Suche)',
				text: 'Das Modell, das du in der Bridge einstellst. Nur bei Knöpfen mit ✦ (siehe „KI“ oben).',
				leaves:
					'Beim Auslesen der geschwärzte Text eines Belegs; bei „Mit KI weitersuchen“ Gegenpartei und Verwendungszweck sowie Betreff, Absender-Domain und Dateinamen der Treffer, geschwärzt. Bei DeepSeek stehen die Server außerhalb der EU; ein lokales Modell verlässt diesen Rechner nicht.',
				technical:
					'Die Bridge schickt nur die Textebene eines PDFs (oder den Text einer E-Mail) mit Betreff und Absender, nachdem sie Namen aus ihrer Liste, IBANs (bis auf die letzten vier Stellen), eigene E-Mail-Adressen, Straßen und Postleitzahlen geschwärzt hat – nie die Datei selbst. DeepSeek betreibt seine Server in China. Der API-Schlüssel liegt im macOS-Schlüsselbund der Bridge, nie im Browser. E-Mails von Absendern ohne bestandene DKIM/SPF-Prüfung liest die Bridge erst nach deiner Freigabe aus.'
			},
			portals: {
				name: 'Kundenportale (Vodafone)',
				text: 'Ein Browser auf diesem Mac meldet sich in deinem Kundenkonto an und lädt nur die Rechnungen herunter – nur wenn du „Anmelden“ oder „Rechnungen holen“ drückst.',
				leaves:
					'Deine Anmeldung beim Portal (Vodafone) und die Abrufe der Rechnungsseiten, direkt von diesem Mac. Die Sitzung bleibt in einem Browserprofil auf dem Mac; ein Passwort nur, wenn du es im Schlüsselbund hinterlegst.',
				technical:
					'Die Bridge startet ein eigenes Chromium (Playwright) mit einem Profil pro Portal unter ~/.config/belege/portals/<portal>/profile (Verzeichnis 0700), nicht deinen Alltags-Browser. Beim ersten Mal (und wenn die Sitzung abläuft) öffnet es ein sichtbares Fenster: Du meldest dich an, Codes (SMS, E-Mail) und Sicherheitsprüfungen gibst immer du ein. Danach holt es die Rechnungen ohne Fenster. Ein optionales Passwort (pnpm setup:portal vodafone) liegt im macOS-Schlüsselbund und wird nur in das Anmeldeformular des Portals getippt. Nur PDFs (nach ihren Bytes, höchstens 15 MB) kommen in der App an. Kein Sprachmodell, keine Bildschirmfotos; das Protokoll nennt nur den Schritt, der scheiterte. Wer dein macOS-Konto benutzen kann, kann auch die Sitzung im Profil benutzen: FileVault einschalten, „Abmelden“ löscht das Profil. Die Nutzungsbedingungen eines Portals können automatisierten Zugriff einschränken.'
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
		agentTitle: 'Dein Beleg-Agent wartet auf dich',
		agentKind: 'Rückfrage',
		agentOpenOne: '1 offene Rückfrage',
		agentOpenMany: '{count} offene Rückfragen',
		agentNone: 'Keine offenen Rückfragen – alles zugeordnet, was sich zuordnen lässt.',
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
			manual: 'von Hand'
		},
		badge: {
			receipt: 'Beleg',
			'no-receipt': 'Kein Beleg nötig',
			'own-transfer': 'Eigene Umbuchung',
			'bank-fee': 'Kontoauszug',
			loan: 'Darlehen',
			'rule-ignore': 'Ignoriert',
			'rule-private': 'Privat'
		},
		kind: {
			'own-transfer': 'Eigene Umbuchung (1360) – kein Beleg nötig',
			'bank-fee': 'Bankentgelt – der Kontoauszug ist der Beleg',
			loan: 'Darlehen – der Vertrag ist der Beleg',
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
			'wrong-direction': 'Richtung passt nicht (Eingang statt Ausgang oder umgekehrt)'
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
			ownMirrored:
				'Eigene Umbuchung: Das Gegenkonto endet wie dein Konto {account}, und dort steht die Gegenbuchung',
			bankFee: 'Bankentgelt: Buchungsart „{type}“ – der Kontoauszug ist der Beleg',
			loan: 'Darlehen: „Darlehen“ im Verwendungszweck – der Vertrag ist der Beleg',
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
	rueckfragen: {
		title: 'Rückfragen',
		intro:
			'Wo der Abgleich nicht sicher ist, fragt er dich. Deine Antwort gilt: Ein späterer Abgleich überschreibt sie nicht.',
		back: 'Zurück zu Home',
		empty: 'Keine offenen Rückfragen.',
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
	anweisungen: {
		title: 'Eigene Anweisungen',
		intro:
			'Was der Abgleich über dich wissen muss: dein Firmenname, deine eigenen Konten und Zahlungen, die keinen Beleg brauchen.',
		companyNames: 'Firmenname(n)',
		companyHint:
			'Ein Name je Zeile, z. B. „le space UG“. Zahlungen an diesen Namen gelten als eigene Umbuchung (Konto 1360), Rechnungen von ihm als deine Ausgangsrechnungen.',
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
		save: 'Speichern',
		saved: 'Gespeichert. Der Abgleich läuft mit den neuen Anweisungen.',
		ruleText: '{field} „{contains}“ → {action}'
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
		sourceName: {
			mail: 'E-Mail',
			upload: 'Hochgeladen',
			folder: 'Ordner',
			portal: 'Kundenportal'
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
				'Genau dieser Text ging von der Bridge an das Sprachmodell. Geschwärzte Stellen stehen in eckigen Klammern, etwa [NAME] oder [IBAN …1234].',
			sentMissing:
				'Mit einer älteren Bridge ausgelesen: Welcher Text gesendet wurde, ist nicht gespeichert. „Erneut auslesen“ holt es nach.',
			redactions:
				'Geschwärzt: {terms} Namen, {iban} IBANs, {email} E-Mail-Adressen, {street} Straßen, {postcode} PLZ und Ort, {link} Links',
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
			'Zum Auslesen geht nur die Textebene des PDFs an die Bridge. Die Bridge schwärzt Namen, IBANs, eigene E-Mail-Adressen, Straßen und Postleitzahlen und fragt dann das Sprachmodell; die Datei selbst verlässt den Browser nicht.'
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
			'mail-fetch': 'E-Mails abgerufen',
			'file-import-upload': 'Belege hochgeladen',
			'file-import-folder': 'Ordner eingelesen',
			'sender-verdict': 'Absenderprüfung aktualisiert',
			extract: 'Beleg ausgelesen',
			extractFailed: 'Auslesen fehlgeschlagen',
			'mail-assist': 'Mit KI im Postfach gesucht',
			matching: 'Abgleich',
			decision: 'Entscheidung'
		},
		text: {
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
			'needs-receipt': '„Kein Beleg nötig“ zurückgenommen',
			'confirm-sender': 'Absender freigegeben',
			'upload-link': 'Beleg hochgeladen und dieser Zahlung zugeordnet',
			answer: 'Rückfrage beantwortet: {choice}'
		},
		source: { hibiscus: 'Hibiscus', camt: 'CAMT-Import' },
		technical: [
			'Jeder Eintrag ist ein Datensatz der versiegelten OrbitDB-Sammlung events (AES-GCM wie alle anderen): Art, Zeitpunkt, die IDs von Beleg, Zahlung, Zuordnung oder Rückfrage und Zahlen – Modell, Dauer, Tokens, Schwärzungen je Art, Treffer. Kein Token, kein Schlüssel, kein Belegtext.',
			'Geschrieben wird er von der Aktion selbst: Synchronisieren, CAMT-Import, E-Mail-Abruf, Auslesen, Abgleich und jede Entscheidung. Ein automatischer Abgleich, der nichts ändert, schreibt keinen Eintrag; ein von dir gestarteter immer.'
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
		noneForSelection: 'Keine Zahlungen für diese Auswahl.',
		open: 'Zahlung öffnen',
		detail: {
			title: 'Zahlung',
			close: 'Schließen',
			date: 'Buchungstag',
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
			noChoices: 'Keine Belege, die sich zuordnen lassen.',
			noReceiptNeeded: 'Kein Beleg nötig',
			reason: 'Grund',
			reasonPlaceholder: 'z. B. Bewirtung, Beleg verloren',
			save: 'Speichern',
			cancel: 'Abbrechen',
			needsReceipt: 'Doch einen Beleg zuordnen',
			othersOut: 'Weitere Zahlungen an {name}',
			othersIn: 'Weitere Zahlungen von {name}',
			othersNone: 'Keine weiteren Zahlungen mit dieser Gegenpartei.',
			withReceipt: 'mit Beleg',
			withoutReceipt: 'ohne Beleg',
			privateSearch: 'Im privaten Postfach suchen',
			privateHint:
				'Die Bridge sucht im ganzen Postfach nach „{text}“ und {amount} zwischen {from} und {to}. Gelesen werden nur die Treffer.',
			privateHintAmount:
				'Die Bridge sucht im ganzen Postfach nach {amount} zwischen {from} und {to}. Gelesen werden nur die Treffer.',
			privateSearching: 'Suche …',
			privateNone: 'Keine Treffer im privaten Postfach.',
			privateHits: '{count} Treffer',
			criteria: { text: 'Suchwort', sender: 'bekannter Absender', amount: 'Betrag' },
			privateLikely: 'Wahrscheinlich der Beleg',
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
			privateImported: 'Übernommen, ausgelesen und abgeglichen.',
			privateImportedUnverified:
				'Übernommen. Der Absender ist nicht bestätigt: unter Belege prüfen und freigeben.',
			privateDuplicate: 'Diesen Beleg gibt es schon.',
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
				'Die Bridge schickt die Textebene eines PDFs (oder den Text einer E-Mail) an die OpenAI-kompatible Chat-API des Anbieters (/chat/completions, JSON-Modus, max_tokens 6000). Vorher schwärzt sie Namen aus ihrer Liste, IBANs bis auf die letzten vier Stellen, eigene E-Mail-Adressen, Straßen und Postleitzahlen. Was gesendet wurde, steht beim Beleg unter „An die KI gesendet“.',
				'Die Antwort wird geprüft (Brutto da, Währung ISO, Daten gültig, Netto + USt = Brutto). Fällt sie durch oder bricht sie ab, fragt die Bridge das zweite Modell.',
				'Warum der Key nicht hier eingetragen wird: Ein Schlüssel in der Webseite ist für jedes Skript lesbar, das je auf ihr läuft. In der Bridge liegt er im macOS-Schlüsselbund, und keine Antwort der Bridge enthält ihn – GET /llm/status sagt nur „da“ oder „fehlt“. Modelle und Begriffe stellt ebenfalls pnpm setup:llm ein.'
			]
		},
		books: {
			title: 'Konten in den Büchern',
			camt: 'CAMT-Import',
			hibiscus: 'Hibiscus'
		},
		counts: 'Neu: {new} · Aktualisiert: {updated} · Übersprungen: {skipped}'
	}
};
