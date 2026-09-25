# Wo Belege KI einsetzt

_English: [ai.md](ai.md)_

**Le Space betreibt keine KI und sieht keine deiner Daten.** Belege hat keinen Server. Die Bridge auf deinem eigenen Rechner fragt das Sprachmodell, das **du** einstellst (`pnpm setup:llm`): ein öffentliches wie DeepSeek (voreingestellt) oder ein lokales auf deinem Rechner, etwa Ollama oder LM Studio. Jede Schnittstelle im OpenAI-Format (`/chat/completions`) geht: per https, oder per http nur auf `127.0.0.1`/`localhost`. Ohne eingestelltes Modell läuft keiner der Schritte unten; alles andere funktioniert weiter.

In der App trägt jeder Knopf, der das Modell fragt, das Zeichen **✦** (`app/src/lib/AiMark.svelte`); beim Darüberfahren steht, was hinausgeht. Die Einwilligungsseite nennt dasselbe, einfach und unter _Technisch_ im Detail.

## Mit KI

| Wo                                                                                               | Ausgelöst durch                                                                                                                                 | Was an das Modell geht                                                                                                                                                                            | Was zurückkommt                                                                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Beleg auslesen** (`bridge/src/llm/extract.js`)                                                 | _Auslesen_, _Erneut auslesen_, _Alle neuen auslesen_, _Beleg hochladen und dieser Zahlung zuordnen_, _Als Beleg übernehmen_, _Rechnungen holen_ | die Textebene des Belegs (PDF) oder der Text der E-Mail, mit Betreff, Absender und Dateiname als Hinweis, **geschwärzt**; nie die Datei                                                           | Anbieter, USt-IdNr., Rechnungs- und Kundennummer, Daten, Netto/USt/Brutto, Zahlweg, Reise; oder `document_type: "none"` für eine E-Mail, die kein Beleg ist (Anmelde-Link, Newsletter) |
| **„Mit KI weitersuchen“** im privaten Postfach (`bridge/src/llm/assist.js`, `POST /mail/assist`) | der Knopf, nur wenn die normale Suche keinen klaren Treffer fand                                                                                | 1. Gegenpartei und Verwendungszweck der Buchung, geschwärzt → 2. je Treffer: Betreff, Absender-**Domain**, Anhangnamen, Eingangstag, geschwärzt. **Kein E-Mail-Text, keine vollständige Adresse** | 1. bis zu 4 Suchwörter und 3 Absender-Domains; 2. welcher Treffer der Beleg ist, wie sicher, und warum in wenigen Worten                                                               |

Vor jedem Aufruf schwärzt die Bridge (`bridge/src/llm/redact.js`): die Namen auf deiner Liste, IBANs bis auf die letzten vier Stellen, E-Mail-Adressen deiner eigenen Domains, Straßen, Postleitzahlen mit Ort und Links (nur der Host bleibt). Die Antworten sind JSON und werden geprüft (Netto + USt = Brutto, Daten sind Daten, ein Vorschlag ist einer der Kandidaten). Passt eine Antwort nicht, fragt die Bridge einmal das zweite Modell, sonst wird sie verworfen. Was gesendet wurde, bleibt am Beleg (_An die KI gesendet_) oder steht bei der Suche (_Was an das Sprachmodell ging_). Der Verlauf nennt Modell, Dauer und Tokens jedes Aufrufs; das Protokoll der Bridge nur Zahlen.

## Ohne KI (feste Regeln)

- **Zuordnen** von Belegen zu Buchungen: Punkte für Betrag, Rechnungs- und Kundennummer, IBAN, Anbietername, gelernten Anbieter und Datum (`app/src/lib/matching/score.js`). _Warum diese Zuordnung?_ begründet jede Zuordnung.
- **Rückfragen**, die Karenzzeit und die **Sortierung der Postfach-Treffer** (`hitScore` in `app/src/lib/matching/view.js`).
- **Umbuchungen, Bankgebühren, Darlehen** und deine eigenen Regeln (`app/src/lib/matching/classify.js`).
- **Dazulernen**, welche Gegenpartei welcher Anbieter ist, aus deinen Zuordnungen (`app/src/lib/matching/partners.js`).
- **Kundenportale**: Anmelden, Aufzeichnen und Abspielen der Rezepte (`bridge/src/portals/`). Keine Bildschirmfotos und kein Seiteninhalt gehen an ein Modell.

Ein KI-Ergebnis ist nie das letzte Wort: Ausgelesene Werte stehen mit dem Modell am Beleg, ein KI-Vorschlag wird erst auf deinen Klick übernommen.

## Rechtliches

Die EU-KI-Verordnung verlangt Transparenz vor allem bei KI, die mit Menschen interagiert oder Inhalte erzeugt, und bei Hochrisiko-Anwendungen. Das Auslesen von Belegen für die eigene Buchhaltung gehört nach unserer Einschätzung nicht dazu. Wir legen es trotzdem offen; nach der DSGVO musst du ohnehin wissen, wohin Daten gehen. Keine Rechtsberatung.
