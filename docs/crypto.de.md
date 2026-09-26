# Krypto: Mengen, Kurse, Buchungen

_English: [crypto.md](crypto.md)_

Belege führt Konten bei Börsen (Kraken) und eigene Wallets auf Blockchains (Cosmos, EVM; Bitcoin später). Diese Seite beschreibt das Gemeinsame, die Kraken-Anbindung und die Wallets.

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

## Eigene Wallets

Tokens, die von einer Börse auf eine eigene Wallet gehen, gehören weiter der Firma. _Integrationen → Eigene Wallets_ nimmt eine solche Wallet mit **Chain und Adresse** auf: nur lesend, nie ein Schlüssel oder eine Seed-Phrase. Die Liste der Wallets liegt versiegelt in den Büchern (Einstellung `wallets`); die Bridge behält nichts davon.

**Chains**: Nym (Nyx) und Akash (Cosmos SDK), Ethereum, Base, Arbitrum One, OP Mainnet und Polygon PoS (EVM). Die Tabelle steht in `bridge/src/chains/registry.js`, die Namen der App in `app/src/lib/wallets/chains.js`.

**Abruf** (_Synchronisieren_, je Wallet): Die App schickt die Adresse im Rumpf von `POST /<chain>/wallet` an die Bridge, die Bridge fragt einen öffentlichen Knoten (siehe unten; eine Wallet kann stattdessen einen eigenen https-Endpunkt nennen). Gelesen wird jedes Mal die ganze Geschichte; Bekanntes wird übersprungen.

- **Cosmos**: CometBFT-RPC `tx_search` nach `transfer.sender='<Adresse>'` und `transfer.recipient='<Adresse>'` (jede Bestandsänderung des Bank-Moduls ist ein `transfer`-Ereignis, auch die Gebühr), 100 je Seite, älteste zuerst, nach Hash zusammengeführt; `header` für die Zeit jedes Blocks; `status` für den ältesten Block, den der Knoten noch hat; REST `/cosmos/bank/v1beta1/balances/<Adresse>` für den Bestand; das Memo aus den Bytes der Transaktion.
- **EVM**: zuerst muss der JSON-RPC-Proxy von Blockscout (`…/api/eth-rpc`, `eth_chainId`) die Chain nennen (sonst `WALLET_WRONG_CHAIN`, oder `WALLET_CHAIN_UNVERIFIED`, wenn er es nicht kann); dann die Etherscan-kompatible API, ohne Schlüssel: `txlist`, `txlistinternal`, `tokentx`, `balance`, `tokenbalance`. Über das 10 000-Einträge-Fenster von Blockscout hinaus wird nach Startblock weitergeblättert, bei dessen Ratenlimit wiederholt.

**Konten**: eines je Wallet und Asset, mit der Chain als Quelle: _Wallet NYM ···w6d0y_, _Wallet USDC (Base) ···81efcf_ (eine EVM-Adresse ist auf jeder EVM-Chain dieselbe, darum steht die Chain dabei). Bestand und Stichtag wie bei Kraken.

**Buchungen**: eine je Bewegung, zum Tageskurs (CoinGecko zuerst, Kraken als Rückfall; kein `prefer`, das ist keine Börsenbuchung).

| Was geschah                                                | Buchung                                                                                                                                                                      | Beleg                                                                                                                                                                                                   |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| gesendet / empfangen                                       | movement `transfer`, sourceId `<hash>:m<msg>:e<event>.<n>:<asset>` (Cosmos), `<hash>:value` / `:log:<i>` / `:internal:<i>` (EVM), `counterpartyAddress` = die andere Adresse | nötig – außer die andere Adresse ist eine eigene Wallet                                                                                                                                                 |
| zwischen zwei eigenen Wallets                              | beide Seiten teilen `txRef` (den Hash)                                                                                                                                       | eigene Umbuchung (1360), gepaart über den Hash                                                                                                                                                          |
| an eine eigene, noch nicht abgerufene Wallet               | wie oben                                                                                                                                                                     | eigene Umbuchung (1360), über die Adresse                                                                                                                                                               |
| die Gebühr, die diese Adresse zahlte (auch bei Fehlschlag) | movement `fee`, sourceId `<hash>:fee`                                                                                                                                        | Netzwerkgebühr: die Transaktion ist der Beleg                                                                                                                                                           |
| Staking-Ertrag (von `distribution`)                        | movement `reward`                                                                                                                                                            | keiner (wie der Ertrag einer Börse)                                                                                                                                                                     |
| Delegation (an `bonded_tokens_pool`)                       | movement `stake`                                                                                                                                                             | keiner, Art `crypto-stake`: die Tokens bleiben unsere; **nicht 1360** – ihre Rückkehr nach dem Unbonding ist keine Transaktion, ein Transitkonto ginge nie auf; das Konto entscheidet der Steuerberater |
| IBC-Transfer hinaus                                        | movement `transfer`, der Empfänger auf der anderen Chain als Gegenpartei                                                                                                     | nötig                                                                                                                                                                                                   |

`txRef` ist der Hash genau so, wie die Chain ihn angibt: bei Cosmos Hex in Großbuchstaben, bei EVM `0x` + Hex in Kleinbuchstaben. Krypto-Einzahlungen und -Auszahlungen bei Kraken tragen den On-Chain-Hash als `chainTxRef` (aus DepositStatus/WithdrawStatus) und paaren sich darüber mit der Wallet-Buchung desselben Hashes, gleich welche Euro-Beträge. Jede Buchung behält `explorerUrl`, ihre Transaktion im Block-Explorer; _Zahlungen_ zeigt _Im Block-Explorer ansehen_ und die _Gegenadresse_.

