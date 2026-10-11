# Prompt per DeepSeek, 2° giro della notte del 11/10: pagina «Conoscenza» e Contatti a tabella

Incolla in DeepSeek (OpenCode, sul PC di Stefano) tutto il blocco qui sotto, così com'è.

**Perché questi lavori:** la PR #11 (Sintesi e Primi passi) la sta già correggendo Claude: **non riprenderla**. I problemi E1–E10 li sistema un altro agente, Kimi lavora sui canali. Qui ci sono le due voci successive del test di usabilità, scelte perché toccano file separati.

---

Sei uno sviluppatore senior su **Heili CRM**, repository GitHub `Insiderslab/vocero-crm`: Next.js 15, React 19, TypeScript strict, Drizzle/PostgreSQL 16, Better Auth con organizzazioni, Tailwind, Vitest. Lavori da solo stanotte. Domattina il lavoro lo rivede Claude.

## Lezione dal giro precedente (importante)
Nella PR #11 i test di unità erano verdi, ma **8 test golden su 14 fallivano sul database vero**. La pagina Sintesi in produzione non si sarebbe aperta: un `Date` passato dentro un template `sql\`...\`` di drizzle/postgres-js manda in errore la query.

Quindi:
- **Mai passare un `Date` dentro `sql\`...\``.** Usa i costruttori di Drizzle (`gte(col, date)`), che serializzano correttamente, oppure `${date.toISOString()}::timestamp`.
- **Senza PostgreSQL vero, il lavoro è a metà.** Prima di scrivere codice, prova ad avere un database di prova (vedi «Preparazione»). Se proprio non ci riesci, limita il lavoro alla parte che non tocca SQL nuovo e scrivilo in cima alla PR.

## Compito
### A. Pagina «Conoscenza» (base di conoscenza dell'agente gestibile)
Oggi la base di conoscenza è una lista di blocchi di testo senza titolo, che si possono solo cancellare. Già oggi un'azienda ha 7.646 caratteri. Crea una **pagina dedicata** `/agent/knowledge`, voce «Conoscenza», raggiungibile da un link nella pagina Agente.
- Elenco delle voci (blocchi e domande/risposte) con:
  - **titolo**;
  - tipo;
  - estratto;
  - **fonte** (testo libero, per esempio «Listino 2026» o «Sito»);
  - **data di ultima modifica** (`updated_at` esiste già).
- **Ricerca** per testo nel titolo e nel contenuto, che ignora gli accenti come la ricerca della Posta (guarda come lo fa la Posta e riusa lo stesso helper). **Filtro** per tipo.
- **Modifica** di ogni voce in un dialogo. La rotta `PATCH /api/kb/[id]` esiste già (owner/admin): estendila ai campi nuovi. **Crea** e **cancella**, con conferma.
- Contatore dei caratteri totali e del peso. Esiste `GET /api/kb/size`: riusalo.
- **Importazione da file di testo** (`.txt`/`.md`, massimo 200 KB): l'utente sceglie un file, l'anteprima lo divide in blocchi su righe `## Titolo` (oppure un blocco unico), e conferma. **Niente Google Drive**: la costituzione vieta servizi esterni.
- Migrazione: aggiungi a `kb_entry` le colonne `title text` e `source text`, entrambe nullable.
  - Chiamala `0016_kb_titolo_fonte`; nella PR scrivi che **andrà rinumerata**, perché altre PR aggiungono 0015.
  - Metti `SET LOCAL lock_timeout = '5s';` in testa, come `drizzle/0013` e `0014`.
- **Il prompt dell'agente NON cambia.** Non toccare `src/server/ai/*`: titolo e fonte servono solo all'interfaccia, per ora. Così le istantanee golden dell'agente restano identiche.
- **Ruoli:** tutti i membri possono vedere, solo owner/admin possono modificare (come oggi).

### B. Contatti a tabella
Oggi le righe occupano tutta la larghezza, nome e azioni sono lontanissimi e mancano ordinamento, selezione, filtri ed esportazione.
- Vista a **tabella** su desktop: colonne nome, telefono, fase, ultima attività, etichette, azioni con **testo** e non solo icona. Su mobile (390 px) resta una lista leggibile.
- **Ordinamento** per nome e per ultima attività. **Filtro per etichetta** (le etichette esistono già: `contact_tag`, `src/app/api/contacts/[id]/tags`) e per fase.
- **Selezione multipla** con azioni di gruppo: aggiungi etichetta, togli etichetta, archivia. Ogni azione di gruppo è una sola richiesta al server, **limitata all'organizzazione** e con **massimo 500 contatti**.
- **Esporta CSV** dei contatti filtrati, solo owner/admin, con una rotta nuova a sessione (per esempio `GET /api/contacts/export`). Non toccare `/api/export/*`, che usa le chiavi `vex_`.
  - Proteggi dalla **CSV injection**: un valore che inizia con `=`, `+`, `-` o `@` va prefissato con `'`.
- **Non cambiare** la logica di caricamento esistente di `src/components/contacts/contacts-client.tsx`: stati di caricamento e messaggio vuoto li sta sistemando un altro agente. Se puoi, metti la tabella in un componente nuovo, per esempio `contacts-table.tsx`, e cambia il minimo nel file esistente.

