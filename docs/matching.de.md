# Abgleich: Geschäftsjahre, Erstattungen, Lieferantenkonten

Wie Belege entscheidet, was über eine Zahlung und einen Beleg hinaus zusammengehört. Alle Funktionen: [features.de.md](features.de.md). [English](matching.md).

## Ein Jahr nach dem anderen

Der Schalter über jeder Seite (_Jahr_) zeigt ein Geschäftsjahr: seine Zahlungen, seine Rückfragen und die in ihm bezahlten Belege. Ein Beleg, der im Jahr bezahlt wurde, zählt dort, auch wenn er älter ist (eine Rechnung aus dem Dezember, bezahlt im Januar, markiert als _Beleg aus 2025_). Ein unbezahlter Beleg zählt in seinem eigenen Jahr und außerdem in einem Jahr, dessen Zahlung ihm angeboten wird. Der Abgleich selbst schaut über die Jahre hinweg. Ohne Wahl zeigt der Schalter das neueste Jahr mit einer Zahlung. Das Geschäftsjahr beginnt in dem Monat, der unter DATEV eingestellt ist ([`app/src/lib/year/year.js`](../app/src/lib/year/year.js)).

## Erstattungen

Eine Belastung und ihre Erstattung werden gepaart, wenn all das gilt:

- dieselbe Gegenseite, und die Erstattung nennt sie;
- ein Erstattungswort (_Rückerstattung, Gutschrift, Storno, Refund_, …);
- innerhalb von 120 Tagen;
- auf irgendeinem Konto, dieselbe Karte eingeschlossen;
- jede Seite hat nur die andere.

Eine volle Erstattung braucht auf keiner Seite einen Beleg; nach einer Teilerstattung braucht die Belastung weiter ihren. _Als Erstattung verknüpfen …_ in der Zahlung verknüpft ein Paar von Hand, _Keine Erstattung_ hält eines auseinander ([`app/src/lib/matching/refunds.js`](../app/src/lib/matching/refunds.js)).

## Ratenzahlungen (Issue #258)

Eine Rechnung kann in Teilen bezahlt werden: Ein Kunde zahlt unsere Rechnung über 10.000 € als 3.500 + 3.500 + 3.000, oder wir zahlen einen Lieferanten in Raten. Die Rechnung bleibt der Beleg für jeden Teil, und jede Zahlung wird mit ihr verknüpft.

- **Was offen ist,** ergibt sich allein aus den Verknüpfungen: Gesamtbetrag minus Summe der verknüpften Zahlungen. Löst man eine Rate, ist genau dieser Teil wieder offen.
- **In einer anderen Währung** (eine USD-Rechnung, aus Euro bezahlt – per Bank oder in Monero, in Euro bewertet): Eine Zahlung zählt mit dem Originalbetrag, wo die Bank ihn nennt, sonst mit ihrem Euro-Betrag zum EZB-Referenzkurs ihres Tages. Belege fragt die Bridge nach diesem Kurs, sobald eine Zahlung mit einer solchen Rechnung verknüpft ist, und hält ihn an der Buchung (`fx`), so dass „500,00 USD offen“ in der Währung der Rechnung gerechnet wird. Eine solche Zahl ist eine Schätzung (eine Karte schlägt ihre Marge auf, eine Krypto-Zahlung hat ihren eigenen Kurs): Eine Abweichung bis 5 % des Rechnungsbetrags gilt als bezahlt, nicht als offen oder überzahlt. Ohne Bridge oder ohne Kurs wird nichts gerechnet – Euro werden nie für Dollar gehalten – und die Rechnung gilt durch ihre Verknüpfungen als bezahlt.
- **Der Abgleich:**
  - eine teilweise bezahlte Rechnung bleibt im Spiel;
  - eine Zahlung unter dem offenen Betrag zählt als Rate (30 Punkte), wenn die Rechnung schon teilweise bezahlt ist oder der Verwendungszweck ihre Nummer nennt und es sagt („Teilzahlung“, „Rate“, „Anzahlung“, „Restzahlung“ …; das Wort allein ist zu häufig);
  - eine Zahlung genau in Höhe des offenen Betrags zählt als Rest („Restbetrag“, die Punkte für den Betrag);
  - ein spätes Datum spricht nicht gegen eine Rate;
  - eine bezahlte Rechnung nimmt keine weitere Zahlung von selbst.
