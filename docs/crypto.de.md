# Krypto: Mengen, Kurse, Buchungen

_English: [crypto.md](crypto.md)_

Belege führt Konten bei Börsen (Kraken) und als Nächstes Wallets auf Blockchains (Cosmos, EVM, Bitcoin). Diese Seite beschreibt das Gemeinsame und die Kraken-Anbindung.

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

   für eine Buchung **bei Kraken** (`prefer=kraken`) ist es umgekehrt: zuerst der EUR-Kurs von Kraken, CoinGecko als Rückfall. Kraken bepreist dann auch Assets, die Belege noch nicht kennt, über ihr `<KÜRZEL>EUR`-Paar;

3. für **USD**: der **EZB-Referenzkurs** des Tages oder der letzte davor (Wochenende, Feiertag), umgerechnet in Euro je Dollar.

Die Anfrage nennt nur ein Asset und einen Tag, nichts über die Buchungen. Vergangene Tage werden im Speicher gehalten. Liegt ein CoinGecko-Demo-Schlüssel im Schlüsselbund (Konto `coingecko`), geht er als Header mit.

**Welcher Kurs und welches Bewertungsverfahren gelten, entscheidet der Steuerberater.** Dazu gehören die Konten für Krypto-Bestände, Kursgewinne und Kursverluste, FIFO oder Durchschnitt und die Bewertung zum Jahresende. Belege hält Kurs und Quelle an jeder Buchung fest, damit sich eine andere Entscheidung später anwenden lässt.

## Kraken

**Einrichten** (einmal): Bei kraken.com einen API-Key anlegen, der nur **Query Funds** und **Query Ledger Entries** darf. Dann `pnpm setup:kraken` ausführen und API-Key und privaten Schlüssel in die verdeckten Eingaben kopieren. Stehen `KRAKEN_API_KEY` und `KRAKEN_PRIVATE_KEY` in der `.env`, bietet das Setup an, sie von dort zu übernehmen. Der Key landet im Schlüsselbund (Konto `kraken`). Ein Testaufruf nennt die Zahl der Assets mit Bestand, nie einen Betrag. Danach die Bridge neu starten. Einen optionalen CoinGecko-Demo-Schlüssel richtet `pnpm setup:coingecko` genauso ein (`COINGECKO_API_KEY`).

**Synchronisieren**: _Integrationen → Kraken (Börse) → Kraken synchronisieren_. Die Bridge liest das Ledger (`GET /kraken/ledgers`, seitenweise über `ofs`, 50 Einträge je Seite, mit Pause und erneutem Versuch beim Rate-Limit) und die Bestände (`GET /kraken/balances`). Der erste Abruf beginnt am 1. Januar, jeder weitere eine Woche vor dem letzten.

**Konten**: eines je Asset und Wallet: _Kraken EUR_, _Kraken BTC_, _Kraken BTC (Earn)_ für gestakte oder verzinste Bestände (die `.S`-, `.M`-, …-Assets von Kraken). Jedes braucht wie ein Bankkonto sein Sachkonto in MonkeyOffice (_Eigene Anweisungen_).

**Buchungen**: eine je Ledger-Eintrag, dazu eine für jede Gebühr, die Kraken darauf berechnet hat. So ist die Gebühr sichtbar und wird auf 4970 gebucht.

| Eintrag                                                  | Euro-Betrag                                                                              | Erkannt als                                                                                                                                                          |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| EUR-Einzahlung / -Auszahlung                             | der Betrag                                                                               | eigene Umbuchung mit der Bankbuchung gleichen Betrags innerhalb von 4 Tagen (Hinweis: _Kraken_)                                                                      |
| Kauf oder Verkauf gegen EUR (`trade`, `spend`/`receive`) | das Krypto-Bein ist genau das wert, was bezahlt oder erhalten wurde (Kursquelle `trade`) | eigene Umbuchung zwischen den beiden Kraken-Konten (gleiche Referenz)                                                                                                |
| Krypto gegen Krypto                                      | das abgehende Bein zum Tageskurs, das eingehende spiegelt es                             | eigene Umbuchung (gleiche Referenz)                                                                                                                                  |
| Spot ↔ Earn                                             | Tageskurs, beide Beine                                                                   | eigene Umbuchung (gleiche Referenz)                                                                                                                                  |
| Staking- / Earn-Ertrag                                   | Tageskurs                                                                                | _Ertrag der Börse_: kein Beleg nötig; das Konto legt ihr mit dem Steuerberater fest                                                                                  |
| Gebühr                                                   | zum Kurs ihres Eintrags                                                                  | Gebühr der Börse, 4970                                                                                                                                               |
| Krypto-Einzahlung / -Auszahlung                          | Tageskurs                                                                                | eigene Umbuchung mit der Wallet-Buchung, die denselben Transaktions-Hash trägt (Krakens `txid` aus DepositStatus / WithdrawStatus), unabhängig von den Euro-Beträgen |

**Beschriftung** nach Typ und Subtyp von Kraken: Nur `spottostaking`, `stakingfromspot` und Verwandte sind _Umbuchung Spot/Earn_, `spottofutures`/`spotfromfutures` _Umbuchung Spot/Futures_. Einen Subtyp, den Belege nicht kennt, zeigt es so, wie Kraken ihn schreibt (`Kraken: transfer/…`), statt zu raten. Die Detailansicht zeigt Krakens Art, die Referenz und den Transaktions-Hash und listet die anderen Buchungen mit derselben Referenz (_Gehört zusammen mit_).

Zwei Seiten, die über die Referenz zusammengehören, aber unterschiedlich bewertet sind (eine Kraken-Auszahlung und die Wallet, die sie an einem anderen Tag erhielt), gehen im Export jede für sich gegen 1360. So bleibt die Wertdifferenz dort sichtbar.

Ein Eintrag ohne auffindbaren Kurs bleibt samt seinem Handel draußen. Er wird nach dem Abruf aufgeführt und beim nächsten Mal erneut geholt.

**Hier nicht entschieden**: Gewinne und Verluste beim Verkauf (Anschaffungskosten nach FIFO oder Durchschnitt) und die Bewertung zum Jahresende. Jede Buchung behält Menge, Kurs und Quelle, damit sich das Verfahren des Steuerberaters darauf anwenden lässt.

## Im Export

Der Buchungstext einer Krypto-Buchung endet mit der Menge, z. B. `Konto B -0,015 BTC`. Reichen die 60 Zeichen von DATEV nicht, wird der Name gekürzt, nie die Menge. Der Umsatz steht wie bei jeder anderen Zeile in Euro.

## In der App

Die Detailansicht einer Zahlung zeigt **Menge** (`-0,015 BTC`) und **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
