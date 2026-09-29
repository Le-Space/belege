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

## Lieferantenkonten

Manche Anbieter passen nie eine Zahlung zu einem Beleg: Ein Prepaid-Tarif bucht Aufladungen, und seine monatlichen „Rechnungen“ sind Nachweise, wofür das Guthaben verbraucht wurde. _Lieferantenkonto ansehen_ (in einer Zahlung oder einem Beleg) legt Zahlungen und Belege des Anbieters auf eine Zeitleiste mit laufendem Saldo: Anfangsbestand + Aufladungen − Verbrauch. Es nennt, was nicht aufgeht:

- ein negativer Saldo;
- ein Monat ohne Nachweis;
- Aufladungen ganz ohne Nachweis;
- ein Januar-Nachweis, der womöglich das Vorjahr abrechnet.

_Als Guthabenkonto führen_ lässt die Nachweise die Aufladungen belegen: keine Rückfrage je Aufladung, und die Nachweise gelten als zugeordnet. Der Anfangsbestand je Jahr lässt sich eintragen ([`app/src/lib/matching/vendor-account.js`](../app/src/lib/matching/vendor-account.js)).
