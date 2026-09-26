# Where Belege uses AI

_Deutsch: [ai.de.md](ai.de.md)_

**Le Space runs no AI and sees none of your data.** Belege has no server. The bridge on your own computer calls the language model **you** configure (`pnpm setup:llm`): a public one such as DeepSeek (the default), or a local one on your machine such as Ollama or LM Studio. Any API in the OpenAI format (`/chat/completions`) works: over https, or over http only on `127.0.0.1`/`localhost`. Without a configured model, none of the steps below runs; everything else keeps working.

In the app, every button that calls the model carries the **✦** mark (`app/src/lib/AiMark.svelte`), and its hover says what goes out. The consent screen lists the same, in plain words and under _Technisch_ in detail.

## With AI

| Where                                                                                              | Triggered by                                                                                                                                    | What goes to the model                                                                                                                                                                         | What comes back                                                                                                                                                         |
| -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reading a receipt** (`bridge/src/llm/extract.js`)                                                | _Auslesen_, _Erneut auslesen_, _Alle neuen auslesen_, _Beleg hochladen und dieser Zahlung zuordnen_, _Als Beleg übernehmen_, _Rechnungen holen_ | the receipt's text layer (PDF) or the mail's text, with subject, sender and file name as hints, **redacted**; never the file                                                                   | vendor, VAT id, invoice and customer number, dates, net/VAT/gross, payment, travel; or `document_type: "none"` for a mail that is no receipt (sign-in link, newsletter) |
| **„Mit KI weitersuchen“** in the private mailbox (`bridge/src/llm/assist.js`, `POST /mail/assist`) | the button, shown only when the plain search found no clear hit                                                                                 | 1. the booking's counterparty and purpose, redacted → 2. per hit: subject, sender **domain**, attachment names, day received, redacted. **No mail text, no full address**                      | 1. up to 4 search words and 3 sender domains; 2. which hit is the receipt, how sure, and why in a few words                                                             |
| **„KI-Vorschlag“ under „Beleg zuordnen“** (`bridge/src/llm/match-assist.js`, `POST /match/assist`) | the button in the list of receipts to choose from                                                                                               | the booking's counterparty, purpose, amount and day, and up to 25 receipts nearest by amount and date as their read fields (vendor, amount, currency, date, invoice number, summary), redacted | which receipt fits, how sure, and why in a few words; linking stays the person's click                                                                                  |

_Alle neuen auslesen_ runs in the app, not on the page: it goes on when you open another page, the _Belege_ tab shows how far it is (`38/90`), a second start waits until it is done, and _Abbrechen_ stops it after the receipt being read. Locking the books or reloading the page stops it too; the receipts not yet read stay new. Every reading writes onto the receipt as it is at that moment: a change you made meanwhile stays, a receipt you deleted meanwhile stays deleted (`receipts/extract-queue.svelte.js`).

Before every call the bridge redacts (`bridge/src/llm/redact.js`): the names on your list, IBANs except the last four characters, e-mail addresses of your own domains, streets, postcodes with towns, and links (only the host stays). Answers are JSON and checked (net + VAT = gross, dates are dates, a pick is one of the candidates). An answer that does not check out is retried once with the second model, then discarded. What was sent is kept with the receipt (_An die KI gesendet_) or shown with the search (_Was an das Sprachmodell ging_). The Verlauf logs model, time and tokens of every call. The bridge's log has counts only.

## Without AI (fixed rules)

- **Matching** receipts to bookings: points for amount, invoice and customer number, IBAN, vendor name, a learned vendor alias and date (`app/src/lib/matching/score.js`). _Warum diese Zuordnung?_ explains every link.
- **Questions**, the grace period, and the **ranking of mailbox hits** (`hitScore` in `app/src/lib/matching/view.js`).
- **Own transfers, bank fees, loans** and your own rules (`app/src/lib/matching/classify.js`).
- **Learning** which counterparty is which vendor, from your links (`app/src/lib/matching/partners.js`).
- **Customer portals**: login, recording and replay of recipes (`bridge/src/portals/`). No screenshots or page content go to a model.

An AI result is never the last word: extracted values show on the receipt with the model, and a KI suggestion is taken only on your click.

## Regulation

The EU AI Act asks for transparency mainly for AI that interacts with people or generates content, and for high-risk uses. Reading receipts for your own bookkeeping is not, as far as we can tell, one of those. We disclose it anyway, and the GDPR needs you to know where data goes. This is no legal advice.
