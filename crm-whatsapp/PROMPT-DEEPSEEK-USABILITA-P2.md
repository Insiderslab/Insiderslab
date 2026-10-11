# Prompt per DeepSeek: notte del 11/10, usabilità priorità 2 (pagina «Sintesi» e checklist di primo avvio)

Incolla in DeepSeek (OpenCode, sul PC di Stefano) tutto il blocco qui sotto, così com'è.

**Perché proprio questi due lavori:** i problemi di priorità 1 del test di usabilità (E1–E10) li sta già sistemando un agente di Claude, e Kimi lavora sui canali (R2). Se due agenti toccano gli stessi file nascono conflitti. Questi due interventi sono di priorità 2 e toccano file diversi.

---

Sei uno sviluppatore senior su **Heili CRM**, repository GitHub `Insiderslab/vocero-crm`: Next.js 15, React 19, TypeScript strict, Drizzle/PostgreSQL 16, Better Auth con organizzazioni, Tailwind, Vitest. Stanotte lavori da solo. Domattina il tuo lavoro lo rivede un altro agente, Claude.

## Compito
Dal test di usabilità di Heili CRM, implementa **due interventi di priorità 2**:

### A. Pagina «Sintesi» (dashboard), la lacuna più grande da mostrare ai clienti
Una pagina nuova `/dashboard` nel gruppo `src/app/(app)/`, con la voce di menu «Sintesi». Deve essere la **prima voce del menu**, ma la pagina iniziale dopo il login non cambia. Mostra, per l'organizzazione corrente, con un selettore di periodo (7 / 30 / 90 giorni):
1. **Conversazioni per fase della pipeline**: conteggio per fase, con il nome della fase come salvato.
2. **Tempo di prima risposta**: mediana e 90° percentile tra il primo messaggio in entrata di una conversazione nel periodo e la prima risposta in uscita, in minuti. Escludi le conversazioni di test (`conversation.is_test`).
3. **Quota IA contro persona**: messaggi in uscita con `message.ai_generated = true` contro `false`, più il numero di conversazioni passate a una persona (`conversation.handoff_at` nel periodo) divise per motivo (`handoff_reason`).
4. **Conversioni**: lead entrati nella fase «cliente» o vinta nel periodo, usando la tabella `lead_stage_event` (guarda come si identificano le fasi vinta e persa nello schema).
5. **Andamento**: messaggi in entrata e in uscita per giorno nel periodo, come grafico a barre semplice.

Regole:
- **Niente librerie nuove** (la costituzione vieta dipendenze runtime aggiuntive): i grafici sono SVG o CSS a mano, accessibili (`aria-label`, testo alternativo con i numeri), leggibili in tema chiaro e scuro e a 390 px.
- **Dati solo dell'organizzazione della sessione**: usa gli helper di scoping esistenti (`scoped`, `withAuth`) e aggiungi la rotta all'inventario dei ruoli in `tests/unit/helpers/route-roles.ts`. Ruoli: tutti i membri dell'organizzazione possono vedere la Sintesi.
- **Query efficienti**: aggregazioni in SQL, nessun caricamento di tutti i messaggi in memoria. Usa gli indici esistenti e spiega nel registro se ne serve uno nuovo.
- **Stati vuoti chiari**: per esempio «Ancora nessun dato in questo periodo». **Stato di caricamento con scheletri**: mai un falso «zero» mentre carica.
- Etichette in **i18n es/en/it** (`src/lib/i18n/messages/*`), date e numeri con `Intl` nella lingua dell'interfaccia.

