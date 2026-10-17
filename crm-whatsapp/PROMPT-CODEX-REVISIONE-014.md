# Prompt per Codex: revisione indipendente della PR #16 (014 — guardia del webhook WhatsApp)

Incolla in Codex tutto il blocco qui sotto, così com'è. Va bene sia Codex cloud (repository `Insiderslab/vocero-crm`) sia Codex sul PC.

---

Sei un revisore senior indipendente. Repository GitHub **Insiderslab/vocero-crm** (Heili CRM): Next.js 15, React 19, TypeScript strict, Drizzle/PostgreSQL 16, Better Auth con organizzazioni, Vitest.

**Compito: SOLO revisione.** Non modificare file, non fare commit, push, PR o merge. Alla fine consegna un rapporto.

## Cosa rivedere
La PR **#16**, già unita su `main`: «014 — Guardia del webhook WhatsApp».
- Diff: `git diff db6f4268ce0b7b1a5553f9aa684b93a29fcccc41 e02a36371e82bdf9d5566bdb2362c04772b85154`, oppure i commit `dd51769` e `d30c696`.
- Da leggere prima del codice:
  - la spec `specs/custom-heili/014-guardia-webhook.md`;
  - il registro `docs/lavoro/2026-10-16-guardia-webhook.md`, con la revisione già fatta e le correzioni;
  - `CLAUDE.md` e `.specify/memory/constitution.md`.

**Cosa fa la PR:**
- Il CRM chiede a Meta (`GET {phone-number-id}?fields=webhook_configuration`) dove vengono mandati gli eventi WhatsApp del numero di ogni organizzazione.
- Se vanno altrove (caso reale: un flusso n8n si era preso il callback dell'app), compaiono un avviso rosso in Impostazioni → WhatsApp e una barra rossa in tutta l'app, per owner/admin.
- Il super-admin può rimettere il CRM come callback dell'app con `POST {app-id}/subscriptions`.
- C'è un avviso di «silenzio insolito».
- Un controllo orario in-process scrive nei log i cambi di stato.

**File principali:**
- `src/lib/webhook-route.ts`: logica pura;
- `src/server/whatsapp/webhook-route.ts`: Meta, cache, giro orario, ripristino, statistiche;
- `src/app/api/settings/whatsapp/route-check/route.ts`: owner/admin;
- `src/app/api/admin/platform/meta/webhook/route.ts`: super-admin;
- `src/components/settings/webhook-route-alert.tsx`;
- `src/components/app-shell.tsx`;
- `src/components/settings/whatsapp-guide.tsx`;
- `src/instrumentation*.ts`;
- i18n in `src/lib/i18n/messages/{es,en,it}/settings.ts`;
- test: `tests/unit/webhook-route-guard.test.ts`, `tests/golden/webhook-route-guard.golden.test.ts`, `tests/unit/helpers/route-roles.ts`.

## Su cosa concentrarti
1. **Segreti.** Nessuno di questi deve uscire in risposte, log, bundle del client o messaggi d'errore:
   - App Secret, verify token del webhook, token WhatsApp delle organizzazioni;
   - il percorso dell'URL estraneo: deve uscire solo l'host.

   Il token dell'app (`app_id|app_secret`) deve stare solo nell'header.
2. **Autorizzazioni.**
   - `route-check` solo owner/admin.
   - Ripristino solo super-admin (`withSuperadmin`).
   - Isolamento tra organizzazioni: un'organizzazione non deve poter vedere stato o statistiche di un'altra, nemmeno attraverso la cache in memoria.
3. **Semantica di Meta Graph.**
   - Precedenza di `webhook_configuration`: `phone_number` → `whatsapp_business_account` → `application`.
   - Forma della chiamata `POST {app-id}/subscriptions`: object, callback_url, verify_token, fields.
   - Comportamento con coexistence, override dell'agenzia, numeri manuali, token di un'altra app.
4. **Falsi allarmi e allarmi mancati.**
   - Meta giù, campo assente, gateway Wapi, connessione `reconnect_required`, numero appena cambiato.
   - Più repliche o riavvii: la cache e i contatori vivono in memoria.
5. **Silenzio insolito.**
   - Soglie: media di almeno 3 messaggi al giorno nei 14 giorni prima dell'ultimo messaggio, e almeno 24 ore di silenzio.
   - Query: scoping per organizzazione, `is_test`, `timestamp` senza fuso, costo sulla tabella `message`.
6. **React/client.**
   - Effetti e intervalli: perdite di memoria, doppie chiamate, idratazione.
   - La barra nella shell: quante chiamate fa e su quali pagine.
   - `window.confirm` e gli stati del pulsante.
   - Accessibilità: `role="alert"` e fuoco.
7. **Robustezza del giro orario.**
   - Avvio, `unref`, sovrapposizioni, molte organizzazioni.
   - Rate limit di Meta.
8. **Test.**
   - Coprono davvero i casi?
   - Ci sono asserzioni deboli o test che passerebbero anche con il codice rotto?
   - Proponi almeno un sabotaggio che **nessun** test intercetta oggi, se ne trovi uno.

## Prove (se l'ambiente lo permette)
- Solo comandi in sola lettura: `./node_modules/.bin/tsc --noEmit -p .` e `./node_modules/.bin/vitest run tests/unit/webhook-route-guard.test.ts`.
- I test golden richiedono `DATABASE_URL_GOLDEN` su un database il cui nome contiene «golden». Se non c'è, non crearlo: scrivi che non li hai eseguiti.
- **Mai:**
  - toccare la produzione o il VPS;
  - leggere `.env` reali;
  - chiamare Meta, OpenRouter o altri servizi esterni;
  - installare dipendenze senza chiedere.

## Consegna
Un rapporto in **italiano**, al massimo 600 parole.
1. **Esito** in una riga: «ok», «ok con correzioni» oppure «da rifare».
2. **Problemi trovati**, dal più grave, con questi campi:
   - gravità (alta, media, bassa);
   - `file:riga`;
   - **scenario concreto** (input o stato → effetto sbagliato);
   - correzione proposta.

   Solo problemi verificati leggendo il codice. Quello che è un sospetto va scritto come «da verificare».
3. **Cosa hai verificato e risulta corretto**: elenco breve.
4. **Comandi eseguiti e risultati**, oppure perché non li hai eseguiti.

Non ripetere i 4 punti già corretti, elencati nel registro alla sezione «Revisione indipendente». Se però una di quelle correzioni è sbagliata o incompleta, dillo.
