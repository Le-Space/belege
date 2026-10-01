# Bank accounts: statement files, Hibiscus, Enable Banking

_Deutsch: [banking.de.md](banking.de.md)_

Payments come into Belege in three ways. Each one fills the same books, and an account is never doubled because it came a second way.

| Way                   | Needs                               | Banks                        | When it fetches        |
| --------------------- | ----------------------------------- | ---------------------------- | ---------------------- |
| Statement file (CAMT) | nothing: read in the browser        | any that exports CAMT.053    | when you upload a file |
| Hibiscus              | the bridge, Hibiscus/Jameica, FinTS | German banks with FinTS/HBCI | on "Synchronisieren"   |
| Enable Banking        | the bridge and your own application | banks in Europe (PSD2)       | on "Umsätze holen"     |

All three are under _Integrationen → Bank_.

## Statement files (CAMT.053)

Export the statement as CAMT.053 (XML) in your online banking and upload it under _Integrationen → Bank_. The file is read in the browser and never uploaded. The account is known by a hash of its IBAN. Where a statement names no IBAN (Wise, for example), Belege uses the bank's other account id instead. An account in another currency keeps its amounts and is valued at the day's rate, which the bridge has ([crypto.md](crypto.md) has the rates).

If a bank's statement names no IBAN, enter the account's IBAN under _Einstellungen → eigene IBANs_. Transfers between your own accounts are then recognised.

## Hibiscus