**Ausgelassen, und gesagt**: Denoms und Token, die nicht in der Liste der Chain stehen (IBC-Gutscheine `ibc/…`, Factory-Denoms, jedes ERC-20 außer dem gelisteten USDC – ein Vertrag kann sich „USDC“ nennen); Einträge ohne Kurs (NYX hat bei CoinGecko und Kraken keinen), beim nächsten Abruf erneut versucht; die ältere Geschichte eines gekürzten Knotens (der Abruf sagt, ab welchem Tag der Knoten die Chain kennt – dann einen Archivknoten eintragen). **Gar nicht gesehen**: Tokens, die nach dem Ende eines Unbondings zurückkommen (das macht die Chain ohne Transaktion), Vesting und bei Rollups (Base, Optimism, Arbitrum) die L1-Datengebühr, die die Etherscan-kompatible API von Blockscout nicht meldet. Der Bestand zeigt die Wahrheit; eine Differenz schaut sich ein Mensch an.

**Was der Knoten sieht**: die Adresse und die IP-Adresse des Macs, nur bei _Synchronisieren_ (Einwilligung, _Blockchain-Abfrage_). Das Protokoll der Bridge nennt Zahlen, nie eine Adresse oder einen Betrag.

### Woher die Voreinstellungen kommen (geprüft am 26.09.2026)

| Chain     | Chain-ID     | Adresse                                         | Assets (Nachkommastellen)        | Voreingestellte Endpunkte                                                                                | Explorer (Tx / Adresse)                                      |
| --------- | ------------ | ----------------------------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Nym (Nyx) | `nyx`        | bech32 `n1…`                                    | NYM `unym` (6), NYX `unyx` (6)   | RPC `rpc.nymtech.net`, REST `api.nymtech.net` (Nym); archive: `rpc.nyx.nodes.guru`, `api.nyx.nodes.guru` | `nym.explorers.guru/transaction/{tx}`, `/account/{address}`  |
| Akash     | `akashnet-2` | bech32 `akash1…`                                | AKT `uakt` (6)                   | RPC `akash-rpc.polkachu.com`, REST `akash-api.polkachu.com`; `rpc-akash.ecostake.com`                    | `mintscan.io/akash/transactions/{tx}`, `/accounts/{address}` |
| Ethereum  | 1            | `0x` + 40 hex, EIP-55 bei gemischter Schreibung | ETH (18), USDC `0xA0b8…eB48` (6) | `eth.blockscout.com/api`                                                                                 | `etherscan.io/tx/{tx}`, `/address/{address}`                 |
| Base      | 8453         | wie Ethereum                                    | ETH (18), USDC `0x8335…2913` (6) | `base.blockscout.com/api`                                                                                | `basescan.org/tx/…`, `/address/…`                            |
| Arbitrum  | 42161        | wie Ethereum                                    | ETH (18), USDC `0xaf88…5831` (6) | `arbitrum.blockscout.com/api`                                                                            | `arbiscan.io/tx/…`, `/address/…`                             |
| Optimism  | 10           | wie Ethereum                                    | ETH (18), USDC `0x0b2C…Ff85` (6) | `explorer.optimism.io/api` (Blockscout)                                                                  | `optimistic.etherscan.io/tx/…`, `/address/…`                 |
| Polygon   | 137          | wie Ethereum                                    | POL (18), USDC `0x3c49…3359` (6) | `polygon.blockscout.com/api`                                                                             | `polygonscan.com/tx/…`, `/address/…`                         |

- **An der Quelle geprüft**: Chain-ID, Bech32-Präfix, Denoms, Exponenten, RPC/REST und Explorer-Muster von Nyx und Akash an der Cosmos Chain Registry (`nyx/`, `akash/`: `chain.json`, `assetlist.json`); Nyx' Knoten meldet Chain `nyx`, CometBFT 0.38 und cosmos-sdk 0.53 (Ereignisse also als Text, die Gebühr im `tx`-Ereignis). Die USDC-Verträge an Circles Liste der USDC-Vertragsadressen, ihre 6 Nachkommastellen am Blockscout jeder Chain. Die Blockscout-API antwortet auf jedem Host (der von Optimism ist nach `explorer.optimism.io` umgezogen) und meldet die Chain-IDs 1, 42161, 10 und 137.
- **Durch Ausprobieren geprüft**: Nyms RPC beantwortet `tx_search` nach `transfer.sender` und `transfer.recipient` in deutlich unter einer Sekunde (ein früheres Projekt fand hängende Absender-Abfragen; nicht nachvollziehbar). Er ist **gekürzt** (sein ältester Block ist von 2025); der RPC von Nodes Guru reicht bis zum ersten Block. Blockscout verweigert Seite × Größe über 10 000. Sein `tokentx` nennt keinen Log-Index; die Kennung einer Token-Überweisung besteht darum aus Vertrag, Absender, Empfänger und Betrag (stabil, aber kein Log-Index).
- **Nicht geprüft**: die Chain-ID von Base über ihre API (damals ratenbegrenzt; 8453 ist die bekannte); dass die Explorer-Seiten wirklich etwas anzeigen (Single-Page-Apps, die auf alles mit 200 antworten); wie weit Polkachus Akash-Knoten zurückreicht.

## Im Export

Der Buchungstext einer Krypto-Buchung endet mit der Menge, z. B. `Konto B -0,015 BTC`. Reichen die 60 Zeichen von DATEV nicht, wird der Name gekürzt, nie die Menge. Der Umsatz steht wie bei jeder anderen Zeile in Euro.

## In der App

Die Detailansicht einer Zahlung zeigt **Menge** (`-0,015 BTC`) und **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).
