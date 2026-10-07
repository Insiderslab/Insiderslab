# Prompt per Codex — come andare avanti con il CRM WhatsApp (7 ottobre 2026)

Da incollare in Codex (orchestratore Sol o esecutore Luna) con i checkout locali di `Insiderslab/Insiderslab`, `Insiderslab/vocero-crm`, `Insiderslab/wapi`, `Insiderslab/heili-platform`.

---

MANDATO — CRM WhatsApp (Heili Orbit + Whapi): piano di avanzamento e primo pacchetto di codice
Owner: Stefano · Emesso: 7 ottobre 2026 · Lingua: italiano

Valgono le Leggi di Heili (`heili-platform/docs/LEGGI-AI-CODING.md`, copia in `vocero-crm/docs/LEGGI-AI-CODING.md` sul branch `claude/keen-ptolemy-l0kv8g`): mai dati reali, `.env`, token o produzione; mai indebolire l'isolamento tra organizzazioni; un commit per task; mai push su `main`/`master`; branch `codex/<slug>`; work-log in `docs/lavoro/` con §A fatto, §B comandi reali e output, §C non verificato, §D per il revisore. Dire sempre cosa non è stato verificato.

## 1. Leggi prima, in quest'ordine (repo `Insiderslab/Insiderslab`, branch `claude/exciting-rubin-mow1yu`, cartella `crm-whatsapp/`)
1. `ANALISI-STATO-2026-10-05.md` — stato del CRM e di Wapi, stima tempi, percorso scelto (modo diretto ora, Wapi dopo).
2. `REPORT-META-2026-10-05.md` — stato reale dei pannelli Meta: business, WABA, numeri, app, webhook, accessi.
3. `RUNBOOK-TEST-E2E.md`, compreso il "Registro di esecuzione" del 5/10 e 6/10 — dove siamo con il test end-to-end sul numero +1 555 779 6249.
4. `ONBOARDING-LA-BAMBOLA.md` — primo cliente previsto.
5. `GUIDA-SBLOCCO-META.md` — checkpoint Meta (con le correzioni in testa).
Poi nei repo di codice: `vocero-crm/docs/mandati/MANDATO-CODEX-CRM-2026-10-02.md` (pacchetti C1–C6) e `vocero-crm/docs/ops/rilascio-c1.md` sul branch `claude/keen-ptolemy-l0kv8g`; `wapi` branch `codex/phase-0-webhook-inbox` e branch `claude/keen-ptolemy-l0kv8g`.

## 2. Stato di fatto al 7/10 (non rifare l'analisi, verificala)
- Codice CRM: `main` di `vocero-crm` ferma al 23/8; gate verde (typecheck, lint, 268 test). Branch `claude/keen-ptolemy-l0kv8g`: C1 (chiavi bot per organizzazione) e C2 (chiavi export per organizzazione) fatti, 302 test, procedura di rilascio scritta, **non rivisti da un agente diverso dall'autore, non uniti**. C3 (chiave Wapi per organizzazione), C4, C5, C6: non fatti.
- Wapi: `master` ferma al 26/8; produzione da un commit non su master; inoltro webhook al CRM senza coda (fix su `codex/phase-0-webhook-inbox`, 7 commit, non unito); branch `claude/keen-ptolemy-l0kv8g` aggiunge CI minima, rate limit login, Next 16.3.8 (non unito).
- Meta: azienda Insiderlabs Business (404240226745821) verificata; app "Whatpp Business Insiderslab" (609974691965875) Live con accesso standard; WABA "Insiderslab Team" (1027272492350148) con numero +1 555 779 6249 registrato; webhook dell'app ancora su n8n; verifica Tech Provider non avviata. Il numero di Lumii è su Clientify: non è un cliente del CRM.
- Test end-to-end: in corso nella sessione con Chrome; bloccato il token permanente dell'utente di sistema (verifica email Meta che non arriva), si procede con token temporaneo 24 h. Passi A3–A5, B, C ancora da fare.
- Decisione architetturale: **modo diretto nel CRM per i primi clienti; Wapi come gateway solo dopo C3, phase-0 unito e accesso avanzato Meta.**

## 3. Cosa voglio da te
### Task 1 — Verifica dello stato (sola lettura, 30 min)
Conferma o smentisci ogni riga del §2 con `git log`, `git branch -r`, diff e file:riga. Segnala ogni divergenza tra documenti e codice. Nessuna modifica.

### Task 2 — Piano di avanzamento (documento, 1 ora)
Scrivi `Insiderslab/crm-whatsapp/PIANO-AVANZAMENTO-2026-10-07.md` con:
- **Obiettivo a 2 settimane:** 1 cliente reale operativo sul CRM in modo diretto (La Bambola), con test end-to-end nostro riuscito prima.
- **Tre corsie** con ordine, dipendenze, stima in ore e chi esegue:
  1. *Codice (Codex):* revisione indipendente di C1/C2 e checklist di merge; C3; igiene C4; verifica che `META_WEBHOOK_VERIFY_TOKEN`, `META_APP_SECRET` e `OPENROUTER_*` siano documentati nel deploy; script di backup giornaliero del Postgres del CRM fuori dal VPS (solo script e doc, nessuna esecuzione); in Wapi: revisione di `phase-0` e proposta di merge, riallineamento di `master` alla produzione (solo proposta).
  2. *Meta e pannelli (Stefano + sessione Chrome):* chiusura del test end-to-end; token permanente; rimozione risorse in eccesso da `WhatsappBot`; pagamento WABA; decisione n8n; verifica Tech Provider (avvio, perché serve per il modello Wapi).
  3. *Cliente (Stefano + team):* checklist `ONBOARDING-LA-BAMBOLA.md`, contenuti per la base di conoscenza, numero, portfolio Meta del cliente.
- **Rischi e blocchi** con il rimedio (es. token temporaneo che scade, chiavi d'istanza con 2 organizzazioni, `META_APP_SECRET` unico per istanza con app diverse per cliente).
- **Criterio di "fatto"** per ogni corsia, verificabile.
- Nessun segreto, nessun ID di token. Gli ID Meta pubblici (business, WABA, app, phone number id) sì.

### Task 3 — Primo pacchetto di codice, solo dopo il mio "ok" sul piano
Proposta: **C3** in `vocero-crm` (chiave Wapi per organizzazione, cifrata come `metaCredentials.token_cipher`, `resolveGraphTransport` che usa la chiave dell'organizzazione della conversazione, `WAPI_API_KEY` globale solo per installazione mono-organizzazione con avviso nei log, correzione del dominio `whapi.heili.cloud` in `.env.example` e docs). Perimetro e accettazione come nel mandato del 2/10. Branch `codex/c3-wapi-key-per-org` da `main` **oppure** da `claude/keen-ptolemy-l0kv8g` se riusa `src/server/api-keys.ts`: dimmi quale e perché prima di iniziare. Gate: `pnpm typecheck && pnpm lint && pnpm test && pnpm build`, test negativi di isolamento, sabotage test nel work-log, PR in bozza, nessun merge.

## 4. Consegna
- Task 1 e 2 in un'unica risposta, con il piano salvato nel repo `Insiderslab` sul branch `claude/exciting-rubin-mow1yu` (commit, push). Se non hai accesso in scrittura a quel repo, consegna il file in chat e dillo.
- Chiudi con: cosa non hai verificato, e la domanda secca "ok per C3 da <branch>?".
