# Krypto: Mengen, Kurse, Buchungen

_English: [crypto.md](crypto.md)_

Belege führt Konten bei Börsen und eigene Wallets auf Blockchains. Die Börse ist bisher Kraken. Eine Wallet ist ein Konto auf einer Blockchain, erkennbar an ihrer Adresse. Belege liest Wallets auf Cosmos-Chains (Nym, Akash), auf EVM-Chains (Ethereum und verwandte), auf Bitcoin und Filecoin. Monero-Wallets importierst du aus einer Datei.

Diese Seite beschreibt:

- was alle Krypto-Konten gemeinsam haben,
- woher der Euro-Kurs eines Tages kommt,
- die Anbindung an Kraken,
- die eigenen Wallets, Chain für Chain,
- die Credits bei Aleph Cloud,
- wie Krypto im Export und in der App erscheint.

Ein paar Wörter, die oft vorkommen:

- **Asset:** eine Kryptowährung oder ein Token, etwa BTC, ETH oder USDC.
- **Chain:** eine Blockchain, etwa Ethereum oder Bitcoin.
- **Hash:** die Kennung einer Transaktion auf der Chain, eine lange Zeichenfolge.
- **Block-Explorer:** eine Website, auf der man eine Transaktion oder Adresse nachschlagen kann, etwa Etherscan.
- **Knoten:** ein Server, der die Chain kennt und Fragen dazu beantwortet.
- **Die Bridge:** das Programm von Belege, das auf deinem Mac oder Windows-Rechner läuft und für die App ins Netz fragt. Nicht zu verwechseln mit einer Bridge zwischen zwei Chains (siehe [Über Chains hinweg](#über-chains-hinweg)).
- **Schlüsselbund:** der macOS-Schlüsselbund. Unter Windows nutzt die Bridge stattdessen die Windows-Anmeldeinformationsverwaltung.

## Ein Konto je Asset

Ein Krypto-Konto hält genau ein Asset. _Kraken BTC_, _Kraken EUR_ und _Wallet NYM_ sind also drei Konten. Jedes hat in der Buchhaltung sein eigenes Sachkonto.

Welche Assets Belege kennt, steht in einer Liste. Zu jedem Asset stehen dort Kürzel, Name und Nachkommastellen. Wo sie sicher ist, steht dort auch die kettenübergreifende Kennung nach CAIP-19 (`app/src/lib/assets/registry.js`).

## Eine Krypto-Bewegung wird in Euro gebucht und behält, was bewegt wurde

Belege bucht in Euro-Cent, wie bei den Bankkonten. Der Betrag einer Buchung (`amountCents`) ist der Wert der Bewegung an ihrem Tag. Daneben behält die Buchung diese Felder:

- **`asset`** – das Kürzel, zum Beispiel `BTC`.
- **`quantity`** – die Menge mit Vorzeichen, in der kleinsten Einheit des Assets. Beispiel: `"-1500000"` Satoshi sind −0,015 BTC. Die Menge steht als Text da, weil Token mit 18 Nachkommastellen nicht in eine Gleitkommazahl passen.
- **`decimals`** – die Nachkommastellen des Assets, bei BTC `8`. So erklärt sich der Datensatz selbst.
- **`movement`** – die Art der Bewegung: `transfer` (Überweisung), `trade` (Handel oder Tausch), `fee` (Gebühr), `reward` (Ertrag) oder `stake` (Staking, also Tokens, die zum Absichern der Chain gebunden sind).
- **`txRef`** – der Hash der Transaktion oder die Referenz der Börse.
- **`valuation`** – der Kurs: Euro je ganzer Einheit, woher er kommt und für welchen Zeitpunkt er gilt. Beispiel: `{ rate: "60000", currency: "EUR", source: "coingecko", at: "2026-09-01T00:00:00Z" }`.

Der Euro-Betrag ist Menge mal Kurs. Gerechnet wird mit ganzen Zahlen. Gerundet wird einmal, kaufmännisch (`app/src/lib/assets/quantity.js`). Kein Krypto-Betrag läuft über eine Gleitkommazahl.

## Der Kurs eines Tages

Den Kurs fragt die App bei der Bridge ab (`GET /rates?asset=BTC&date=2026-09-01`, `packages/rates/src/rates.js`). Der Browser kann die Kursquellen nicht selbst fragen, das verhindern die Browser-Regeln (CORS). Außerdem bleibt ein optionaler CoinGecko-Schlüssel so im Schlüsselbund.

Der Kurs ist immer der Wert einer Einheit **um 00:00 UTC des Tages**. Die Bridge fragt in dieser Reihenfolge:

1. **CoinGecko**, dessen Tagesstand (`/coins/{id}/history`).
2. Sonst **Kraken**, den Eröffnungskurs der Tageskerze.
   - CoinGecko antwortet nur für die letzten 365 Tage. Krakens Tageskerzen reichen 720 Tage zurück.
   - Für einen älteren Tag fragt die Bridge Krakens Handelshistorie. Sie nimmt den ersten Handel dieses Tages nach 00:00 UTC. Das ist der Kurs, mit dem die Kerze eröffnet hätte.
   - Vor dem Tag, an dem Kraken das Paar aufnahm, gibt es keinen Kurs.
   - Für eine Buchung **bei Kraken** (`prefer=kraken`) ist es umgekehrt: zuerst der EUR-Kurs von Kraken, CoinGecko als Rückfall. Kraken bepreist dann auch Assets, die Belege noch nicht kennt, über ihr Paar `<KÜRZEL>EUR`.
3. Für **Währungen** gilt Folgendes:
   - **USD** und die anderen Währungen, die die EZB veröffentlicht: der **EZB-Referenzkurs** des Tages. Gibt es an dem Tag keinen (Wochenende, Feiertag), gilt der letzte davor. Er wird umgerechnet in Euro je Einheit.
   - **RUB** nach dem 1. März 2022: Seitdem veröffentlicht die EZB keinen Kurs mehr. Es gilt der amtliche Kurs der **Bank of Russia**, der an dem Tag gilt.
   - **KZT**: der amtliche Tageskurs der **Nationalbank Kasachstans**.
   - Eine Währung, für die weder die EZB noch diese Banken einen Euro-Kurs veröffentlichen, die aber die Bank of Russia führt (UZS, GEL, AMD, KGS, AED, …): ein **Kreuzkurs über den Rubel** aus der Tagesdatei der Bank of Russia. Er ist als solcher markiert (`cbr-cross`, CBR-X). Ein amtlicher Euro-Kurs ist er nicht (#325).
4. Für einen **Token, der nicht in der Liste steht**, auf Ethereum oder Base: Kennt CoinGecko seinen Vertrag nicht, fragt die Bridge seinen **Uniswap-Pool** im Block der Buchung (Uniswap V2, V3 und V4, gegen ETH oder USDC). Ein Pool ist ein Topf, in dem zwei Tokens gegeneinander getauscht werden; sein Verhältnis ergibt den Preis. Gezählt wird der tiefste Pool, und nur, wenn er mindestens 3.000 Euro hält. Das braucht einen Alchemy-Schlüssel (siehe [Alchemy](#alchemy)); ohne ihn gibt es keinen Pool-Kurs (#163, `packages/rates/src/dex-rate.js`).

Die Anfrage nennt nur ein Asset und einen Tag, nichts über deine Buchungen. Vergangene Tage behält die Bridge im Speicher. Liegt ein CoinGecko-Demo-Schlüssel im Schlüsselbund (Konto `coingecko`), schickt die Bridge ihn als Header mit.

**Welcher Kurs und welches Bewertungsverfahren gelten, entscheidet der Steuerberater.** Dazu gehören:

- die Konten für Krypto-Bestände, Kursgewinne und Kursverluste,
- FIFO oder Durchschnitt,
- die Bewertung zum Jahresende.

Belege hält Kurs und Quelle an jeder Buchung fest. So lässt sich eine andere Entscheidung später anwenden.

## Kraken

### Einrichten

Das machst du einmal:

1. Leg bei kraken.com einen API-Key an. Er darf nur **Query Funds** und **Query Ledger Entries**. Ein API-Key ist ein Zugang für Programme statt für Menschen.
2. Führ `pnpm setup:kraken` aus. Kopier API-Key und privaten Schlüssel in die verdeckten Eingaben. Stehen `KRAKEN_API_KEY` und `KRAKEN_PRIVATE_KEY` in der `.env`, bietet das Setup an, sie von dort zu übernehmen.
3. Der Key landet im Schlüsselbund (Konto `kraken`). Ein Testaufruf nennt die Zahl der Assets mit Bestand, nie einen Betrag.
4. Starte die Bridge neu.

Einen optionalen CoinGecko-Demo-Schlüssel richtest du genauso mit `pnpm setup:coingecko` ein (`COINGECKO_API_KEY`).

### Synchronisieren

Unter _Integrationen → Kraken (Börse) → Kraken synchronisieren_. Die Bridge liest dann:

- das Ledger, also Krakens Kontobuch (`GET /kraken/ledgers`). Sie liest es seitenweise über `ofs`, 50 Einträge je Seite. Meldet Kraken sein Rate-Limit (zu viele Anfragen), macht sie eine Pause und versucht es erneut.
- die Bestände (`GET /kraken/balances`).

Der erste Abruf beginnt am 1. Januar. Jeder weitere beginnt eine Woche vor dem letzten.

**Technik:** Die Anfragen laufen über [ccxt](https://github.com/ccxt/ccxt) (MIT). ccxt signiert sie und ordnet Krakens Fehlercodes zu. Die Bridge nutzt dessen direkte Endpunkte. Die Einträge sind also Krakens eigene und werden gelesen wie bisher. Die Nonce (eine Zahl, die bei jeder Anfrage steigen muss) bleibt in Mikrosekunden, wie die Bridge sie immer gesendet hat. Kraken merkt sich die höchste Nonce eines Schlüssels und lehnt eine niedrigere ab. Weitere Börsen über ccxt sind geplant (#265).

### Konten

Es gibt ein Konto je Asset und Wallet, zum Beispiel _Kraken EUR_, _Kraken BTC_ und _Kraken BTC (Earn)_. Ein Earn-Konto hält gestakte oder verzinste Bestände, bei Kraken die Assets mit `.S`, `.M` und so weiter. Jedes Konto braucht wie ein Bankkonto sein Sachkonto in der Buchhaltung. Du trägst es unter _Einstellungen → Buchhaltung (DATEV)_ ein.

### Buchungen

Jeder Ledger-Eintrag wird eine Buchung. Dazu kommt eine Buchung für jede Gebühr, die Kraken darauf berechnet hat. So ist die Gebühr sichtbar und wird auf 4970 gebucht.

So bucht Belege die einzelnen Einträge:

- **EUR-Einzahlung oder -Auszahlung:** Der Euro-Betrag ist der Betrag. Erkannt wird sie als eigene Umbuchung, wenn auf dem Bankkonto innerhalb von 4 Tagen derselbe Betrag steht. Der Hinweis lautet _Kraken_.
- **Kauf oder Verkauf gegen EUR** (`trade`, `spend`/`receive`): Das Krypto-Bein ist genau das wert, was bezahlt oder erhalten wurde (Kursquelle `trade`). Erkannt als eigene Umbuchung zwischen den beiden Kraken-Konten (gleiche Referenz).
- **Krypto gegen Krypto:** Das abgehende Bein gilt zum Tageskurs, das eingehende spiegelt es. Erkannt als eigene Umbuchung (gleiche Referenz).
- **Spot ↔ Earn:** beide Beine zum Tageskurs. Erkannt als eigene Umbuchung (gleiche Referenz).
- **Staking- oder Earn-Ertrag:** zum Tageskurs. Erkannt als _Ertrag der Börse_. Er braucht keinen Beleg. Vorgeschlagen wird 2700 Sonstige Erträge oder das Konto aus _Einstellungen → Buchhaltung (DATEV)_; das Konto legst du mit dem Steuerberater fest.
- **Gebühr:** zum Kurs ihres Eintrags. Erkannt als Gebühr der Börse, Konto 4970.
- **Krypto-Einzahlung oder -Auszahlung:** zum Tageskurs. Erkannt als eigene Umbuchung mit der Wallet-Buchung, die denselben Hash trägt. Den Hash nennt Kraken als `txid` in DepositStatus und WithdrawStatus. Die Euro-Beträge spielen dafür keine Rolle.

**Beschriftung:** Sie folgt Typ und Subtyp von Kraken.

- Nur `spottostaking`, `stakingfromspot` und Verwandte heißen _Umbuchung Spot/Earn_.
- `spottofutures` und `spotfromfutures` heißen _Umbuchung Spot/Futures_.
- Einen Subtyp, den Belege nicht kennt, zeigt es so, wie Kraken ihn schreibt (`Kraken: transfer/…`). Belege rät nicht.

Die Detailansicht zeigt Krakens Art, die Referenz und den Hash. Sie listet die anderen Buchungen mit derselben Referenz unter _Gehört zusammen mit_.

Zwei Seiten gehören manchmal über die Referenz zusammen, sind aber unterschiedlich bewertet. Beispiel: eine Kraken-Auszahlung und die Wallet, die sie an einem anderen Tag erhielt. Im Export geht dann jede Seite für sich gegen 1360. So bleibt die Wertdifferenz dort sichtbar.

Findet Belege für einen Eintrag keinen Kurs, bleibt er samt seinem Handel draußen. Er wird nach dem Abruf aufgeführt und beim nächsten Mal erneut geholt.

**Hier nicht entschieden:**

- Gewinne und Verluste beim Verkauf (Anschaffungskosten nach FIFO oder Durchschnitt),
- die Bewertung zum Jahresende.

Jede Buchung behält Menge, Kurs und Quelle. So lässt sich das Verfahren des Steuerberaters darauf anwenden.

### Auf welcher Blockchain der Hash einer Einzahlung liegt (Issue #215)

Eine Ein- oder Auszahlung behält Krakens Hash auf der Chain (`chainTxRef`). Wo Kraken es nennt, behält sie auch das Netzwerk (`chainMethod`, etwa `Filecoin` oder `Ether (Arbitrum One)`).

Eine Krypto-Auszahlung behält außerdem die Adresse, an die sie ging (`chainAddress`, Krakens `info` aus WithdrawStatus; das `info` einer Einzahlung ist Krakens eigene Adresse und wird nicht behalten). Ist diese Adresse noch keine eigene Wallet, auf einer Chain, die Belege per Adresse liest, sagt das Detail der Zahlung es und bietet _Als eigene Wallet anlegen_ an: Der Klick öffnet _Integrationen → Eigene Wallets_ mit Chain und Adresse ausgefüllt. Angelegt und bei einem Knoten abgefragt wird erst, wenn du dort den Knopf drückst – eine Adresse beweist nicht, wem sie gehört, und eine Auszahlung kann auch jemand anderen bezahlen. Bei einem EVM-Hash ohne genanntes Netzwerk wird jede EVM-Chain angeboten. Bei einer Chain, die Belege nicht lesen kann (etwa Solana), sagt das Detail, dass die Ankunft nicht gefunden wird. Bitcoin (über einen Schlüssel in der Bridge gelesen) und Monero (importiert) werden nicht angeboten (`app/src/lib/wallets/suggest.js`).

Dasselbe Detail fragt, **was die Überweisung war** (_Was war diese Zahlung?_), bei der Auszahlung einer Börse und bei der Buchung einer eigenen Wallet an oder von einer Adresse, die sonst nichts erklärt. Die Antwort gilt für die Adresse und steht am Partner, sodass jede Buchung mit ihr gleich behandelt wird:

- _eine eigene Wallet_ – angelegt und gelesen, wie oben; beide Seiten werden eine eigene Umbuchung;
- _privat_ – die eigene private Adresse, eine Entnahme oder Einlage: kein Beleg, zählt als privat;
- _ein Lieferant oder Dienstleister_ (bei einem Eingang: _ein Kunde_) – die Adresse von jemand anderem: Die Adresse bekommt den Namen, und die Zahlung braucht ihre Rechnung;
- _eigenes Geld bei einer Börse oder einem Verwahrer_, die Belege nicht liest: kein Beleg, eine eigene Umbuchung auf 1360, deren andere Seite nicht in den Büchern steht – 1360 bleibt um diesen Betrag offen.

Was die Bücher selbst sehen – eine eigene Wallet, eine Gegenbuchung, derselbe Hash – geht immer vor. Eine Antwort lässt sich zurücknehmen (_Aufheben_). Wie eine Entnahme, ein Tausch oder Staking steuerlich zu buchen ist, klärt der Steuerberater; Belege schlägt nur vor (`app/src/lib/matching/partners.js` `ADDRESS_KINDS`, `classify.js`).

Das Detail der Zahlung bestimmt daraus die Chain. Das passiert lokal, in dieser Reihenfolge:

1. eine Buchung einer eigenen Wallet mit demselben Hash;
2. Krakens Netzwerkname, wo er zur Form des Hashes passt;
3. die Form des Hashes zusammen mit dem Asset:
   - eine CID `bafy2bzace…` ist Filecoin;
   - `0x` + 64 Hex-Zeichen ist eine EVM-Chain. Hat das Asset eine Heimat-Chain, ist es diese (POL → Polygon);
   - 64 Hex-Zeichen sind bei BTC Bitcoin, bei NYM Nyx, bei AKT Akash;
   - Base58 mit 87–88 Zeichen ist Solana.

Ist die Chain eindeutig, bekommt sie ihren Namen und einen Link zu ihrem Explorer. Die Explorer sind Filfox, mempool.space, Etherscan und Geschwister, Nodes Guru, Mintscan und Solscan. Ein EVM-Hash ohne Netzwerkangabe nennt die EVM-Chains, auf denen er liegen kann, jede mit Link.

Kein Explorer wird gefragt. Ein Link öffnet erst auf deinen Klick (`app/src/lib/assets/hash-chain.js`).

## Eigene Wallets

Tokens, die von einer Börse auf eine eigene Wallet gehen, gehören weiter der Firma. Eine solche Wallet nimmst du unter _Integrationen → Eigene Wallets_ auf, mit **Chain und Adresse**. Belege liest nur. Es fragt nie nach einem Schlüssel oder einer Seed-Phrase. Die Liste der Wallets liegt versiegelt in den Büchern (Einstellung `wallets`). Die Bridge behält nichts davon.

**Die Seite** hat drei Reiter; den zuletzt gewählten merkt sich der Browser (localStorage `belege.walletsTab`, eine Einstellung der Ansicht, keine Daten der Bücher).

- _Wallets_ zeigt die Wallets nach Chain gruppiert. Jede Gruppe trägt die Farbe, die ihre Chain im Wertdiagramm hat: Die vier wertvollsten Chains haben eine eigene Farbe, die übrigen sind grau. Zuerst kommen Chains, bei denen das Synchronisieren fehlschlug, dann solche, deren Buchungen den Bestand nicht ergeben, dann nach Wert und nach Name. Eine Gruppe lässt sich zuklappen; auf dem Handy sind alle zuerst zugeklappt. Sie nennt die Zahl ihrer Wallets, und _Kette synchronisieren_ holt nur die Wallets dieser Chain, so wie _Alle … synchronisieren_ alle. Das Suchfeld darüber findet eine Wallet nach Name, Adresse, Chain oder Asset.
- Jede Wallet ist eine Zeile: ein Status-Symbol, Name und Adresse (Klick kopiert), die Bestände rechtsbündig, gerundet auf höchstens vier Nachkommastellen – unter 1 auf vier gültige Stellen, unter 0,0001 als „< 0,0001“; die genaue Zahl steht im Tooltip und in den Details –, wann zuletzt synchronisiert, ein Symbol zum Synchronisieren, ein ⋯-Menü (Bezeichnung, Konto und Kostenstelle · Block-Explorer · Entfernen) und die Details. Die Details nennen die ganze Adresse, die Endpunkte mit dem Dienst dahinter (Blockscout für EVM-Chains, Esplora bei mempool.space für Bitcoin, Filfox für Filecoin, NearBlocks für NEAR), Konto und Kostenstelle, jedes Asset-Konto mit genauem Bestand und dem Bestandsabgleich, das letzte Synchronisieren und bei einem Fehler die ganze Meldung mit ihrem Ausweg. Einen Fehler sagt die Gruppe einmal, mit den Wallets, die er betrifft.
- _Übersicht_ zeigt das Wertdiagramm und je Chain die Wallets, ihren Bestand und den Wert am letzten Tag mit Kurs.
- _Nachweise_ zeigt die monatlichen Nachweise: den von Akash je Akash-Wallet, den von Filecoin Pay und einen Link zu den Aleph-Nachweisen, die zur Aleph-Integration gehören (#1019).

**Chains:**

- Cosmos SDK: Nym (Nyx) und Akash;
- EVM: Ethereum, Base, Arbitrum One, OP Mainnet und Polygon PoS;
- Bitcoin (siehe [Bitcoin](#bitcoin));
- Filecoin (siehe [Filecoin](#filecoin));
- NEAR (siehe [NEAR](#near));
- Monero, als importierte Datei (siehe [Monero](#monero)).

Die Tabelle der Chains steht in `packages/chains/src/registry.js`, die Namen in der App in `app/src/lib/wallets/chains.js`.

### Abrufen

**Eine Wallet** (_Synchronisieren_, das Symbol in ihrer Zeile): Die App schickt die Adresse an die Bridge, im Rumpf von `POST /<chain>/wallet`. Die Bridge fragt einen öffentlichen Knoten (siehe unten). Eine Wallet kann stattdessen einen eigenen https-Endpunkt nennen. Gelesen wird jedes Mal die ganze Geschichte. Was schon bekannt ist, wird übersprungen.

**Alle Wallets auf einmal** (_Alle … Wallets synchronisieren_):

- Belege ruft alle Wallets ab, die es über ihre Adresse liest, eine nach der anderen.
- Der Fortschritt steht in Prozent in der Karte und am Reiter _Integrationen_.
- Der Lauf geht weiter, wenn du woanders in Belege hinklickst. Nur Neuladen bricht ab. Was schon abgerufen ist, bleibt.
- Am Ende sagt die Karte, was kam: neue Buchungen, Buchungen ohne Kurs, Wallets, die nicht abrufbar waren.
- Ist Belege dann im Hintergrund und es kamen neue Buchungen, sagt es eine Mitteilung des Systems. Sie nennt nur Zahlen, nie Betrag, Name oder Adresse, denn sie kann auf dem gesperrten Bildschirm stehen. Um Erlaubnis fragt der Browser einmal, beim ersten Klick auf den Knopf.
- Eine Monero-Wallet ist nicht dabei. Ihr Verlauf ist eine Datei, die du importierst.

### Cosmos (Nym, Akash)

Die Bridge fragt den Knoten so:

- **Bewegungen:** über CometBFT-RPC `tx_search`, einmal nach `transfer.sender='<Adresse>'`, einmal nach `transfer.recipient='<Adresse>'`. 100 je Seite, älteste zuerst, nach Hash zusammengeführt.
- **Zeit:** `header` für die Zeit jedes Blocks.
- **Ältester Block:** `status` für den ältesten Block, den der Knoten noch hat.
- **Bestand:** REST `/cosmos/bank/v1beta1/balances/<Adresse>`.
- **Memo:** aus den Bytes der Transaktion. Ein Memo ist ein kurzer Text, den der Absender mitschickt.

Überweisung, Gebühr und Reward sind `transfer`-Ereignisse. Eine Delegation (Tokens, die du einem Validator zum Staking überlässt) ist keins. `DelegateCoins` meldet nur `coin_spent` und `coin_received`. Darum zählt so ein Paar ohne folgendes `transfer` ebenfalls als Bewegung. Auf Chains vor cosmos-sdk 0.44 zählt das `delegate`-Ereignis. Ihre Gebühr zahlt die Delegation per Transfer, darum findet die Absender-Abfrage sie (Issue #135).

### Akash: ältere Geschichte (Issue #105)

Jeder öffentliche Akash-Knoten ist gekürzt. Er kennt die Chain also erst ab einem späteren Block. Liegt der unterste Block des Knotens über 1, liest die Bridge alles davor aus dem Akash-Console-Indexer. Der Indexer liegt unter `console-api.akash.network`, wird vom Akash-Team betrieben, ist quelloffen und braucht keinen Schlüssel.

So geht die Bridge vor:

1. Sie holt die Transaktionen der Adresse (`/v1/addresses/<Adresse>/transactions/<skip>/<limit>`).
2. Dann holt sie jede einzeln per Hash (`/v1/transactions/<Hash>`), mit ihren dekodierten Nachrichten, Unterzeichnern und der Gebühr.
3. Aus den Nachrichten bucht sie: Überweisungen, Multi-Sends, IBC-Transfers hinaus und zurück, Delegationen, Escrow-Einzahlungen aus dem Bestand und Governance-Einlagen.
4. Dazu bucht sie die Gebühr jeder Transaktion, die die Adresse als Erste unterzeichnet hat (`packages/chains/src/akash-console.js`).

**Was fehlt:** Der Indexer hat keine Events. Er kennt darum keinen Betrag, der nur in einem Event steht. Das betrifft:

- abgehobene Rewards,
- die Rewards, die eine Delegation, Umdelegation oder Entdelegation nebenbei abhebt,
- Escrow-Rückzahlungen,
- Lease-Auszahlungen,
- authz-`MsgExec`.

Diese Transaktionen werden gezählt und auf der Wallet-Karte genannt. Der Bestandsabgleich zeigt die Lücke.

**Wechsel der Quelle:** Rückt das Fenster des Knotens weiter, kommt eine Transaktion, die zuerst vom Knoten kam, später unter einer anderen Kennung aus dem Indexer. Die App behält die Kennung, unter der sie gebucht wurde. Sie erkennt die Transaktion an gleichem Hash, gleicher Art und gleicher Menge (`reconcileSourceIds`).

**Geprüft am 27.09.2026:** Die Geschichte reicht bis März 2021 (Mainnet-2). Gebühren und Überweisungen stimmen mit den Events des Knotens überein. Reward-Beträge stehen im Indexer als 0.

### Akash: Burn-Mint (BME, #303)

Deployments, also gemietete Rechner bei Akash, werden in ACT bezahlt. ACT entsteht durch `MsgMintACT`: Dabei werden AKT verbrannt und ACT geprägt.

- So eine Transaktion ist ein Tausch AKT → ACT (_Tausch … über Akash BME_). Wie ein DEX-Tausch braucht sie keinen Beleg.
- Vom Knoten kommen beide Seiten aus den Events. ACT wird genannt, aber nicht gelistet.
- Aus dem Indexer kommen die verbrannten AKT aus der Nachricht. Die geprägten ACT stehen nur in den Events. Ihre Menge ist darum „unbekannt“.
- `MsgBurnACT` (ACT zurück zu AKT) wird aus dem Indexer nur gezählt, weil seine AKT nur in den Events stehen.

### Akash: eine Kraken-Auszahlung, die die Liste auslässt (#303)

Die Liste des Indexers zu einer Adresse kann eine Transaktion auslassen, zum Beispiel die erste Einzahlung von Kraken. Darum gibt die App der Bridge beim Synchronisieren Hashes mit. Es sind die Hashes ihrer Kraken-Auszahlungen im nativen Asset der Chain, zu denen es noch keine Wallet-Buchung gibt.

Die Bridge fragt den Indexer nach jedem dieser Hashes. Bewegt die Transaktion etwas dieser Wallet, bucht sie sie als eigene Umbuchung zur Auszahlung. Nur diese Hashes verlassen die App, und nur an den Indexer, den sie ohnehin fragt.

### Akash: monatlicher Verbrauchsnachweis (#305)

Bei Akash stellt kein Lieferant eine Rechnung. Im Reiter _Nachweise_, auf der Karte einer Akash-Wallet, erstellt _Verbrauchsnachweis erstellen_ deshalb je Monat einen Eigenbeleg (EB-JJJJ-NNN, wie bei Aleph). Ein Eigenbeleg ist ein Beleg, den du selbst ausstellst, wo kein fremder existiert.

Er führt auf:

- die Netzwerkgebühren mit ihren Hashes;
- die für ACT verbrannten AKT;
- den Verbrauch jedes Deployments.

So entsteht der Verbrauch eines Deployments:

- Der Knoten listet die Deployments eines Eigentümers mit ihrem Escrow, dem hinterlegten Guthaben (`/akash/deployment/v1beta4/deployments/list`). Der Indexer liefert die Blockzeiten.
- Die Chain führt je Deployment nur die Gesamtsumme, die an die Anbieter ging. Diese wird gleichmäßig über die Laufzeit verteilt. Gezählt wird der Anteil des Monats.
- ACT wird mit 1 USD bewertet (Akashs Burn-Mint), zum EZB-Kurs vom letzten Tag des Monats.

Der Nachweis wird ein Beleg. Er ist mit den Netzwerkgebühren des Monats verknüpft. Im DATEV-Export gehen diese Gebühren als eine Sammelbuchung je Wallet-Konto ein. Das lässt sich auf der Export-Seite abschalten. Die Bewertung ist mit der Steuerberatung abzustimmen.

### Akash: ACT-Konto (#305)

_ACT-Konto anzeigen_ auf der Karte einer Akash-Wallet zeigt Akash als Lieferantenkonto, Monat für Monat:

- aufgeladene ACT (Burn-Mint),
- Verbrauch der Deployments,
- Saldo.

Das Konto muss aufgehen: geprägt = Bestand jetzt (`uact`-Bestand laut Knoten) + Rest im Escrow + verbraucht.

Bei älteren Aufladungen steht die ACT-Menge nicht mehr auf der Chain. Was diese Aufladungen zusammen ergaben, folgt dann aus der Gleichung. Die Summe wird nach den verbrannten AKT auf sie verteilt.

In Euro gilt der Anschaffungswert:

- Eine Aufladung kostet, was ihre AKT gebucht wurden.
- Jedes ACT kostet den Durchschnitt aller Aufladungen.
- Verbrauch und Rest werden zu diesem Wert bewertet.

Ob die Aufladung als Anzahlung und erst der Verbrauch als Aufwand gebucht wird, entscheidet die Steuerberatung.

### EVM (Ethereum, Base, Arbitrum, Optimism, Polygon)

Ohne Alchemy-Schlüssel liest die Bridge EVM-Wallets bei Blockscout, ohne Schlüssel:

1. Zuerst muss der JSON-RPC-Proxy von Blockscout die Chain nennen (`…/api/eth-rpc`, `eth_chainId`). Nennt er eine andere, meldet die Bridge `WALLET_WRONG_CHAIN`. Kann er es nicht sagen, meldet sie `WALLET_CHAIN_UNVERIFIED`.
2. Dann fragt sie die Etherscan-kompatible API: `txlist`, `txlistinternal`, `tokentx`, `balance`, `tokenbalance`.
3. Blockscout liefert höchstens 10 000 Einträge am Stück. Darüber hinaus blättert die Bridge nach Startblock weiter. Bei Blockscouts Rate-Limit versucht sie es erneut.

Ohne Schlüssel beantwortet Blockscout nur wenige Abfragen je halbe Stunde und IP-Adresse. Beobachtet wurden etwa zehn. Ein Abruf braucht mindestens sechs. Danach kommt HTTP 429 (zu viele Anfragen).

Hat `pnpm setup:alchemy` einen Schlüssel abgelegt und nennt die Wallet keinen eigenen `api`-Endpunkt, liest die Bridge über Alchemy. Siehe [Alchemy](#alchemy) unten.

### Konten und Buchungen der Wallets

**Konten:** Es gibt eines je Wallet und Asset, mit der Chain als Quelle. Beispiele: _Wallet NYM ···w6d0y_, _Wallet USDC (Base) ···81efcf_. Eine EVM-Adresse ist auf jeder EVM-Chain dieselbe, darum steht die Chain dabei. Bestand und Stichtag funktionieren wie bei Kraken.

**Buchungen:** eine je Bewegung, zum Tageskurs. CoinGecko kommt zuerst, Kraken ist der Rückfall. Es gibt kein `prefer`, denn das ist keine Börsenbuchung.

So wird gebucht:

- **Gesendet oder empfangen:** Bewegung `transfer`. Die Buchung nennt die andere Adresse (`counterpartyAddress`). Ein Beleg ist nötig, außer die andere Adresse ist eine eigene Wallet.
- **Zwischen zwei eigenen Wallets:** Beide Seiten teilen den Hash als `txRef`. Das ist eine eigene Umbuchung (1360), gepaart über den Hash.
- **An eine eigene Wallet, die noch nicht abgerufen wurde:** ebenso eine eigene Umbuchung (1360), erkannt über die Adresse.
- **Die Gebühr, die diese Adresse zahlte** (auch bei einer fehlgeschlagenen Transaktion): Bewegung `fee`. Das ist eine Netzwerkgebühr. Die Transaktion ist der Beleg.
- **Staking-Ertrag** (vom Modul `distribution`): Bewegung `reward`. Kein Beleg, wie beim Ertrag einer Börse, und dasselbe vorgeschlagene Konto (2700, oder das aus den Einstellungen).
- **Delegation** (an `bonded_tokens_pool`): Bewegung `stake`, Art `crypto-stake`. Kein Beleg, die Tokens bleiben deine. **Nicht 1360:** Ihre Rückkehr nach dem Unbonding ist keine Transaktion, ein Transitkonto ginge also nie auf. Das Konto entscheidet der Steuerberater.
- **IBC-Transfer hinaus** (zu einer anderen Cosmos-Chain): Bewegung `transfer`. Der Empfänger auf der anderen Chain ist die Gegenpartei. Ein Beleg ist nötig.

Jede Buchung hat eine Kennung (`sourceId`), damit sie nicht doppelt gebucht wird:

- Cosmos: `<hash>:m<msg>:e<event>.<n>:<asset>`;
- EVM: `<hash>:value`, `<hash>:erc20:<Vertrag>:<von>:<an>:<Wert>:<n>` oder `<hash>:internal:<i>`; über Alchemy `<hash>:internal:trace:<Adresse>`;
- Gebühr: `<hash>:fee`.

**Hash und Explorer:**

- `txRef` ist der Hash genau so, wie die Chain ihn angibt: bei Cosmos Hex in Großbuchstaben, bei EVM `0x` + Hex in Kleinbuchstaben.
- Krypto-Einzahlungen und -Auszahlungen bei Kraken tragen den Hash auf der Chain als `chainTxRef` (aus DepositStatus und WithdrawStatus). Darüber paaren sie sich mit der Wallet-Buchung desselben Hashes, gleich welche Euro-Beträge.
- Verweigert Kraken diese Listen, weil dem Schlüssel _Funds → Query_ fehlt, schreibt die Bridge das ins Log. Die Kraken-Karte sagt es auch.
- Buchungen, die importiert wurden, bevor es das gab, bekommen den Hash erst, wenn ein Abruf sie wieder erreicht. Wähl dafür einen früheren Starttag.
- Jede Buchung behält ihren Link in den Block-Explorer (`explorerUrl`). _Zahlungen_ zeigt _Im Block-Explorer ansehen_ und die _Gegenadresse_.

**Uhrzeit:** Buchungen behalten die Uhrzeit, wo die Quelle sie liefert (`bookedAt`: Kraken, eigene Wallets, CAMT `DtTm`). Angezeigt wird sie in deutscher Zeit. Jede Seite eines Tauschs nennt die andere (_Tausch → 128 USDC_).

### Was ausgelassen wird

**Ausgelassen, und Belege sagt es:**

- Denoms und Token, die nicht in der Liste der Chain stehen. Dazu gehören IBC-Gutscheine `ibc/…`, Factory-Denoms und ein ERC-20 außer dem gelisteten USDC und, auf Ethereum und Base, ALEPH, das die Wallet nie angefasst hat: ein Airdrop, Spam. Ein Vertrag kann sich nämlich „USDC“ nennen, ohne es zu sein.
- Einträge ohne Kurs. NYX zum Beispiel hat bei CoinGecko und Kraken keinen. Sie werden beim nächsten Abruf erneut versucht.
- Die ältere Geschichte eines gekürzten Knotens. Der Abruf sagt, ab welchem Tag der Knoten die Chain kennt. Belege ermittelt das, indem es nach Block 1 fragt. Ein Knoten, der aus einem Snapshot gestartet wurde, meldet in `/status` nämlich 0. Trag dann einen Archivknoten ein.

**Gar nicht gesehen:**

- Tokens, die nach dem Ende eines Unbondings zurückkommen. Das macht die Chain ohne Transaktion.
- Vesting.
- Bei Rollups (Base, Optimism, Arbitrum) die L1-Datengebühr. Die Etherscan-kompatible API von Blockscout meldet sie nicht.

Der Bestand zeigt die Wahrheit. Gehen die gebuchten Mengen nicht darin auf, sagt die Wallet-Karte das (_Gebucht …, Bestand …_). Dann schaut sich ein Mensch das an.

### Staub und ähnlich aussehende Adressen

Ein Eingang, der zum Tageskurs weniger als einen Cent wert ist, ist Staub. Er braucht keinen Beleg (`crypto-dust`, Abzeichen _Staub_). Sein Betrag steht als `< 0,01 EUR` da statt als `0,00 EUR`.

So arbeitet Adressvergiftung: Jemand erzeugt eine Adresse, die so beginnt und endet wie eine, die du nutzt. Von ihr schickt er einen winzigen Betrag. Dann steht sie in der Historie neben der echten. Beim nächsten Senden kopiert man vielleicht die falsche.

Belege warnt davor. Teilt die Absenderadresse die ersten und letzten vier Zeichen mit einer anderen Adresse, nennt die Buchung diese Adresse und zeigt eine Warnung. Gezählt wird nach `0x` bzw. nach dem Bech32-Präfix. Verglichen wird mit deinen eigenen Wallets und mit der Gegenseite jeder Wallet-Buchung, die kein Staub ist (`matching/dust.js`). Zwei fremde Adressen teilen diese Zeichen etwa einmal in vier Milliarden.

### Was der Knoten sieht

Der Knoten sieht die Adresse und die IP-Adresse des Macs. Das passiert nur bei _Synchronisieren_. Der Einwilligungsbildschirm nennt es unter _Blockchain-Abfrage_.

Alchemy ordnet die Abfragen zudem dem Alchemy-Konto zu, dessen Schlüssel es ist. Fragt die Bridge Alchemy nach einem Uniswap-Pool, sieht Alchemy den Token-Vertrag und den Block.

Das Protokoll der Bridge nennt Zahlen, nie eine Adresse oder einen Betrag.

### Tausch über eine DEX (Issue #115)

Eine DEX ist eine Tauschbörse, die als Programm auf der Chain läuft. Ein Router ist der Vertrag, über den ein Tausch dort läuft.

Ein Tausch sieht so aus: In einer Transaktion gibt eine eigene EVM-Wallet ein Asset und bekommt ein anderes. Zum Beispiel geht ein Token an einen Router, und ETH kommt als interne Transaktion zurück.

- Die gebuchten Seiten werden _Tausch_ (Bewegung `trade`, Art `crypto-swap`). Die Transaktion im Block-Explorer ist ihr Beleg.
- Der Verwendungszweck nennt beide Seiten und den Router. Beispiel: „Tausch: 30.000 XYZ (nicht gelistet) → 0,143 ETH über MetaMask Swap (Router) · Gas 0,00018 ETH“.
- Die Gasgebühr bleibt eine eigene Buchung (Netzwerkgebühr, kein Beleg). Sie nennt den Tausch, für den sie bezahlt wurde.
- Zwei gebuchte Seiten gehören über den Hash als _Tausch_ zusammen.
- Bekannte Router und WETH werden benannt (`KNOWN_EVM_CONTRACTS` in `packages/chains/src/registry.js`). Andere Verträge bleiben „Vertrag“.

**Ein Token, der nicht in der Liste der Chain steht:**

- Er wird mit seiner eigenen Angabe benannt und markiert.
- Er wird **auf einem eigenen Konto gebucht**, sobald die Wallet ihn selbst gesendet hat oder der Aufrufer seinen Vertrag nennt. Ein nur empfangener Token (ein Airdrop) wird nicht gebucht.
- Bewertet wird er über seinen **Vertrag** bei CoinGecko, sonst über seinen Uniswap-Pool (siehe [Der Kurs eines Tages](#der-kurs-eines-tages)). Nie über das Symbol, das er sich gibt.
- Unter dem Symbol eines gelisteten Assets (ETH, USDC, USDT, DAI, WBTC, …) oder eines schon gebuchten Tokens wird er nie gebucht.
- Sein Bestand wird mit den anderen gelesen (Alchemy `alchemy_getTokenBalances`, Blockscout `tokenbalance`).
- Der Monatsauszug gibt ihm einen eigenen Abschnitt mit der Überschrift „XYZ (laut Token-Vertrag)“, darunter sein Vertrag. Bewertet wird er über diesen Vertrag.
- Ohne Kurs wartet er als „ohne Kurs“. Beim nächsten Abruf wird er erneut versucht.

Steuerlich ist ein Tausch Veräußerung und Anschaffung zum Tageswert. Das klärst du mit dem Steuerberater.

### Über Chains hinweg

Wechseln Tokens die Chain, hat jede Seite eine eigene Transaktion mit eigenem Hash. Der gemeinsame Hash paart sie also nicht (Issue #98).

**IBC-Transfer:** Er nennt seinen Empfänger auf der anderen Chain. Belege sucht den Empfänger unter deinen Wallets auf dieser Chain, erkannt am Bech32-Präfix der Adresse. Ist er deiner, ist der Transfer eine eigene Umbuchung (1360). Die Tokens kommen dort meist als `ibc/…`-Gutschein an. Der wird nicht gebucht.

**Bridge zwischen eigenen EVM-Wallets:** Eine Bridge ist hier ein Dienst, der Tokens von einer Chain auf eine andere bringt. Belege paart die beiden Seiten nur, wenn alles davon zutrifft:

- Der Eingang ist eine interne Transaktion, kommt also vom Bridge-Vertrag.
- Der Ausgang liegt auf einer anderen Chain und betrifft dieselbe Kryptowährung.
- Der Eingang kommt 0 bis 8 Tage nach dem Ausgang. Eine Auszahlung von L2 nach L1 dauert 7 Tage.
- Die empfangene Menge ist höchstens die gesendete und mindestens 97 % davon.
- Jede Seite hat nur die andere als Partner.

Sonst bleibt es eine Rückfrage. _Keine Umbuchung_ hält ein Paar auseinander. Ein Paar erscheint unter _Gehört zusammen mit_ als _Umbuchung · über Bridge_.

**Von Hand:** Für alles, was die Regeln nicht finden. Beispiele: eine andere Bridge, ein nicht synchronisiertes Konto, die Auszahlung einer Börse aufs Bankkonto.

- In der Zahlung wählst du _Kein fremder Beleg … → Als Gegenbuchung verknüpfen …_.
- Belege listet Buchungen auf anderen Konten, in die andere Richtung, innerhalb eines Monats. Der nächste Betrag steht zuerst. Es gibt eine Suche.
- Das Paar liegt versiegelt in den Abgleich-Einstellungen (`ownTransfers`) und gilt bei jedem Lauf. Es wird eine eigene Umbuchung (1360), auf beiden Seiten steht _Umbuchung · von dir verknüpft_.
- _Verknüpfung lösen_ macht es rückgängig und hält das Paar künftig auseinander.

Eine Netzwerkgebühr teilt den Hash ihrer Buchung und erscheint als _Gebühr dazu_. Das erklärt die Gebühr. Es erklärt nicht, woher die Coins der Buchung kamen oder wohin sie gingen.

### Alchemy

Alchemy ist ein Anbieter, der Knoten für EVM-Chains betreibt. Mit einem Alchemy-API-Schlüssel liest die Bridge EVM-Wallets dort statt bei Blockscout.

**Einrichten:** mit `pnpm setup:alchemy`.

- Du gibst den Schlüssel verdeckt ein.
- Zur Prüfung fragt das Setup `eth_chainId` auf jedem Netz.
- Der Schlüssel liegt im Schlüsselbund, Dienst `belege-bridge`, Konto `alchemy`.
- Beim nächsten Aufruf behält Enter den Schlüssel, `-` löscht ihn.

**Wohin gefragt wird:** `https://<netz>.g.alchemy.com/v2/<schlüssel>`, mit den Netzen `eth-mainnet`, `base-mainnet`, `arb-mainnet`, `opt-mainnet` und `polygon-mainnet`.

**Wo der Schlüssel steht:**

- Die Bridge liest ihn bei jedem Abruf aus dem Schlüsselbund. Ein Neustart ist nicht nötig.
- Er steht nur in der Adresse der Anfragen an Alchemy. Er steht nie in einer Protokollzeile, einer Fehlermeldung, einer Antwort oder in der App.
- `GET /chains` sagt nur `alchemy: true` oder `false`.

Eine Wallet mit eigenem `api`-Endpunkt wird dort gelesen, nie über Alchemy. _Integrationen → Eigene Wallets_ sagt, welche Quelle gilt. Ohne Schlüssel sagt es, wie man einen einrichtet.

**Was gefragt wird.** Die Bridge fragt per JSON-RPC. Mehrere Aufrufe gehen als ein Batch hinaus, höchstens 50 auf einmal.

1. `eth_chainId`: Der Endpunkt muss die Chain bedienen. Sonst meldet die Bridge `WALLET_WRONG_CHAIN` und fragt nichts weiter.
2. `alchemy_getAssetTransfers`, einmal mit `fromAddress`, einmal mit `toAddress`. Beides in einem Aufruf hieße „von und an zugleich“. Die Parameter:
   - Kategorien `external`, `erc20` und `internal`. `internal` nur, wo Alchemy sie anbietet: Ethereum, Base, Polygon.
   - `withMetadata: true` für die Blockzeit, `excludeZeroValue: true`, `order: asc`, `maxCount: 0x3e8`.
   - Danach `pageKey` für die nächste Seite. Er gilt 10 Minuten.
3. Für jede Transaktion, in der eine Überweisung die Adresse als Absender nennt:
   - `eth_getTransactionByHash`: Wer schickte sie wirklich? Ein Token kann per `transferFrom` in der Transaktion eines anderen gehen. Die kostet uns kein Gas.
   - `eth_getTransactionReceipt`: das Gas (`gasUsed × effectiveGasPrice`) und `status`.
4. Transaktionen der Adresse, die nichts bewegten, stehen in keiner Überweisungsliste. Beispiele: eine fehlgeschlagene, eine Freigabe, ein Claim, der nur etwas hereinbrachte. Der Nonce zählt jede davon. So findet die Bridge sie:
   - Sie fragt `eth_blockNumber` und `eth_getTransactionCount` am Kopf der Chain.
   - Steigt der Zähler stärker, als die bekannten Transaktionen erklären, schneidet sie den Blockbereich in 16 Teile. An jedem Schnitt fragt sie den Zähler (ein Batch). Das wiederholt sie, bis einzelne Blöcke übrig sind.
   - `eth_getBlockByNumber` mit Transaktionen findet sie. `eth_getTransactionReceipt` liefert ihr Gas.
   - Höchstens 300 solche Blöcke je Abruf. Darüber meldet die Bridge `WALLET_TOO_MANY`.
5. Für Wert aus der Transaktion eines anderen: `eth_getTransactionReceipt` (im Batch). Eine zurückgesetzte Transaktion bucht nichts. Alchemy listete keine zurückgesetzten Transaktionen. Es sagt aber nicht, dass es das nie tut.
6. Eine Quittung ohne `status` stammt von vor Byzantium (Ethereum-Block 4 370 000, Oktober 2017). Sie sagt nicht, ob die Transaktion durchging. Blockscout weiß es aus seinen Traces. Über Alchemy gilt:
   - Das Gas wird gebucht, denn gezahlt ist es so oder so.
   - Der Wert wird nicht gebucht.
   - Das Ergebnis zählt solche Transaktionen (`unknownStatus`, im Protokoll der Bridge als _without a receipt status_).
   - Für so alte Geschichte rufst du über Blockscout ab (eigener `api`-Endpunkt).
7. `eth_getBalance` und `alchemy_getTokenBalances` für die gelisteten Verträge und die nicht gelisteten, die gebucht werden (100 Verträge je Aufruf). Nach einem nie angefassten Token wird nicht gefragt.

**Compute Units.** Alchemy berechnet jedem Aufruf Compute Units, im Batch jedem einzeln:

- `eth_chainId` 0,
- `eth_blockNumber` 10,
- `alchemy_getAssetTransfers` 120,
- die übrigen hier 20.

Eine kostenlose App bekommt 300 pro Sekunde, gemessen über einen Token-Bucket von zehn Sekunden (Alchemys Doku, _Compute unit costs_ und _Throughput_). Ein Batch mit 50 Quittungen kostet 1000 auf einmal. Darum gilt:

- Die Bridge verbraucht höchstens 250 pro Sekunde, bis zu vier Sekunden im Voraus.
- Vor einem Aufruf, der mehr verbrauchen würde, wartet sie.
- Ein Batch wird so geschnitten, dass er nie mehr kostet.
- Das Budget des Schlüssels teilt sich alles, was ihn nutzt. Was Alchemy trotzdem mit 429 ablehnt, geht erneut hinaus. Nur die abgelehnten Aufrufe gehen neu, nach 1, 2, 4, 8, 16 und 16 Sekunden. Danach meldet die Bridge `WALLET_ALCHEMY_RATE_LIMIT`.

Eine Wallet mit vielen Transaktionen braucht darum etwas Zeit: etwa eine Sekunde je sechs gesendete Transaktionen.

Symbole und Nachkommastellen kommen aus der Liste der Bridge. Sie kommen nie aus Alchemys `asset` oder `rawContract.decimal`, denn das sagt der Token über sich selbst.

**Kennungen, und ein Wechsel der Quelle.** Wechselst du zwischen Blockscout und Alchemy, soll nichts doppelt gebucht werden.

- Alchemys Antworten werden in die Listen von Blockscout umgeformt. Derselbe Code macht dann Einträge daraus.
- Darum bekommen Wert (`<hash>:value`), Gas (`<hash>:fee`) und Token-Überweisung auf beiden Wegen dieselbe Kennung. Die Kennung einer Token-Überweisung ist `<hash>:erc20:<Vertrag>:<von>:<an>:<Wert>:<n>`. Blockscouts `tokentx` nennt keinen Log-Index, also nutzt keine Seite den von Alchemy.
- Eine Wallet erst über Blockscout und dann über Alchemy abgerufen, oder umgekehrt, bucht also nichts doppelt. Geprüft an einer ausgedachten Chain, gelesen über beide Fakes.

Bei einer internen Überweisung geht das nicht:

- Blockscout zählt sie nach ihrer Stelle unter allen Aufrufen der Transaktion (`index`).
- Alchemy zählt sie nach ihrer Trace-Adresse unter denen, die Wert bewegten (`uniqueId` `<hash>:internal:<trace>`).
- Keins lässt sich aus dem anderen berechnen.

Alchemys interne Überweisung bekommt deshalb eine eigene Kennung, `<hash>:internal:trace:<trace>`. Sie gleicht nie einer von Blockscout. Die App paart dann einen eingehenden Eintrag, dessen Kennung nicht gespeichert ist, mit einer gespeicherten Buchung. Diese muss passen in Transaktion, Art (Gas, Wert, Token, intern), Menge und Gegenadresse, und kein eingehender Eintrag darf sie schon nennen. Jede gespeicherte Buchung wird nur einmal gepaart. Die App behält die gespeicherte Kennung (`reconcileSourceIds` in `app/src/lib/wallets/wallet-sync.js`).

**Fehler:**

- 401 → `WALLET_ALCHEMY_AUTH`. Führ `pnpm setup:alchemy` erneut aus.
- 403 → `WALLET_ALCHEMY_DENIED`. Mögliche Gründe: Das Netz ist in der Alchemy-App nicht freigeschaltet, das Kontingent ist aufgebraucht, oder die App ist inaktiv. Die Meldung zitiert Alchemy, ohne Links.
- HTTP 429, oder ein Eintrag mit Fehlercode 429 im Batch (ein Batch antwortet immer mit 200): Die Bridge wiederholt bis zu sechsmal, wie oben beschrieben. Danach meldet sie 429 `WALLET_ALCHEMY_RATE_LIMIT`.
- Jede andere Ablehnung → `WALLET_ALCHEMY` mit Alchemys Code.

**Lücken:**

- Auf Arbitrum und Optimism hat Alchemy keine Kategorie `internal`. Dort liest die Bridge `txlistinternal` weiter bei Blockscout, mit dessen `eth_chainId`-Prüfung. Das sind zwei Anfragen je Abruf statt sechs oder mehr.
- Die L1-Datengebühr der Rollups fehlt weiterhin. Die Quittungen von Base und Optimism nennen sie (`l1Fee`). Sie zu nehmen, würde aber den Betrag von Gebühren ändern, die schon über Blockscout gebucht sind. Das kommt in einem späteren Schritt.
- Manchmal zeigt der Nonce eine Transaktion, deren Block aber keine Transaktion der Adresse enthält. Das passiert bei einer Smart-Contract-Wallet, deren Nonce Vertragserzeugungen zählt. So eine Transaktion wird übergangen.

**Geprüft am 26.09.2026 an Alchemys Dokumentation:** die fünf Endpunkt-Hosts, die Parameter, die Kategorien, die Netze mit `internal`, die Seitengröße 1000, die Batch-Grenze und die Fehlerformen. Die Fehlerformen sind: 401 `-32600` _Must be authenticated!_, 403, 429 mit Code 429, `-32601` _Unsupported method_, `-32602` _invalid … argument_. Außerdem geprüft: Jeder Host antwortet, und ein ausgedachter Schlüssel bekommt genau diese 401-Antwort.

**Durch echte Aufrufe geprüft**, auf Ethereum Mainnet, mit echtem Schlüssel, nur für eine öffentliche Burn-Adresse:

- `alchemy_getAssetTransfers` samt zweiter Seite per `pageKey`;
- `rawContract.value` und `blockNum` als Hex, `metadata.blockTimestamp` als ISO;
- `uniqueId` als `<hash>:external`, `<hash>:log:<n>` und `<hash>:internal:<trace>` mit Unterstrichen (`3_0`, `0_3_0`; 2000 Kennungen, alle verschieden);
- Quittungen und Transaktionen in Hex;
- ein Batch, als Array beantwortet;
- `eth_getTransactionCount` an einem alten Block;
- `alchemy_getTokenBalances` mit auf 66 Zeichen aufgefüllten Beständen.

Das Fake für die Tests (`bridge/test/support/fake-alchemy.js`) antwortet in diesen Formen. Es ist so streng wie die dokumentierte API bei Methodennamen, Anzahl und Typen der Parameter. Ein String `"true"` statt eines Booleans wird zum Beispiel abgelehnt.

**Nicht gesehen:** eine zurückgesetzte Transaktion in den Überweisungslisten (etwa 400 angesehen) und eine Quittung von vor Byzantium über Alchemy. Beides ist oben trotzdem behandelt.

### Bitcoin

Eine Bitcoin-Wallet verteilt ihr Guthaben auf viele Adressen und schickt Wechselgeld an neue. Belege liest sie darum nicht über eine einzelne Adresse. Es liest sie über den **erweiterten öffentlichen Schlüssel** des Kontos. Aus ihm lassen sich alle Adressen ableiten, aber nichts ausgeben.

Belege nimmt:

- einen **zpub** (native SegWit, Adressen `bc1q…`),
- einen **ypub** (Adressen `3…`),
- einen **xpub**. Wallets geben einen xpub für mehr als eine Adressart heraus. Darum fragt `pnpm setup:bitcoin` bei einem xpub nach der Art: `bc1q…` oder `1…`.

**Der Schlüssel bleibt in der Bridge.**

- `pnpm setup:bitcoin` legt ihn in den Schlüsselbund bzw. die Windows-Anmeldeinformationsverwaltung (Konto `bitcoin`, JSON `{ key, type }`). `BITCOIN_XPUB` aus der `.env` wird einmal angeboten.
- Die App kennt die Wallet nur über einen Fingerabdruck des Schlüssels (`btc-` + 8 Hex-Zeichen). Du übernimmst ihn unter _Integrationen → Eigene Wallets → Bitcoin → Schlüssel aus der Bridge übernehmen_.
- Bei jedem Abruf prüft die Bridge den Fingerabdruck. So bucht ein ausgetauschter Schlüssel nicht auf das alte Konto (`WALLET_KEY_CHANGED`).

**Adressen:** Die Bridge leitet sie selbst ab, `/0/i` für den Empfang und `/1/i` für Wechselgeld. Sie hört auf, wenn 20 in Folge unbenutzt sind. Jede Adresse fragt sie bei einer Esplora-API ab:

- voreingestellt `mempool.space/api`,
- als Alternative `blockstream.info/api`,
- oder eine eigene.

Diese API sieht all diese Adressen von derselben IP. Sie kann daraus schließen, dass sie zusammengehören. Der Einwilligungsbildschirm nennt das unter _Blockchain-Abfrage_. Eine eigene Esplora vermeidet es.

**Buchungen:** aus Sicht der ganzen Wallet (alle ihre Adressen zusammen), nur bestätigte Transaktionen.

- **Alle Inputs von uns:** gesendet. Die Gebühr ist eine eigene Buchung (`<txid>:fee`). Der Rest ging an andere (`<txid>:value`). Wechselgeld an eigene Adressen ist keine Buchung. Eine Transaktion nur zwischen eigenen Adressen ist nur ihre Gebühr.
- **Kein Input von uns:** empfangen, was an unsere Adressen ging.
- **Einige Inputs von uns** (Payjoin, Coinjoin): eine Buchung mit der Nettoänderung, Gebühr eingeschlossen, und ein Hinweis.

`txRef` ist die txid. Eine Kraken-BTC-Ein- oder -Auszahlung trägt dieselbe txid als `chainTxRef`. Beide werden als eigene Umbuchung gepaart.

Es gibt ein Konto, _Wallet BTC ···<Fingerabdruck>_. Sein Bestand ist der bestätigte Bestand aus der Esplora-API.

### Filecoin

**Anlegen:** Eine eigene Filecoin-Wallet legst du mit ihrer Adresse an. Möglich sind:

- f1 (secp256k1),
- f3 (BLS),
- f410f (delegiert). Du kannst sie auch in der Ethereum-Form `0x…` eingeben. Das ist dasselbe Konto, gespeichert wird es als f410f.
- f0 (eine ID).

f1-, f3- und f410f-Adressen prüft Belege vor der ersten Abfrage an ihrer blake2b-Prüfsumme.

**Abruf:** Die Bridge liest die Wallet über die öffentliche API von Filfox, ohne Schlüssel (`packages/chains/src/filecoin.js`):

- `address/<a>` für den Bestand,
- `address/<a>/transfers` für jede Bewegung, 100 je Seite.

**Buchungen:**

- Je Nachricht wird jedes Senden und jedes Empfangen eine Buchung, mit der Adresse der Gegenseite.
- Miner-Gebühr und Burn-Gebühr ergeben zusammen eine Gebührenbuchung.
- Die Nachrichten-CID (`bafy2bzace…`) ist der Hash. Kraken meldet für eine Einzahlung denselben. So finden sich eine Auszahlung aus der Wallet und die Einzahlung bei Kraken als eigene Umbuchung. Das Detail der Einzahlung nennt dann Filecoin.

Filfox sieht die Adresse und die IP-Adresse dieses Macs. Eine Adresse mit mehr als 20 000 Bewegungen lehnt die Bridge als zu groß ab.

**Token auf der FEVM (Issue #301).** Die FEVM ist der Teil von Filecoin, auf dem Ethereum-artige Verträge laufen.

- Hat die Adresse Token-Überweisungen, liest die Bridge auch `address/<a>/token-transfers`.
- Gebucht werden nur gelistete Token, erkannt am Vertrag. Bisher ist das **USDFC** (`0x80b98d3aa09ffff255c3ba4a241111ff1262f045`), der mit FIL besicherte Stablecoin von Secured Finance. Geprüft gegen die Vertragsliste von Secured Finance, CoinGecko und den Vertrag selbst.
- Ein Token, der sich USDFC nennt, aber von einem anderen Vertrag stammt, wird gezählt, nie gebucht.
- Der Bestand eines Tokens ist die Summe seiner ganzen Geschichte.

**Tausch.** Gibt die Wallet in einer Nachricht ein Asset ab und erhält ein anderes, ist das ein **Tausch**, wie auf den EVM-Chains. Beispiele: FIL gegen USDFC, oder USDFC gegen FIL (die FIL kommen in derselben Nachricht zurück).

- Beide Seiten werden als _Tausch_ gebucht und brauchen keinen Beleg.
- Das Gas bleibt eine eigene Gebühr und nennt den Tausch.
- Der Router wird nach dem Empfänger der Nachricht benannt (`message/<cid>`, nur bei einem Tausch gefragt). Das geht, wo er aus Sushis eigener Konfiguration bekannt ist: _SushiSwap_ (der Router der Sushi-App), _SushiSwap V2 (Router)_, _WFIL_.
- Der Euro-Kurs von USDFC kommt von CoinGecko (`usdfc`), sonst aus der anderen Seite des Tauschs. Er wird nie pauschal mit 1 USD ohne Quelle angesetzt.
- Im crypto-ledger-Export heißt USDFC `eip155:314/erc20:0x80b9…f045`.

### Einzahlung in Filecoin Pay

USDFC, die eine Wallet an den Vertrag Filecoin Pay sendet, gehen auf das eigene Guthaben des Zahlers in diesem Vertrag. Filecoin Pay gehört zur Filecoin Onchain Cloud; die Mainnet-Adresse ist `0x23b1e018F08BB982348b15a86ee926eEBf7F4DAa` (`f410feoy…l36cyi`) und stammt aus den veröffentlichten Adressen von `@filoz/synapse-core`.

Das Geld bleibt beim Zahler und lässt sich wieder auszahlen, bis daraus Speicher abgerechnet wird. Belege erkennt den Vertrag an seiner Adresse (`app/src/lib/wallets/known-contracts.js`), nennt die Zahlung „Filecoin Pay“ und bucht sie als eigene Umbuchung, ohne Beleg. Das Konto dafür ist eine Einstellung: Einstellungen → Buchhaltung, „Konto für Guthaben in Zahlungsverträgen“. Voreingestellt ist 1360. Dasselbe gilt für Geld, das von dort zurückkommt.

Was der Vertrag aus dem Guthaben an Speicheranbieter zahlt, ist keine Bewegung der Wallet. Dieser Aufwand hat einen eigenen Nachweis, siehe unten.

Hast du die Adresse unter „Was war diese Zahlung?“ selbst benannt, gilt deine Angabe.

### Verbrauchsnachweis für Filecoin Pay

Für Speicher in der Filecoin Onchain Cloud stellt niemand eine Rechnung aus. Der Vertrag rechnet aus deinem Guthaben von Zeit zu Zeit mit den Speicheranbietern ab. Eine solche Abrechnung heißt Settlement, der Zahlungsweg zu einem Anbieter heißt Rail.

**Wo:** Integrationen → Eigene Wallets, Reiter _Nachweise_, Karte „Filecoin Pay“. Die Karte erscheint, sobald die Bücher eine Filecoin-Wallet mit einer Adresse der Form `f410f…` führen. Nur für eine solche Adresse kann ein Vertrag ein Guthaben führen.

**Ablauf:**

1. „Filecoin-Wallets prüfen“ fragt für jede dieser Wallets, ob sie ein Guthaben oder Rails in Filecoin Pay hat. Vorher wird nichts gefragt.
2. „Monat anzeigen“ zeigt Anfangsbestand, Einzahlungen, Auszahlungen, Abrechnungen und Endbestand. Jede Abrechnung steht mit Rail, Anbieter, dem Tag, bis zu dem sie bezahlt, der Menge in USDFC und dem Euro-Wert da.
3. „Verbrauchsnachweis erstellen“ macht daraus einen Eigenbeleg als PDF. Er enthält zusätzlich die Aufteilung jeder Abrechnung (Anbieter, Provision, Netzwerkgebühr) mit ihrer Transaktion, die Rails mit den Adressen der Anbieter, die Quelle und die Grenzen.

Der Eigenbeleg bekommt eine Nummer aus dem eigenen Nummernkreis (`EB-JJJJ-NNN`). Je Zahler und Monat gibt es ihn einmal. Er wird keiner Buchung zugeordnet, denn der Aufwand steht in keiner Wallet. Die Zahlen bleiben am Beleg (`selfReceipt.filecoinPay`, Art `filecoin-pay-statement`).

**Woher die Daten kommen:** Die Bridge liest sie (`filecoinpay.statement`, `@le-space/chains/filecoin-pay`), nur lesend:

- Abrechnungen und Bestand vom Index der Filecoin-Pay-Macher, einem öffentlichen Subgraph bei `api.goldsky.com`.
- Ein- und Auszahlungen aus den Ereignissen des Vertrags bei Blockscout (`filecoin.blockscout.com`).
- Antwortet der Index nicht, kommt alles aus den Ereignissen bei Blockscout.
- Antwortet Blockscout nicht, kommen Ein- und Auszahlungen aus den Token-Überweisungen bei Filfox. Dann fehlt, was eine andere Adresse auf das Guthaben eingezahlt hat. Der Nachweis sagt das.

Jeder dieser Dienste sieht die Adresse des Zahlers und die IP-Adresse der Bridge.

**Blockscout-Schlüssel (optional):** Ohne Schlüssel beantwortet Blockscout etwa zehn Abfragen und dann minutenlang keine. Mit einem kostenlosen Schlüssel von dev.blockscout.com fragt die Bridge `api.blockscout.com`. Eingerichtet wird er im Terminal mit `pnpm setup:blockscout`:

- Die Eingabe ist verdeckt. Enter behält einen gespeicherten Schlüssel, `-` löscht ihn.
- Ein Testaufruf prüft den Schlüssel. Einen abgelehnten Schlüssel speichert die Bridge nicht.
- Der Schlüssel liegt im macOS-Schlüsselbund (Dienst `belege-bridge`, Konto `blockscout`). Er steht nur im `authorization`-Kopf der Anfragen an `api.blockscout.com`, in keiner URL, nie im Protokoll und nie in der App.

**Grenzen:**

- Gelesen wird nur USDFC.
- Eine Abrechnung bezahlt eine Rail bis zu dem Zeitpunkt, den sie nennt. Sie passiert, wenn jemand sie anstößt. Die Abrechnungen eines Monats decken darum nicht genau diesen Monat. Was seit der letzten Abrechnung aufgelaufen ist, steht nicht im Nachweis.
- Was ein Zahler selbst über Rails einnimmt, wird nicht gelesen. Seine Bestände wären um diesen Betrag falsch.

### NEAR

**Anlegen:** Ein eigenes NEAR-Konto legst du mit seinem Kontonamen an: ein benanntes (`name.near`) oder ein implizites (64 Hex-Zeichen). Belege hält ihn in Kleinbuchstaben.

**Abrufen:** Die Bridge liest ohne Schlüssel (`packages/chains/src/near-wallet.js`, auf dem Leser aus Eigenbeleg, `near.js`):

- **NearBlocks** (`api.nearblocks.io`, v3): `accounts/<Konto>/txns` für die Transaktionen, die das Konto signiert oder empfangen hat, und `accounts/<Konto>/ft-txns` für seine Token-Bewegungen (NEP-141). Je Seite 25, die ganze Geschichte. Mehr als 5 000 von einer Sorte lehnt die Bridge ab (`WALLET_TOO_LARGE`).
- **Ein Archivknoten** (`archival-rpc.mainnet.fastnear.com`): `view_account` für den Bestand jetzt (frei plus bei einem Validator gesperrt), `ft_balance_of` für einen gelisteten Token und `EXPERIMENTAL_tx_status` für das, was eine Speicher-Einlage behielt.

Beide sehen den Kontonamen und die IP-Adresse dieses Macs. Für beide kannst du eigene Endpunkte eintragen (`api`, `rpc`).

**Buchungen:** Je Transaktion wird das bewegte NEAR als Ausgang oder Eingang mit dem anderen Konto gebucht. Das Gas einer Transaktion, die das Konto signiert hat, ist eine eigene Gebühr (`<hash>:fee`). Eine gescheiterte Transaktion kostet nur ihre Gebühr. Das eine yoctoNEAR, das eine Token-Überweisung (oder das Zurücktauschen von wNEAR) mitschickt, ist keine Zahlung, verlässt das Konto aber und bleibt beim Token-Vertrag: eine eigene Netzwerkgebühr unter `<hash>:deposit` („Sicherheitsdeposit des Token-Transfers“), damit die Buchungen bis aufs letzte yoctoNEAR mit dem Saldo übereinstimmen (#1028); eine gescheiterte Überweisung gibt es zurück und bucht keins. Von einer Speicher-Einlage wird nur gebucht, was der Vertrag behielt. Eine Speicher-Einlage (Storage-Deposit), die das Konto höchstens fünf Minuten vor einem Tausch an einen Vertrag schickte, den der Tausch berührt (ein gegebener oder erhaltener Token, wNEAR zählt als NEAR, oder die DEX, die ihn ausführte), gehört zu diesem Tausch (#968): Sie ist eine Gebühr des Tauschs wie sein Gas, samt dem Gas ihrer eigenen Transaktion, und steht unter dem Tausch (`partOf`); der Text des Tauschs nennt, was solche Einlagen behielten. Eine Rückforderung (`storage_withdraw`, `storage_unregister`) gehört nie dazu. Wofür eine Einlage sonst war, liest Belege ebenfalls aus der Chain: Die Argumente ihres Aufrufs (`account_id`, `registration_only`, die Token-Liste einer DEX) kommen mit der Antwort der RPC, die ohnehin sagt, was der Vertrag behielt – keine zusätzliche Anfrage. Registriert eine Einlage ein anderes Konto bei einem Token und geht innerhalb von fünf Minuten genau an dieses Konto eine Überweisung dieses Tokens, ist sie eine Kostenposition dieser Überweisung (`enables`). Registriert sie das eigene Konto, bevor es den Token innerhalb eines Tages zum ersten Mal empfängt, ist sie eine Kostenposition dieses Eingangs. Geht sie an einen Token, den die Seiten eines Tauschs nicht nennen, und führt die Route eines Tauschs bis zu fünf Minuten später über genau diesen Token (bei einem Aggregator; gelesen aus den Receipts des Tauschs, eine RPC-Anfrage je solchem Tausch), gehört sie zu diesem Tausch. Jede davon ist eine Netzwerkgebühr, steht bei dem, wofür sie war, braucht keinen eigenen Beleg und nimmt das Gas ihrer Transaktion mit; eine Einlage für eine Überweisung bekommt das Konto des Gases der Überweisung. Alles andere ist eine eigenständige Speicher-Einlage: ebenfalls eine Netzwerkgebühr, „Kein Beleg nötig“ mit festem Grund – NEAR, das ein Vertrag für den Speicher eines Kontos einbehält, ist keine Zahlung für eine Leistung. Hat ein früherer Sync eine solche Einlage schon gebucht (bisher als Zahlung, die auf ihren Beleg wartet), ändert der nächste diese Buchung, statt eine zweite anzulegen. Die Regeln stehen in `packages/chains/src/near-storage.js`.

**Hash:** Der Hash ist der der Transaktion (base58) – derselbe, den Kraken für eine Auszahlung nennt. So finden eine Auszahlung bei Kraken und der Eingang auf dem Konto als eigene Umbuchung zusammen, und das Detail der Auszahlung nennt NEAR und verlinkt NearBlocks.

**Gebucht werden** NEAR und **USDC** nach Circles eigenem Vertrag (`17208628…36133a1`). Gewickeltes NEAR (wNEAR, der Token von `wrap.near`) wird als das NEAR gebucht, das es ist: Wickeln und Entwickeln sind Bewegungen innerhalb der Wallet und hinterlassen nur ihr Gas, der Bestand ist das NEAR des Kontos plus sein wNEAR, und wNEAR, das an eine DEX geht, die USDC auszahlt, ist ein Tausch von NEAR gegen USDC, benannt nach der DEX. Jeder andere Token – das gebrückte USDC.e, USDT und alles Verschenkte – wird gezählt und ausgelassen: Das Symbol eines Tokens ist seine eigene Behauptung. Im Krypto-Ledger-Export ist NEAR `near:mainnet/slip44:397`, USDC `near:mainnet/nep141:<Vertrag>`.

**Noch nicht gelesen:** NEAR, das in den inneren Quittungen einer fremden Transaktion ankommt, etwa die Auszahlung eines Staking-Pools. Der Bestand kommt vom Archivknoten, nicht aus den Buchungen; so eine Lücke zeigt sich als Differenz.

**Grenzen:** NearBlocks begrenzt Abfragen ohne Schlüssel. Der Leser wartet dann und fragt erneut (bis etwa eine halbe Minute je Abfrage). Ein NearBlocks-Schlüssel im Schlüsselbund der Bridge ist noch nicht gebaut.

### Monero

Monero verbirgt Beträge, Absender und Empfänger auf seiner Chain. Über eine Adresse lässt sich nichts lesen. Belege importiert stattdessen den Verlauf, den deine Wallet exportiert. Es liest ihn nur im Browser. Weder ein View-Key noch die Datei verlassen den Rechner.

1. Unter _Integrationen → Eigene Wallets_ legst du eine Wallet an: Chain Monero, dazu deine Hauptadresse (`4…`) oder eine Subadresse (`8…`). Die Adresse benennt nur das Konto.
2. Exportier den Verlauf aus der Wallet:
   - **Monero GUI:** _Verlauf_ → _Exportieren_ (CSV);
   - **CLI:** `export_transfers all output=monero.csv`.
3. „Verlauf importieren (CSV)“ an der Wallet liest die Datei:
   - Nur bestätigte Umsätze zählen: Eingang, Ausgang, ein geminter Block. Pool, ausstehende und fehlgeschlagene Umsätze bleiben draußen.
   - Jeder Umsatz wird zum Tageskurs bewertet (CoinGecko, `monero`).
   - Die Gebühr eines Ausgangs wird eigens gebucht, wie bei jeder Wallet. Die Gebühr eines Eingangs hat der Absender bezahlt.

Dieselbe oder eine längere Datei noch einmal zu importieren, fügt nur Neues hinzu.

**Bestände:** Gemeint sind der Bestand des Kontos und seine Bestände an Anfang und Ende jedes Monats.

- Beim CLI-Export ist es der laufende Kontostand der Wallet selbst. Diese Zahl hat die Wallet errechnet. Der Kontoauszug stimmt gegen sie ab (#287).
- Der GUI-Export hat keinen laufenden Kontostand. Dort ist es, was die Datei ergibt.

Beide Formate sind aus dem Quellcode der Wallets übernommen (monero-gui `TransactionHistory::writeCSV`, monero `export_transfers`). Die Datumsspalte der GUI folgt der Sprache. Deshalb zählt ihre Spalte `epoch`. Die Zeitstempel der CLI sind UTC.

**XMR aus Privatbesitz** (eine Einlage) ist ein Eingang wie jeder andere. Einen fremden Beleg braucht sie nicht. Markier sie mit „Kein fremder Beleg … / Kein Beleg nötig“ samt Grund. Übernimm das Konto, das dein Steuerberater nennt. Ein Einzelunternehmen bucht auf 1890 Privateinlagen. Eine UG oder GmbH bucht gegen den Gesellschafter.

Eine **Kundenzahlung** in XMR wird wie eine Bankzahlung mit unserer Rechnung abgeglichen, zum Euro-Wert des Tages.

### Woher die Voreinstellungen kommen (geprüft am 26.09.2026)

Je Chain stehen hier die Chain-ID, die Form der Adresse, die Assets mit ihren Nachkommastellen, die voreingestellten Endpunkte und der Explorer.

**Nym (Nyx)**

- Chain-ID `nyx`, Adresse bech32 `n1…`.
- Assets: NYM `unym` (6), NYX `unyx` (6).
- Endpunkte: RPC `rpc.nymtech.net`, REST `api.nymtech.net` (von Nym). Archiv: `rpc.nyx.nodes.guru`, `api.nyx.nodes.guru`.
- Explorer: `nym.explorers.guru/transaction/{tx}`, `/account/{address}`.

**Akash**

- Chain-ID `akashnet-2`, Adresse bech32 `akash1…`.
- Asset: AKT `uakt` (6).
- Endpunkte: RPC `akash-rpc.publicnode.com`, REST `akash-rest.publicnode.com`. Alternativen: Polkachu, Ecostake.
- Explorer: `mintscan.io/akash/transactions/{tx}`, `/accounts/{address}`.

**Ethereum**

- Chain-ID 1, Adresse `0x` + 40 Hex-Zeichen. Bei gemischter Groß- und Kleinschreibung wird die Prüfsumme nach EIP-55 geprüft.
- Assets: ETH (18), USDC `0xA0b8…eB48` (6).
- Endpunkt: `eth.blockscout.com/api`.
- Explorer: `etherscan.io/tx/{tx}`, `/address/{address}`.

**Base**

- Chain-ID 8453, Adresse wie Ethereum.
- Assets: ETH (18), USDC `0x8335…2913` (6).
- Endpunkt: `base.blockscout.com/api`.
- Explorer: `basescan.org/tx/…`, `/address/…`.

**Arbitrum**

- Chain-ID 42161, Adresse wie Ethereum.
- Assets: ETH (18), USDC `0xaf88…5831` (6).
- Endpunkt: `arbitrum.blockscout.com/api`.
- Explorer: `arbiscan.io/tx/…`, `/address/…`.

**Optimism**

- Chain-ID 10, Adresse wie Ethereum.
- Assets: ETH (18), USDC `0x0b2C…Ff85` (6).
- Endpunkt: `explorer.optimism.io/api` (Blockscout).
- Explorer: `optimistic.etherscan.io/tx/…`, `/address/…`.

**Polygon**

- Chain-ID 137, Adresse wie Ethereum.
- Assets: POL (18), USDC `0x3c49…3359` (6).
- Endpunkt: `polygon.blockscout.com/api`.
- Explorer: `polygonscan.com/tx/…`, `/address/…`.

**Bitcoin**

- Mainnet, Adressen abgeleitet aus xpub, ypub oder zpub.
- Asset: BTC (8).
- Endpunkte: `mempool.space/api` (Esplora), Alternative `blockstream.info/api`.
- Explorer: `mempool.space/tx/{tx}`, `/address/{address}`.

Filecoin und Monero waren bei dieser Prüfung noch nicht dabei. Filecoin liest über `filfox.info/api/v1` und verlinkt auf Filfox. Monero hat keinen Endpunkt, sein Explorer ist xmrchain.net.

**An der Quelle geprüft:**

- Für Nyx und Akash: Chain-ID, Bech32-Präfix, Denoms, Exponenten, RPC/REST und Explorer-Muster, an der Cosmos Chain Registry (`nyx/`, `akash/`: `chain.json`, `assetlist.json`).
- Nyx' Knoten meldet Chain `nyx`, CometBFT 0.38 und cosmos-sdk 0.53. Ereignisse kommen also als Text, die Gebühr steht im `tx`-Ereignis.
- Die USDC-Verträge an Circles Liste der USDC-Vertragsadressen. Ihre 6 Nachkommastellen am Blockscout jeder Chain.
- ALEPH (der Token von Aleph Cloud, auf Ethereum und Base) am 2026-11-06 an CoinGeckos Plattformliste, am Blockscout von Ethereum und an `symbol()` und `decimals()` des Vertrags auf Base (18 Stellen).
- Die Blockscout-API antwortet auf jedem Host und meldet die Chain-IDs 1, 42161, 10 und 137. Der Host von Optimism ist nach `explorer.optimism.io` umgezogen.

**Durch Ausprobieren geprüft:**

- Nyms RPC beantwortet `tx_search` nach `transfer.sender` und `transfer.recipient` in deutlich unter einer Sekunde. Ein früheres Projekt fand hängende Absender-Abfragen. Das ließ sich nicht nachvollziehen.
- Nyms RPC ist **gekürzt**: Sein ältester Block ist von 2025. Der RPC von Nodes Guru reicht bis zum ersten Block.
- Akash, geprüft am 27.09.2026: Jeder öffentliche Knoten ist gekürzt. Der von PublicNode behält am meisten (ab 25.05.2026). Die von Polkachu und Ecostake behalten nur wenige Wochen. Polkachus `/status` meldet trotzdem 0.
- Blockscout verweigert Seite × Größe über 10 000.
- Blockscouts `tokentx` nennt keinen Log-Index. Die Kennung einer Token-Überweisung besteht darum aus Vertrag, Absender, Empfänger und Betrag. Sie ist stabil, aber kein Log-Index.

**Nicht geprüft:**

- die Chain-ID von Base über ihre API. Die API war damals ratenbegrenzt; 8453 ist die bekannte.
- dass die Explorer-Seiten wirklich etwas anzeigen. Es sind Single-Page-Apps, die auf alles mit 200 antworten.
- wie weit Polkachus Akash-Knoten zurückreicht.

## Aleph-Cloud-Credits (Issue #113)

Aleph stellt keine Rechnungen aus. Hosting und Speicher werden mit Credits bezahlt.

Unter _Integrationen → Aleph Cloud_ fragt die Bridge die öffentliche Aleph-API, nur lesend (`POST /aleph/accounts`, `packages/chains/src/aleph.js`). Gefragt werden:

- die eigenen EVM-Wallets, wenn „Eigene Ethereum-Adressen bei Aleph prüfen“ an ist,
- jedes eingetragene Aleph-Konto.

Für ein Konto und einen Monat erstellt „Verbrauchsnachweis erstellen“ einen Eigenbeleg (`app/src/lib/aleph/`). So entsteht er:

- **Bestände:** Der Anfangsbestand ist der heutige Bestand abzüglich der Netto-Summe aus `credit_history/summary` seit Monatsbeginn. Der Endbestand ist der heutige Bestand abzüglich der Netto-Summe seit Monatsende. Belege prüft Anfang + Zugänge − Abgänge = Ende und druckt die Rechnung mit.
- **Zeilen:** Aufladungen (Käufe mit Preis und Transaktion, Überträge herein), Überträge hinaus und der Verbrauch je UTC-Tag. Speicher ist eine Zeile, weil Aleph alle Stores zusammen abrechnet, mit Anzahl und Größe. Jede Instanz und jedes Programm bekommt eine eigene Zeile, benannt aus ihrer Nachricht.
- **Euro-Wert:** der USD-Preis je Credit des letzten Kaufs bis zu diesem Tag, mal EZB-Kurs des Tages. Ohne Kauf gilt Alephs Listenpreis, 1 USD je 1.000.000 Credits. Der Steuerberater muss diese Bewertung bestätigen.
- **Ablage:** als Beleg im EB-Nummernkreis, Quelle `eigenbeleg`, `sourceRef aleph:<Adresse>:<Monat>`. Er ist keiner Buchung zugeordnet. Die Zahlen bleiben am Beleg (`selfReceipt.aleph`), für eine spätere Rechnung über die Rechnungs-App.

Ein Monat ohne Bewegung ergibt keinen Nachweis. Geprüft am 27.09.2026 gegen zwei eigene Konten für zwei Monate: Die Bestände gingen auf den Credit genau auf.

**Die Zahlung hinter einem Kauf.** Zu jedem Kauf nennt Aleph die Transaktion, die ihn bezahlt hat. „Bei Aleph prüfen“ liest die Käufe jedes gefundenen Kontos. Dafür fragt es den Nachweis des laufenden Monats ab, der alle Käufe bis heute aufführt. Konto, Hash, Zeit und Credits liegen danach versiegelt in den Einstellungen. „Verbrauchsnachweis erstellen“ merkt sich die Käufe ebenso.

Eine Buchung, die mit diesem Hash die Bücher verlassen hat, erklärt Belege dann selbst als Kauf von Aleph-Credits. Das gilt für eine eigene Wallet und für die Auszahlung einer Börse mit ihrem On-Chain-Hash. Sie braucht keinen eigenen Beleg, weil der Verbrauchsnachweis des Kontos der Beleg ist. Als Konto schlägt Belege **4960** Mieten für Einrichtungen vor, oder das Konto aus _Einstellungen → Buchhaltung (DATEV)_; das klärst du mit der Steuerberatung. Übernimmst du bei so einer Zahlung ein anderes Konto, steht es ab dann in den Einstellungen. Die Netzwerkgebühr derselben Transaktion bleibt eine Gebühr. Eine ältere Bridge nennt nur die Käufe des abgefragten Monats.

## Im Export

Der Buchungstext einer Krypto-Buchung endet mit der Menge, zum Beispiel `Konto B -0,015 BTC`. DATEV erlaubt 60 Zeichen. Reichen die nicht, wird der Name gekürzt, nie die Menge. Der Umsatz steht wie bei jeder anderen Zeile in Euro.

Jede eigene Wallet kann drei Angaben haben. Du setzt sie beim Hinzufügen oder später unter _Bezeichnung, Konto, Kostenstelle_:

- **Bezeichnung** (Projekt, Zweck): Sie ersetzt das Adressende an allen Asset-Konten der Wallet, etwa `Projekt Nord · USDC (Ethereum)`.
- **Konto:** gilt für alle Asset-Konten der Wallet und geht in den DATEV-Export (_Konto_).
- **Kostenstelle:** ebenso, im DATEV-Export als _KOST1_.

Eine Wallet ohne Konto lässt die Konten ihrer Assets, wie sie sind.

## In der App

Die Detailansicht einer Zahlung zeigt **Menge** (`-0,015 BTC`) und **Kurs** (`60.000,00 EUR je BTC · CoinGecko, 01.09.2026 00:00 UTC`).

**Wer sendet, wer empfängt.** Eine Krypto-Buchung nennt immer beide Seiten, `Von … → An …`, in der Liste und im Detail. Jede Seite heißt nach dem ersten Punkt, der zutrifft:

1. eine eigene Wallet, mit ihrem Namen und markiert als _eigene_;
2. ein Partner, der unter dieser Adresse bekannt ist;
3. ein Modul, das der Abruf nennt (Staking, IBC, Gebührensammler);
4. sonst die Kurzadresse, markiert als _fremde Adresse_. Die volle Adresse erscheint beim Darüberfahren.

Ein IBC-Empfänger wird auf seiner eigenen Chain gesucht. Eine Netzwerkgebühr geht von der eigenen Wallet an _Netzwerk (Gebühr)_. Die Überschrift in der Liste ist der Name der Gegenseite, nie eine volle Hex-Adresse (`bank/payee.js`).

**Die Mail zu einer Krypto-Zahlung finden.** Bei einer Buchung einer eigenen Wallet sucht _Im privaten Postfach suchen_ nach dem, was die Bestätigung eines Anbieters nennt:

- den Hash,
- die Gegenadresse,
- die Menge, genau und auf zwei Stellen, mit Punkt und mit Komma,
- im Zeitraum ± 3 Tage,
- als Text den Anbieter, den Belege für diese Adresse gelernt hat, sonst das erste Wort des Memos.

Nicht gesucht wird der Euro-Betrag. Der ist unsere eigene Bewertung.

Ordnest du einer Wallet-Zahlung einen Beleg zu, lernt Belege deren Adresse. Sie steht dann als `addr:<Chain oder evm>:<Adresse>` unter den Aliasen des Partners. Die nächste Zahlung an dieselbe Adresse bekommt so die Punkte für diesen Anbieter, und die Suche nimmt seine Mail-Domains.

Ein Eingang mit Memo, den sonst nichts erklärt, sagt dir: Meist ist das deine eigene Auszahlung von einer Börse, mit dem Memo, das du dort eingetragen hast.

**Welche Belege eine Krypto-Zahlung bekommt.** Für eine Buchung einer eigenen Wallet kommt ein Beleg oder eine Mail nur in Frage, wenn er die Zahlung nennt. Das gilt bei den Vorschlägen, beim KI-Vorschlag und beim automatischen Abgleich. Gesucht wird in Betreff, Mailtext, ausgelesenem Text, Dateiname und Nummer, und zwar nach:

- dem Hash,
- der Gegenadresse,
- oder der Menge zusammen mit dem Asset-Kürzel, mit mindestens drei signifikanten Ziffern.

Das steht in `cryptoEvidence` in `matching/view.js`. Ein naher Euro-Betrag ist kein Zeichen, denn Krypto wird zum Tageskurs bewertet. Von Hand lässt sich jeder Beleg unter _Alle Belege_ zuordnen.

Ein Link in einer Mail wird vor dem Versand an das Sprachmodell auf seinen Host gekürzt (`[LINK host]`). Ein Hash, der nur in einem Explorer-Link steht, wird darum im Mailtext gefunden, nicht in einer PDF.