- **Von Hand:** Unter „Beleg finden“ wird eine teilweise bezahlte Rechnung, die woanders verknüpft ist, wieder angeboten („teilweise bezahlt · … offen“), mit „Als weitere Teilzahlung zuordnen“; ihre anderen Verknüpfungen bleiben. Das normale Zuordnen verschiebt eine Rechnung weiterhin von einer anderen Zahlung.
- **Was man sieht:**
  - in der Zahlung „Teilzahlung 2 von 3 · 2025-017 · 3.000,00 € offen“, dann „bezahlt“ (oder „überzahlt um …“);
  - in Belege „teilweise bezahlt · 7.000 von 10.000 (2×)“, dann „in 3 Raten bezahlt“.
- **Export:** Jede Rate trägt die Nummer der Rechnung in Belegfeld 1, und ihre Datei kommt einmal ins Paket. Die gekoppelte Rechnungs-App erfährt jede Zahlung und erkennt „teilweise bezahlt“ selbst.

## Löhne, Lohnsteuer, Abgaben, Steuerzahlungen (Issue #233)

Diese Zahlungen bekommen keinen eigenen Beleg: Für einen Lohn ist der Lohnlauf der Beleg (Lohnabrechnung, Lohnjournal), für die Lohnsteuer die Lohnsteuer-Anmeldung, für Sozialabgaben der Beitragsnachweis, für eine Steuerzahlung die Voranmeldung oder der Bescheid. Belege erkennt sie und fragt nach keinem Beleg; „Warum?“ an der Zahlung nennt das Dokument, das für sie steht (`app/src/lib/matching/payroll.js`):

- **Steuerzahlungen:** Die Gegenpartei ist ein Finanzamt (Finanzamt, Finanzkasse, FK …) oder der Verwendungszweck trägt eine Steuernummer; die Steuer an ihrem Wort (LSt, USt, KSt, GewSt …); Gewerbesteuer an eine Stadt- oder Gemeindekasse. Der Zeitraum aus dem Verwendungszweck (`12/2025`, `IV/2025`, `2024/2025`).
- **Abgaben:** die Minijob-Zentrale, die Knappschaft, eine Krankenkasse, eine Berufsgenossenschaft.
- **Löhne:** eine ausgehende Zahlung an eine Person auf der Mitarbeiterliste (Einstellungen → Mitarbeiter) oder mit Lohn, Gehalt oder Minijob im Verwendungszweck.

Vorgeschlagenes Konto (SKR 03, mit dem Steuerberater zu prüfen): 1740 Löhne, 1741 Lohnsteuer, 1742 Abgaben, 1780 Umsatzsteuer-Vorauszahlungen (1790 für ein früheres Jahr), 2200 Körperschaftsteuer, 4320 Gewerbesteuer. Auf Home stehen Steuern ans Finanzamt in einer eigenen Zeile; Löhne, Lohnsteuer und Abgaben sind Ausgaben.

## Lieferantenkonten

Manche Anbieter passen nie eine Zahlung zu einem Beleg: Ein Prepaid-Tarif bucht Aufladungen, und seine monatlichen „Rechnungen“ sind Nachweise, wofür das Guthaben verbraucht wurde. _Lieferantenkonto ansehen_ (in einer Zahlung oder einem Beleg) legt Zahlungen und Belege des Anbieters auf eine Zeitleiste mit laufendem Saldo: Anfangsbestand + Aufladungen − Verbrauch. Es nennt, was nicht aufgeht:

- ein negativer Saldo;
- ein Monat ohne Nachweis;
- Aufladungen ganz ohne Nachweis;
- ein Januar-Nachweis, der womöglich das Vorjahr abrechnet.

_Als Guthabenkonto führen_ lässt die Nachweise die Aufladungen belegen: keine Rückfrage je Aufladung, und die Nachweise gelten als zugeordnet. Der Anfangsbestand je Jahr lässt sich eintragen ([`app/src/lib/matching/vendor-account.js`](../app/src/lib/matching/vendor-account.js)).
