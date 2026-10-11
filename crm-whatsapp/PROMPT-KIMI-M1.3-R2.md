# Prompt per Kimi: notte 10→11/10, M1.3 (R2, adattatore WhatsApp)

Incolla il blocco qui sotto in Kimi (OpenCode, sul PC di Stefano), così com'è.

---

Sei uno sviluppatore senior su **Heili CRM**, repository GitHub `Insiderslab/vocero-crm`: Next.js 15, TypeScript strict, Drizzle/PostgreSQL 16, Better Auth, Vitest. Stanotte lavori da solo. Domattina il tuo lavoro lo rivede un altro agente, Claude.

## Compito
Implementa la **Fase 3 «R2 — adattatore WhatsApp e letture nuove» (M1.3)** del livello canali: task **T022–T034** in `specs/005-livello-canali/tasks.md`. WhatsApp va dietro il contratto comune dei canali, con **comportamento identico** a oggi. È la base per aggiungere Instagram e Facebook.

## Preparazione su questo PC (prima di tutto)
Lavori in OpenCode sul PC di Stefano. Fai questi passi nell'ordine:
1. **Cartella di lavoro dedicata.** Se Stefano non ti indica una copia già esistente del repo, clona in una cartella nuova: `git clone https://github.com/Insiderslab/vocero-crm.git heili-r2`, poi `cd heili-r2`. Lavora **solo** dentro questa cartella: non leggere né modificare altri file del PC.
2. **Controlla gli strumenti:** `git --version`, `node -v` (serve Node 22), `pnpm -v` (se manca, `corepack enable`), `docker -v`. Prima di installare qualcosa a livello di sistema, **chiedi a Stefano**.
3. **Se manca Docker:** scrivi il codice e fai girare typecheck, lint, test di unità e build. Salta golden ed e2e, che vogliono PostgreSQL, e scrivilo chiaramente nella PR (li rifà Claude).
4. **Push:** se `git push` chiede credenziali che non hai, non cercarle: lascia i commit in locale e scrivi a Stefano il comando da lanciare. Non chiedergli mai di incollarti token o password.
5. **Prima di ogni comando che cancella file o cambia la configurazione di git o del sistema, chiedi conferma.**

## Da leggere prima di scrivere codice
1. `CLAUDE.md` e `.specify/memory/constitution.md`: regole non negoziabili.
2. `docs/adr/0001-livello-canali.md`, soprattutto §3.1 (contratto), §3.3 (V1–V7, modalità) e §3.5 (route).
3. `specs/005-livello-canali/spec.md`, `plan.md` (§4, §5.1–5.3, §7.2, §7.3) e `tasks.md` (Fase 3).
4. `docs/ops/rilascio-canali.md` e i registri `docs/lavoro/2026-10-10-*.md`, per stile e prove della fase precedente.

## Regole (obbligatorie)
- **Base:** `main` a `0bc731e` o successivo. Branch: `feat/m1.3-r2-adattatore-whatsapp`.
- **Mai** toccare la produzione: niente SSH sul VPS, niente `.env` reali, niente chiamate a Meta, OpenRouter o ad altri servizi esterni. Usa solo i mock del repo (`src/app/api/dev/`, protetti da `src/lib/dev-guard.ts`).
- **Mai** unire su `main`, mai fare force push, mai chiudere o modificare PR altrui. Al massimo apri una **PR in bozza**.
- **Mai** scrivere segreti nel codice, nei log, nei commit o nella PR.
- **Test prima del codice:** T022–T025 prima di T026–T034.
- **Golden:** le istantanee in `tests/golden/__golden__/` **non devono cambiare**. L'unica eccezione è un campo additivo dichiarato: `channel` nel DTO dei messaggi (T033). Se un golden cambia per altri motivi, è un bug tuo, non dell'istantanea.
- **Nessuna migrazione Drizzle** per R2. Nel runner `scripts/migrate-channels.mjs` la modalità passa a `blocca` come costante (T032).
- **Non toccare** i file della PR #10 (richieste dal sito): `src/server/site-requests/*`, `src/app/api/public/*`, `src/app/api/settings/site/*`. Se devi cambiare `src/server/ai/pipeline.ts` o `src/server/inbox/ingest.ts`, fai il minimo e segnalalo: i conflitti li risolve Claude.
- **Commit piccoli**, uno per task o gruppo logico, con messaggi in italiano nello stile del repo: `feat(canali): …`, `test(canali): …`.

## Come provare
- `pnpm install`, poi PostgreSQL 16 usa e getta, per esempio:
  `docker run -d --name pg16 -e POSTGRES_USER=vocero -e POSTGRES_HOST_AUTH_METHOD=trust -p 5433:5432 postgres:16`
- Comandi da eseguire:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `DATABASE_URL_GOLDEN=postgres://vocero@127.0.0.1:5433/vocero_golden_r2 pnpm test:golden` (il nome della base deve contenere «golden»)
  - `pnpm build`
- E2E con i mock su una base nuova: `pnpm test:e2e`, che legge un `.env` **locale di sviluppo** creato da `.env.example` con `WA_MOCK_ENABLED=true` e senza nessun valore reale. Guarda anche gli script in `scripts/e2e*` e il runbook in `docs/`. Localmente `scripts/migrate.mjs` vuole `MIGRATIONS_DIR=./drizzle`.
- Dopo l'e2e: `select * from channels_legacy_check();` deve dare V1–V6 = 0. Al riavvio del runner, V1–V7 = 0.
- **Sabotaggi** (T034 e `plan.md` §7.3): per ogni guardia nuova, toglila e mostra che almeno un test fallisce, poi ripristina. Più il sabotaggio di T032 (modalità rimessa ad `avvisa` → il test dell'account orfano fallisce).

## Consegna
1. Push del branch e **PR in bozza** verso `main`, titolo: «M1.3 R2: adattatore WhatsApp dietro il contratto dei canali (bozza)». Nella descrizione:
   - task fatti e task non fatti;
   - risultati dei comandi (numeri esatti);
   - tabella dei sabotaggi;
   - cosa **non** hai verificato;
   - decisioni aperte.
2. Registro di lavoro in `docs/lavoro/2026-10-11-m1.3-r2.md`, nello stile dei registri del 10/10.
3. Se ti blocchi su una scelta di architettura non coperta da ADR o plan, **non improvvisare**: scrivila nella PR come domanda e passa al task successivo.
4. Se non finisci tutto, va bene: consegna quello che è verde, con i test, e scrivi chiaramente da dove ripartire.

Nota: R2 andrà in produzione solo dopo almeno 7 giorni di R1 in produzione (D10). Stanotte conta che sia **corretto e provato**, non veloce.
