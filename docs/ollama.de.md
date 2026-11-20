# Belege mit Ollama auslesen, auf dem eigenen Rechner

[English](ollama.md)

Seit 16.11.2026 ist das die **Voreinstellung** der Bridge. Mit einem lokalen Modell **verlässt kein Belegtext deinen Rechner**: Die Bridge schickt ihn an [Ollama](https://ollama.com) auf `127.0.0.1` statt an einen Anbieter im Internet. Das kostet nichts außer Zeit und Plattenplatz. Diese Seite richtet es auf einem Mac ein; unter Linux und Windows sind die Schritte dieselben, nur Ollama wird anders gestartet.

Was das Modell tut und was gesendet wird, steht in [ai.de.md](ai.de.md).

## 1. Was du herunterlädst

1. **Ollama selbst**: [ollama.com/download](https://ollama.com/download) oder `brew install --cask ollama`. Die App einmal starten; sie läuft in der Menüleiste und antwortet unter `http://127.0.0.1:11434`.
2. **Ein Modell**, das in deinen Arbeitsspeicher passt. Belege braucht ein Modell, das in JSON antwortet, ohne vorher „nachzudenken“ (ein Reasoning-Modell braucht auf dem Prozessor Minuten pro Beleg), und das Deutsch, Englisch und andere Sprachen liest:

   | Dein Rechner                    | Modell                               | Download | Hinweis                                                                                                    |
   | ------------------------------- | ------------------------------------ | -------- | ---------------------------------------------------------------------------------------------------------- |
   | 32 GB Arbeitsspeicher oder mehr | `qwen3:30b-a3b-instruct-2507-q4_K_M` | 18 GB    | Liest am besten. Mixture of Experts: Pro Wort arbeiten etwa 3B Parameter, deshalb schnell für seine Größe. |
   | 16 GB Arbeitsspeicher           | `qwen3:4b-instruct-2507-q4_K_M`      | 2,5 GB   | **Voreinstellung der Bridge**: passt auf einen normalen Laptop.                                            |

   ```bash
   ollama pull qwen3:4b-instruct-2507-q4_K_M          # voreingestellt
   ollama pull qwen3:30b-a3b-instruct-2507-q4_K_M     # ab 32 GB
   ```

   Für das große halte 20 GB auf der Platte frei. Modelle, die du nicht mehr brauchst: `ollama list`, dann `ollama rm <Name>`.

## 2. Zwei Einstellungen für Ollama

Ollama schneidet lange Texte bei seinem Standard-Kontext **stillschweigend** ab und entlädt das Modell nach fünf Minuten ohne Anfrage (18 GB neu zu laden dauert eine Minute). Beides einmal setzen, dann Ollama in der Menüleiste beenden und neu starten:

```bash
launchctl setenv OLLAMA_CONTEXT_LENGTH 16384
launchctl setenv OLLAMA_KEEP_ALIVE 2h
```

`launchctl setenv` gilt bis zum Neustart des Macs; danach beide Befehle erneut ausführen, bevor Ollama startet. Was das laufende Ollama nutzt: `ollama ps` zeigt das Modell, seinen Kontext und ob es auf dem Prozessor oder einer GPU läuft.

## 3. Die Bridge

```bash
pnpm setup:llm
```

| Frage                                        | Antwort                                                                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which one?                                   | Enter (1, Ollama auf diesem Rechner – voreingestellt)                                                                                                                                                                                                          |
| LLM base URL                                 | Enter (`http://127.0.0.1:11434/v1`)                                                                                                                                                                                                                            |
| Model                                        | Enter für das voreingestellte `qwen3:4b-instruct-2507-q4_K_M`, oder der Name aus Schritt 1                                                                                                                                                                     |
| Model for the retry                          | Enter (derselbe Name), oder das kleine Modell, wenn beide geladen sind                                                                                                                                                                                         |
| Does the model run on this machine itself …? | Enter (ja). Es geht nichts hinaus, also wird nichts geschwärzt ([#423](https://github.com/Le-Space/belege/issues/423)); die Begriffe werden nicht abgefragt und bleiben für später. `n` nur bei einem Proxy auf 127.0.0.1, der an einen Anbieter weiterleitet. |

Ein API-Key wird nicht abgefragt: Ollama braucht keinen, und ein Schlüssel für einen anderen Anbieter bleibt für später gespeichert. Am Ende prüft `setup:llm`, ob Ollama antwortet und das Modell hat, und sagt sonst, was zu tun ist.

Dann die Bridge neu starten (`pnpm bridge`). In der App zeigt _Integrationen → KI – Beleg-Auslesen_ _Ollama – auf diesem Rechner_, `127.0.0.1:11434` und das Modell. Läuft Ollama nicht oder fehlt das Modell, sagt die Bridge das beim Start, und die KI-Karte zeigt die Schritte; stattdessen wird nichts an ein Modell im Internet geschickt.

Eine Bridge, die DeepSeek noch aus der alten Voreinstellung hat, fragt einmal – bei `pnpm setup:llm`, beim Start und auf der KI-Karte –, ob sie hierher wechseln soll; die Antwort steht in `bridge.json`.

## 4. In Belege

- _Statistik → Gleichzeitige KI-Anfragen je Lauf_: **1**. Auf dem Prozessor beantwortet Ollama eine Anfrage nach der anderen; eine zweite wartet nur dahinter.
- _Belege → Alle neuen auslesen_ liest die wartenden Belege. Lass es laufen; der Fortschritt steht am Belege-Tab, und es lässt sich abbrechen.

## Wie schnell, wie gut

Gemessen am 15.10.2026 auf einem Intel-Mac (i9, 32 GB, nur Prozessor – eine AMD-Grafik nutzt Ollama auf dem Mac nicht) mit `qwen3:30b-a3b-instruct-2507-q4_K_M` und der Anfrage, die Belege selbst stellt:

| Erfundener Beleg                 | Dauer | Gelesen                                 |
| -------------------------------- | ----- | --------------------------------------- |
| Deutsche Rechnung (PDF-Text)     | 121 s | alle Felder richtig                     |
| Kassenbon (OCR-Text eines Scans) | 129 s | alle Felder richtig                     |
| Russisches Zugticket             | 154 s | richtig; das Verkehrsmittel war geraten |

**Etwa zwei Minuten pro Beleg**: Einige Hundert Belege sind eine Nacht. Der erste Beleg nach dem Start von Ollama lädt zusätzlich das Modell. Die Bridge wartet bei einem Modell auf diesem Rechner bis zu 10 Minuten. Ein Mac mit Apple-Chip rechnet auf seiner GPU und dürfte deutlich schneller sein; gemessen haben wir das noch nicht.

## Wenn etwas nicht klappt

| Was die App sagt                               | Was zu tun ist                                                                                     |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| „Ollama ist nicht erreichbar …“                | Ollama läuft nicht: die App starten, dann „Weitermachen“ auf Home.                                 |
| „Ollama kennt das eingestellte Modell nicht …“ | Der Name in `pnpm setup:llm` weicht von `ollama list` ab; korrigieren, Bridge neu starten.         |
| Ein Beleg: „no answer within 600 s“            | Der Rechner ist ausgelastet oder der Beleg sehr lang. Später einzeln erneut lesen (_Auslesen_).    |
| Lange Belege kommen halb gelesen zurück        | `OLLAMA_CONTEXT_LENGTH` ist im laufenden Ollama nicht gesetzt (Schritt 2; mit `ollama ps` prüfen). |

Stattdessen bewusst ein Anbieter im Internet: `pnpm setup:llm`, Wahl 3, dessen URL (angezeigt mit dem Land des Anbieters, etwa DeepSeek – China) und Modelle, dann die Bridge neu starten.
