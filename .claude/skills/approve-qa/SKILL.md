---
name: approve-qa
description: Test di usabilità e di funzionamento di Approve by Heili (heili-approve/). Avvia l'app in locale con la build di produzione, esegue controlli automatici ed e2e, poi un giro esplorativo da agenzia e da cliente su telefono e computer, e scrive un rapporto con difetti e migliorie pronto per chi corregge. Usala quando chiedono "testa l'app", "test di usabilità", "QA", "controlla che funzioni tutto", "trova errori e migliorie", "valuta la UX", prima di un rilascio o dopo il lavoro notturno di altri agenti.
---

# Test di usabilità e funzionamento — Approve by Heili

Obiettivo: un rapporto **verificato** (solo osservazioni riprodotte) che chi corregge, persona o AI, possa usare senza
altro contesto. Non correggere nulla durante il test: si osserva, si misura, si documenta.

## 0. Regole

- Leggi prima `heili-approve/AGENTS.md`, `docs/CONTRATTO.md`, `docs/STUDIO-DESIGN.md`. Sono le regole di design:
  - calma e colore che significa qualcosa;
  - stati sempre con una parola;
  - campi a 16 px e aree toccabili da 44 px;
  - mobile first e testi in italiano.
- **Non toccare** codice dell'app, test, `.env`, segreti. L'unico file che scrivi nel repository è il rapporto.
- Processi: chiudili solo per PID, mai con `pkill` generici. Chromium per Playwright è in `/opt/pw-browsers`, non
  lanciare `playwright install`.
- Se gli e2e riscrivono `docs/screenshots/`, ripristinali con `git checkout -- heili-approve/docs/screenshots`. Con
  K-12 le schermate vanno in `test-results/` se non si imposta `UPDATE_SCREENSHOTS=1`.

## 1. Ambiente (build di produzione, mai `next dev` per gli e2e)

1. Postgres e Redis locali: avviali se non girano, come spiega il README alla sezione «Avvio in locale». Crea un
   database nuovo, per esempio `approve_qa_<data>`, e imposta `DATABASE_URL` su quello.
2. `cd heili-approve && npm ci && npx prisma generate && npx prisma migrate deploy && npm run db:seed`.
   Il seed stampa i link del portale clienti.
3. `npm run build && PORT=3000 APP_VARIANT=all METRICOOL_FAKE=1 npm start`, più il worker
   (`METRICOOL_FAKE=1 npm run worker > $E2E_WORKER_LOG`).
   - Per le email usa un SMTP finto locale, con `EMAIL_SERVER=smtp://127.0.0.1:2525`.
   - Per Heili senza chiave vera usa il server AI finto di `e2e/assistant-after-changes.spec.mjs`
     (`OPENAI_BASE_URL`).
4. Accesso agenzia: cookie `authjs.session-token=dev-session-stefano-insiderslab-0000000001`.

## 2. Controlli automatici

`npx tsc --noEmit`, `npx eslint .` (riporta i conteggi), `npx vitest run --maxWorkers=4`, poi l'intera suite e2e con
`npm run test:e2e`. Riesegui una volta ogni spec fallita, per distinguere i test instabili dagli errori veri. Per ogni
errore vero indica:
- spec e test;
- l'asserzione e l'errore;
- se è sbagliato il test o l'app.

## 3. Giro esplorativo (telefono 390×844 @2x e computer 1366×900)

Scrivi piccoli script Playwright e salva le schermate nello scratchpad. Recita due persone.

**A. Social media manager dell'agenzia**
- Dashboard, selettore cliente, elenco post e filtri, calendario.
- Editor del post con anteprime, invio in revisione, condivisione del link (WhatsApp/QR).
- «Importa post» da Excel, CSV e righe incollate.
- Piano del mese, invio del piano, avvisi (cliente senza brand Metricool).
- Clienti e import da Metricool (modalità finta).
- Impostazioni: chiavi personali, «Collega la tua AI (MCP)».
- Articoli e creatività ads, compreso Google Ads.

**B. Cliente non tecnico, da telefono**
- Home del portale e piano del mese nelle tre viste: Panoramica, Griglia, Sfoglia.
- Pagina del post: anteprime, carosello, video, punto sull'immagine, commento, dettatura.
- Heili, il pulsante galleggiante:
  - Guida, scheda Feedback, modalità decisione e modalità dopo «Chiedi modifiche»;
  - riepilogo e «Aggiungi al feedback».
- «Approva», «Chiedi modifiche», «Approva tutto il piano», percorso del mese.

**Su ogni schermata controlla:**
- **Orientamento:** il cliente sa sempre dove è, cosa resta e cosa fare dopo?
- **Gerarchia:** il pulsante principale è giusto? Ci sono inviti doppi o in conflitto?
- **Sovrapposizioni:** il pulsante galleggiante non copre azioni, immagini o testo.
- **Misure su telefono:**
  - nessuno scorrimento orizzontale a 390 px;
  - aree toccabili ≥ 44 px, campi a 16 px (niente zoom su iPhone).
- **Stati:** caricamento, errore con «Riprova», vuoto, disabilitato con motivo.
- **Testi:** italiano corretto, termini coerenti («Creatività ads», «Post social», «Articoli»), plurali, niente inglese
  rimasto.
- **Accessibilità:**
  - focus visibile ed Esc che chiude;
  - `aria-label` sui pulsanti con sola icona;
  - contrasto ≥ 4,5:1 per i testi e 3:1 per i bordi dei campi.
- **Sicurezza percepita:**
  - Heili e l'MCP non possono approvare, inviare o programmare;
  - il link di un cliente non mostra dati di un altro.
- **Prestazioni:**
  - primo clic che va a vuoto (idratazione);
  - pagine lente con 50+ elementi.

## 4. Rapporto

Scrivi `heili-approve/docs/QA-<AAAA-MM-GG>.md` in italiano, con questa struttura:

- **Intestazione:**
  - data;
  - commit testato (`git rev-parse --short HEAD`);
  - ambiente;
  - esito delle suite;
  - conteggio per gravità.
- **Schede numerate** `QA-01`…, ordinate per gravità (Bloccante / Alta / Media / Bassa) e poi per area. Ogni scheda
  contiene:
  - **Titolo**;
  - **Gravità**;
  - **Tipo** (Errore / Usabilità / Testo / Accessibilità / Prestazioni / Sicurezza);
  - **Area**;
  - **Dove**: rotta più file e righe;
  - **Come riprodurre**, a passi numerati;
  - **Atteso / Ottenuto**;
  - **Proposta** minima, con i test da aggiungere;
  - **Schermata**, se c'è.
  Quello che non è certo va segnato «da verificare».
- **«Ordine consigliato»:** le prime 10 schede.
- **«Regole per chi corregge»:**
  - AGENTS.md;
  - test verdi;
  - mai indebolire i test;
  - un commit per scheda.
- **Sezione «Non testato e perché»:** per esempio microfono reale, Metricool vero, iOS Safari.

Alla fine riepiloga in 10 righe a chi ti ha chiesto il test:
- suite;
- quante schede, per gravità;
- le prime 10;
- percorso del file;
- `git status`, che deve mostrare solo il rapporto.