Hibiscus (in Jameica) fetches your German bank accounts via FinTS. The bridge reads them from it. Set it up once with `pnpm setup:hibiscus`; the details are in [bridge/README.md](../bridge/README.md#setup-macos).

## Enable Banking

[Enable Banking](https://enablebanking.com) is an account information service (AIS) under PSD2. After you consent at your bank, it reads your accounts and transactions and passes them on. It reaches banks Hibiscus does not, for example Revolut, Wise and most banks outside Germany.

### Your own application

Belege has no server and keeps no key for you. So **every installation uses its own Enable Banking application**, and its private key stays in your bridge. This is the same pattern as for the language model and Kraken.

**For your own accounts: production, restricted.** A _production_ application becomes active in **restricted mode** as soon as you link your own accounts in the Control Panel ("Link accounts"); it then shows as "Active" and "Restricted". In that mode it reaches exactly the accounts linked there, which is what Belege needs; the guides of [Firefly III](https://docs.firefly-iii.org/tutorials/data-importer/eb/) and [Actual Budget](https://actualbudget.org/docs/advanced/bank-sync/enable-banking) describe it as free. Lifting the restriction (other people's accounts) needs Enable Banking's activation and their terms. A _sandbox_ application only reaches test banks with made-up data; it is for trying the flow, not for your books.

1. **Register an application** in Enable Banking's Control Panel.
   - **Environment:** Production.
   - **Redirect URL:** `https://belege.le-space.de/integrationen/bank/verbunden`, or the same page on your own domain. A production application accepts https only, so no `localhost` and no `127.0.0.1` (a sandbox one also takes http).
   - **The key:** either the panel makes it in the browser and you download a private key file (`.pem`), or you upload a certificate of your own:

     ```bash
     openssl req -x509 -newkey rsa:4096 -nodes -keyout private.key -out public.crt -days 3650 -subj "/CN=belege"
     ```

     In that case `public.crt` goes to the panel, and `private.key` is the file the bridge needs. Keep the key file safe: Enable Banking cannot hand it out again.

   - **Link your accounts in the Control Panel** ("Link accounts"): choose the bank, sign in, consent. This activates the application in restricted mode, for these accounts. Do it **before** linking in Belege: without it, Enable Banking offers no accounts later.

2. **Set up the bridge:**

   ```bash
   pnpm setup:enablebanking
   ```

   It asks for the application id, the path of the private key (not the `.crt`) and the redirect URL. A test call then says:
   - whether the key is accepted;
   - which environment it is (sandbox or production);
   - whether the application is active;
   - whether the redirect URL is registered.

   The key is sealed into `~/.config/belege/enablebanking.sealed` (AES-256-GCM, mode 0600). The key that opens it goes into the macOS keychain or the Windows Credential Manager. Restart the bridge afterwards.

3. **Link a bank** in the app under _Integrationen → Bank → Über Enable Banking_:
   - choose the country and the bank, and the kind of account where the bank offers both;
   - click "Bei der Bank freigeben";
   - sign in at your bank and allow read access; the consent lasts at most 180 days;
   - the bank sends you back to the app; unlock Belege once more, and the bank is linked.
4. **Release the accounts** that may go into the books:

   ```bash
   pnpm setup:enablebanking -- --accounts
   ```

   It lists the linked accounts (bank, name, last four characters of the IBAN) and asks for the IBAN endings to release, as `setup:hibiscus` does. Every other account stays in the bridge, so a private account at the same bank never reaches the books. Restart the bridge afterwards.

5. **Fetch** with "Umsätze holen":
   - the first time, the last 90 days; then from a week before the last fetch; or from a day you choose;
   - booked transactions only; pending ones are counted and come once the bank books them;
   - banks allow only a few unattended fetches a day, so Belege fetches only on your click.

### One account, whichever way it came

An account is known by a hash of its IBAN, never by the IBAN itself.

- **A statement file brought the account before:** Enable Banking continues it. The fetch starts the day after the file's last booking, so the two never overlap.
- **The same account also comes through Hibiscus:** it would come twice. The Bank page warns when a Hibiscus account ends in the same four characters; fetch it one way only.

### When the consent ends

The consent at the bank ends after at most 180 days.

- Two weeks before the end, _Braucht dich_ says so; after the end, it shows an error.
- "Erneuern" on the Bank page asks the bank again. The new consent replaces the old one, which is also ended at Enable Banking.
- The account and its bookings stay as they are.

"Trennen" ends a consent at once. Transactions already fetched stay in the books.

### What goes where

| What                                                      | Where                                                                                                      |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Application id, redirect URL, released IBAN endings       | `~/.config/belege/bridge.json` (0600)                                                                      |
| Private key and sessions, with the accounts' full IBANs   | `~/.config/belege/enablebanking.sealed` (0600, AES-256-GCM); its key in the keychain or Credential Manager |
| Linked banks, the consents' ends, the accounts' last four | the app, in its sealed store                                                                               |
| Transactions of released accounts                         | the app's books, like any other booking                                                                    |

**What leaves this computer:**

- **To Enable Banking:** which bank you link, your accounts there, the transactions of released and fetched accounts, and this computer's IP address. The transactions pass through its servers.
- **To your bank:** your sign-in and the consent, on its own page. Neither Belege nor the bridge sees your bank password.
- **Never:** receipts, bookings from other sources, anything else from your books.

**Who talks to whom:** only the bridge talks to `api.enablebanking.com`. Each request is signed with your application's key (an RS256 JWT, valid ten minutes). The browser only goes to the bank and back.

**The one-time code:** the bank sends the browser back with a one-time code in the address. That address also passes the gateway that serves the app. The page takes the code out of the address at once. The bridge accepts it only for a link it started itself, only once and only within 30 minutes. Without your application's key the code is worthless.

### When something does not work

| Message                                                                         | What to do                                                                                                                                                                                |
| ------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "That is the public certificate you gave Enable Banking"                        | give the private key it was made with (`private.key`, the `-keyout` file), not the `.crt`                                                                                                 |
| "…: there is no file there"                                                     | the path without quotes; `~` is your home folder; a relative path starts in `bridge/`                                                                                                     |
| "Enable Banking did not accept the key"                                         | does the key belong to the certificate in the panel? Compare `openssl x509 -in public.crt -noout -pubkey \| openssl sha256` with `openssl pkey -in private.key -pubout \| openssl sha256` |
| "not active yet", or the bank shows no accounts after linking                   | link your accounts in the Control Panel ("Link accounts"); the application is then active in restricted mode, for those accounts                                                          |
| "SANDBOX" in the setup's answer                                                 | a sandbox application reaches test banks only; register a production one for your own accounts                                                                                            |
| "… is not among the application's redirect URLs"                                | add the URL in the Control Panel, exactly as given                                                                                                                                        |
| "no account leaves the bridge yet"                                              | `pnpm setup:enablebanking -- --accounts`, then restart the bridge                                                                                                                         |
| "This answer … belongs to no link started here, or it is older than 30 minutes" | start the link again from the Bank page                                                                                                                                                   |
| "allows no more requests for now"                                               | the bank's daily limit; try again later                                                                                                                                                   |