## Preparazione su questo PC (prima di tutto)
1. Cartella nuova: `git clone https://github.com/Insiderslab/vocero-crm.git heili-p3`, poi `cd heili-p3`, poi `git checkout -b feat/usabilita-p3-conoscenza-contatti` da `origin/main`. **Non** lavorare in `heili-p2` né in `heili-r2`.
2. Strumenti: `git`, `node -v` (Node 22), `pnpm -v` (se manca, `corepack enable`).
3. **Database di prova**, in quest'ordine:
   - **Docker**, se c'è: `docker run -d --name pg16-p3 -e POSTGRES_USER=vocero -e POSTGRES_HOST_AUTH_METHOD=trust -p 5435:5432 postgres:16`.
   - **Altrimenti PostgreSQL 16 portatile per Windows**, senza installazione di sistema: scarica i binari zip ufficiali (EnterpriseDB, «zip archive») in `heili-p3\.pg` (fuori da git: aggiungilo a `.git/info/exclude`). Poi:
     - `initdb -D .pg\data -U vocero -A trust`;
     - `pg_ctl -D .pg\data -o "-p 5435" -l .pg\log start`.
   - **Prima di scaricare qualcosa, chiedi a Stefano.**
   - Se nessuna delle due strade funziona, scrivilo in cima alla PR e consegna il lavoro come «a metà».
4. Push: se `git push` chiede credenziali che non hai, non cercarle: lascia i commit in locale e scrivi a Stefano il comando. **Mai** chiedere token o password in chat.
5. Prima di ogni comando che cancella file o cambia la configurazione di git o del sistema, chiedi conferma.

## Da leggere prima di scrivere codice
- `CLAUDE.md`
- `.specify/memory/constitution.md`
- `src/lib/db/schema.ts` (`kbEntry`, `contact`, `contactTag`)
- `src/app/api/kb/*`
- `src/app/api/contacts/*`
- `src/lib/api.ts` (`withAuth`, `withAdminAuth`)
- `src/lib/db/tenant.ts` (`scoped`)
- `tests/unit/helpers/route-roles.ts`, l'inventario dei ruoli, dove va **ogni rotta nuova**
- un registro come `docs/lavoro/2026-10-10-assistente-interno.md`, per lo stile

## Regole (obbligatorie)
- **Mai** toccare la produzione, il VPS o `.env` reali. Niente chiamate a Meta, OpenRouter o altri servizi esterni.
- **Mai** unire su `main`, mai fare force push. Al massimo apri una **PR in bozza**.
- **Non toccare:**
  - `src/server/ai/*`, `src/server/inbox/*`, `src/server/whatsapp/*`, `src/server/channels/*`, `src/server/site-requests/*`;
  - `src/components/inbox/*`, `src/components/dashboard/*`, `src/components/onboarding/*`;
  - `src/app/api/public/*`, `src/app/api/export/*`;
  - in `src/components/agent/agent-client.tsx` aggiungi **solo** il link alla pagina Conoscenza.
- Le traduzioni sono **solo in aggiunta** (chiavi nuove, es/en/it).
- **Test prima del codice**. Test **golden su PostgreSQL vero** per:
  - le rotte KB (campi nuovi, ricerca, ruoli);
  - le azioni di gruppo sui contatti;
  - l'esportazione CSV (escaping, filtri, ruoli);
  - **isolamento tra due organizzazioni**: l'organizzazione A non vede né modifica nulla di B.

  Più test di unità per il parser dell'importazione e per l'escaping CSV.
- Le istantanee in `tests/golden/__golden__/` **non devono cambiare**.
- **Sabotaggi:** per ogni guardia nuova (scoping per organizzazione, ruoli, tetto dei 500, escaping CSV), toglila, mostra che un test fallisce, poi ripristina.
- Commit piccoli in italiano: `feat(conoscenza): …`, `feat(contatti): …`, `test(…): …`.

## Come provare
- `pnpm install`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `DATABASE_URL_GOLDEN=postgres://vocero@127.0.0.1:5435/vocero_golden_p3 pnpm test:golden`: **obbligatorio**, il nome della base deve contenere «golden». Prima crea la base: `createdb -h 127.0.0.1 -p 5435 -U vocero vocero_golden_p3`.
- `pnpm build`
- Se riesci: `pnpm test:e2e` con un `.env` **locale di sviluppo** creato da `.env.example` (`WA_MOCK_ENABLED=true`, nessun valore reale).

## Consegna
1. Push del branch e **PR in bozza** verso `main`, titolo: «Usabilità P3: pagina Conoscenza e Contatti a tabella (bozza)». Nella descrizione:
   - cosa è fatto;
   - comandi e numeri, **golden compresi**;
   - tabella dei sabotaggi;
   - cosa **non** hai verificato;
   - domande aperte.
2. Registro in `docs/lavoro/2026-10-11-usabilita-p3.md` e spec breve in `specs/custom-heili/011-conoscenza-e-contatti.md`.
3. Se una scelta non è coperta, **non improvvisare**: scrivila come domanda nella PR e vai avanti.
4. **Priorità:** prima la **A** (Conoscenza), fatta bene e provata sul database, poi la B. Meglio una sola finita che due a metà.
