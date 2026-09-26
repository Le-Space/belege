# Krypto: Mengen, Kurse, Buchungen

_English: [crypto.md](crypto.md)_

Belege bekommt Konten bei Börsen (zuerst Kraken) und Wallets auf Blockchains (Cosmos, EVM, Bitcoin). Diese Seite beschreibt das gemeinsame Fundament. Die Anbindungen selbst folgen in späteren Schritten.

## Ein Konto je Asset

Ein Krypto-Konto hält genau ein Asset: _Kraken BTC_, _Kraken EUR_ und _Wallet NYM_ sind drei Konten, jedes mit eigenem Sachkonto in MonkeyOffice. Welche Assets Belege kennt, steht in `app/src/lib/assets/registry.js`: Kürzel, Name, Nachkommastellen und, wo sie sicher ist, die kettenübergreifende CAIP-19-Kennung.

## Eine Krypto-Bewegung wird in Euro gebucht und behält, was bewegt wurde

Belege bucht in Euro-Cent, wie bei den Bankkonten: `amountCents` ist der Wert der Bewegung an ihrem Tag. Daneben behält die Buchung:

| Feld        | Beispiel                                                                              | Bedeutung                                                                                                                                                      |
| ----------- | ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `asset`     | `BTC`                                                                                 | das Kürzel                                                                                                                                                     |
| `quantity`  | `"-1500000"`                                                                          | die Menge mit Vorzeichen in der kleinsten Einheit (hier Satoshi: −0,015 BTC), als Text, weil Token mit 18 Nachkommastellen nicht in eine Gleitkommazahl passen |
| `decimals`  | `8`                                                                                   | die Nachkommastellen des Assets, damit der Datensatz sich selbst erklärt                                                                                       |
| `movement`  | `transfer`                                                                            | `transfer`, `trade`, `fee`, `reward` oder `stake`                                                                                                              |
| `txRef`     | `…`                                                                                   | der Transaktions-Hash oder die Referenz der Börse                                                                                                              |
| `valuation` | `{ rate: "60000", currency: "EUR", source: "coingecko", at: "2026-09-01T00:00:00Z" }` | Euro je ganzer Einheit, woher der Kurs kommt und für welchen Zeitpunkt er gilt                                                                                 |

Aus `quantity` × `rate` ergibt sich `amountCents`. Gerechnet wird mit ganzen Zahlen, gerundet wird einmal, kaufmännisch (`app/src/lib/assets/quantity.js`). Kein Krypto-Betrag läuft über eine Gleitkommazahl.

## Der Kurs eines Tages

Die Bridge beantwortet `GET /rates?asset=BTC&date=2026-09-01` (`bridge/src/rates.js`). Der Browser kann die Quellen nicht selbst fragen (CORS), und ein optionaler CoinGecko-Schlüssel bleibt im Schlüsselbund. Der Kurs ist immer der Wert einer Einheit **um 00:00 UTC des Tages**:

1. **CoinGecko**, dessen Tagesstand (`/coins/{id}/history`);
2. sonst **Kraken**, der Eröffnungskurs der Tageskerze;
3. für **USD**: der **EZB-Referenzkurs** des Tages oder der letzte davor (Wochenende, Feiertag), umgerechnet in Euro je Dollar.

Die Anfrage nennt nur ein Asset und einen Tag, nichts über die Buchungen. Vergangene Tage werden im Speicher gehalten. Liegt ein CoinGecko-Demo-Schlüssel im Schlüsselbund (Konto `coingecko`), geht er als Header mit.

**Welcher Kurs und welches Bewertungsverfahren gelten, entscheidet der Steuerberater.** Dazu gehören die Konten für Krypto-Bestände, Kursgewinne und Kursverluste, FIFO oder Durchschnitt und die Bewertung zum Jahresende. Belege hält Kurs und Quelle an jeder Buchung fest, damit sich eine andere Entscheidung später anwenden lässt.

## Im Export

Der Buchungstext einer Krypto-Buchung endet mit der Menge, z. B. `Konto B -0,015 BTC`. Reichen die 60 Zeichen von DATEV nicht, wird der Name gekürzt, nie die Menge. Der Umsatz steht wie bei jeder anderen Zeile in Euro.

## In der App

Die Detailansicht einer Zahlung zeigt **Menge** (`-0,015 BTC`) und **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