### B. Checklist di primo avvio, perché un cliente nuovo arrivi al primo messaggio da solo
Un componente «Primi passi», visibile a owner e admin finché non è tutto completato, poi nascosto, con la possibilità di riaprirlo dalle Impostazioni. Mostralo in cima alla pagina **Sintesi** e nella pagina **Automazioni**. I passi, ognuno con stato fatto o da fare e un link al punto giusto:
1. Numero WhatsApp collegato (esiste una connessione attiva dell'organizzazione).
2. Almeno un modello Meta **approvato** (tabella `template`, stato approvato).
3. Agente configurato: istruzioni non vuote e almeno una voce nella base di conoscenza.
4. Almeno una valutazione eseguita nel Laboratorio.
5. Agente acceso.

Inoltre, in **Automazioni**, il pulsante «Crea regola» quando è disattivato deve **dire cosa manca**, con lo stesso calcolo dei passi 1–2, invece di restare grigio e basta.

Lo stato dei passi viene da un'unica funzione server, per esempio `src/server/onboarding/checklist.ts`, con i suoi test.

## Preparazione su questo PC (prima di tutto)
1. **Cartella dedicata:** `git clone https://github.com/Insiderslab/vocero-crm.git heili-p2`, poi `cd heili-p2`, poi `git checkout -b feat/usabilita-p2-sintesi-avvio`. Lavora **solo** dentro questa cartella. Kimi lavora in un'altra cartella (`heili-r2`): non toccarla.
2. **Strumenti:** `git`, `node -v` (Node 22), `pnpm -v` (se manca, `corepack enable`), `docker -v`. Prima di installare qualcosa a livello di sistema, **chiedi a Stefano**.
3. **Database di prova**, su una porta diversa da quella di Kimi:
   `docker run -d --name pg16-ds -e POSTGRES_USER=vocero -e POSTGRES_HOST_AUTH_METHOD=trust -p 5434:5432 postgres:16`
   Se manca Docker: scrivi codice e test di unità, salta golden ed e2e e scrivilo nella PR.
4. **Push:** se `git push` chiede credenziali che non hai, non cercarle: lascia i commit in locale e scrivi a Stefano il comando da lanciare. **Non chiedere mai** token o password in chat.
5. Prima di ogni comando che cancella file o cambia la configurazione di git o del sistema, chiedi conferma.

## Da leggere prima di scrivere codice
`CLAUDE.md`, `.specify/memory/constitution.md`, `src/lib/db/schema.ts`, `src/lib/api.ts` (`withAuth` e simili), `src/lib/db/tenant.ts`, il layout `src/app/(app)/layout.tsx` e la navigazione, una pagina esistente come modello (per esempio `src/app/(app)/contacts`) e un registro di lavoro come `docs/lavoro/2026-10-10-assistente-interno.md` per lo stile.

## Regole (obbligatorie)
- **Mai** toccare la produzione: niente SSH sul VPS, niente `.env` reali, niente chiamate a Meta, OpenRouter o altri servizi esterni.
- **Mai** unire su `main`, mai fare force push. Al massimo apri una **PR in bozza**.
- **Non toccare** questi file, che altri stanno modificando stanotte:
  - `src/server/ai/*`, `src/server/inbox/*`, `src/server/whatsapp/*`, `src/server/channels/*`;
  - `src/components/inbox/*`, `src/components/agent/*`;
  - `src/server/site-requests/*`, `src/app/api/public/*`;
  - i file di traduzione **solo in aggiunta**: aggiungi chiavi nuove, non modificare quelle esistenti.
- **Nessuna migrazione Drizzle**, se possibile: tutto si calcola dai dati esistenti. Se una ti serve davvero, chiamala `0016_…` e scrivi nella PR che andrà rinumerata.
- **Test prima del codice** per la funzione della checklist e per le query della Sintesi: test **golden** su PostgreSQL vero, con dati costruiti apposta e numeri attesi scritti a mano, più l'isolamento tra due organizzazioni (i dati dell'organizzazione B non compaiono mai in A).
- Le istantanee in `tests/golden/__golden__/` **non devono cambiare**.
- **Sabotaggi:** per ogni controllo nuovo (scoping per organizzazione, esclusione dei test, ruoli), toglilo e mostra che un test fallisce, poi ripristina.
- Commit piccoli, con messaggi in italiano: `feat(sintesi): …`, `feat(avvio): …`, `test(…): …`.

## Come provare
- `pnpm install`
- Comandi da eseguire:
  - `pnpm typecheck`
  - `pnpm lint`
  - `pnpm test`
  - `DATABASE_URL_GOLDEN=postgres://vocero@127.0.0.1:5434/vocero_golden_p2 pnpm test:golden` (il nome della base deve contenere «golden»)
  - `pnpm build`
- E2E, se ci riesci: `pnpm test:e2e` con un `.env` **locale di sviluppo** creato da `.env.example` (`WA_MOCK_ENABLED=true`, nessun valore reale).
- Se riesci ad avviare l'app in locale (`pnpm dev`), salva in `docs/lavoro/img/` due screenshot della Sintesi (tema chiaro e scuro) e uno a 390 px.

## Consegna
1. Push del branch e **PR in bozza** verso `main`, titolo: «Usabilità P2: pagina Sintesi e checklist di primo avvio (bozza)». Nella descrizione:
   - cosa è fatto;
   - risultati dei comandi, con i numeri;
   - tabella dei sabotaggi;
   - cosa **non** hai verificato;
   - domande aperte.
2. Registro di lavoro in `docs/lavoro/2026-10-11-usabilita-p2.md` e una spec breve in `specs/custom-heili/010-sintesi-e-primo-avvio.md`.
3. Se una scelta non è coperta da questo prompt o dalla costituzione, **non improvvisare**: scrivila come domanda nella PR e vai avanti con il resto.
4. Se non finisci tutto, consegna quello che è verde: meglio solo la Sintesi, fatta bene e provata, che tutte e due a metà.
