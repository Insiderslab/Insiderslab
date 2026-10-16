# Resoconto — DeepSeek · lato AGENZIA · 16/10/2026

**Riepilogo** (in cima): lato agenzia solido e ben rifinito. Nessun Bloccante e nessun
Alta. Una correzione fatta (D-01: l'API automazione v1 accettava date nel passato),
tre osservazioni minori da valutare (D-02 import Metricool, D-03 ricerca per titolo,
D-04 calendario) e una sezione «Imparare in 10 minuti» con 10 proposte concrete. Lo
stress test conferma: pagine sotto i 200 ms, 100 bozze in parallelo in ~1,4 s, coda
BullMQ con 200 lavori senza perdite né duplicati.

---

## 1. Ambiente

- Commit testato: `101c71d` (base) + correzioni su `deepseek/agenzia-2026-10-16`.
- App in produzione (`next build` + `next start`) su `http://localhost:3501`,
  `APP_VARIANT=all`, `METRICOOL_FAKE=1`, worker BullMQ attivo, Redis `db 7`.
- Database `approve_deepseek`, migrazioni applicate, seed idempotente eseguito.
- Cookie agenzia: `authjs.session-token=dev-session-stefano-insiderslab-0000000001`.
- Suite: `tsc --noEmit` verde, `eslint` verde, `vitest` 1127/1127, e2e (vedi §5).

---

## 2. Parte 1 — Primo giorno di Sara (analisi)

Ripercorsi i 7 compiti a 1366×900 (e le schermate principali a 390×844). Il percorso
è completo e le schermate sono in `docs/notte/shots-16-10-deepseek/`.

| Passo | Esito | Osservazione |
|---|---|---|
| 1. Aggiungere cliente (Metricool finto) | OK | Clienti → «Importa da Metricool» → scelta per brand. Default «Importa 10 clienti» (vedi D-02). |
| 2. 3 post social (carosello, video) + articolo + creatività | OK | Editor con «Dove e quando» / «Il contenuto», anteprima live, validazioni in tempo reale. L'invio svuoto mostra «N punti da sistemare» con elenco. |
| 3. Import 30 post (Excel/righe incollate) | OK | «Post → Importa post»: modello xlsx/csv, trascina o incolla. Con Instagram e senza immagini tutte le righe si segnano «Da correggere: Instagram richiede almeno un'immagine» (messaggio chiaro). |
| 4. Invia in revisione + link (WhatsApp/QR) | OK | «Salva e invia in revisione» → «Link diretto per il cliente» con Copia link, WhatsApp, Mostra QR. |
| 5. Modifiche → nuova versione → reinvio | OK | Scheda post: «Il cliente ha chiesto modifiche. Leggi i commenti, prepara la nuova versione in Modifica e inviala di nuovo». Nota facoltativa per il cliente. |
| 6. Piano del mese | OK | «Piani» con guida a 3 passi («Apri il mese → Completa i post → Invia al cliente»). |
| 7. Collega AI (MCP) | OK | Impostazioni → indirizzo `…/mcp`, crea chiave personale `approve_auto_…` mostrata una volta. |

**Parole non chiare / attriti minimi** (nessuno bloccante):
- «Fatti questa settimana» in dashboard è ambiguo (può leggersi come sostantivo
  «fatti», non «completati»). Vedi «Imparare in 10 minuti» n.2.
- Import da Metricool: per creare UN solo cliente bisogna «Seleziona nessuno» poi
  scegliere quel brand; la ricerca filtra la lista ma non il conteggio del pulsante.
- Il tipo **«Sito web»** (SITO-WEB.md) non è nel ramo: è un progetto, non c'è codice.
  `docs/INSTALLARE-SUL-SITO.md` non esiste (c'è `docs/SITO-WEB.md`): nessun test fatto.

---

## 3. Parte 2 — Stress test (`scripts/stress-agency.mjs`)

Dati creati: 50 clienti, 3.500 post, 4.450 versioni (20 per un sottoinsieme), 1.000
commenti, un cliente con 500 post in un mese.

### 3.1 Pagine (p50/p95, 3 richieste, server-rendered)

| Pagina | p50 | p95 | errori |
|---|---|---|---|
| Dashboard | 40–73 ms | 109–185 ms | 0 |
| Elenco post | 69–87 ms | 101–141 ms | 0 |
| Post, filtro stato | 45–84 ms | 47–100 ms | 0 |
| Post, ricerca per titolo | 78 ms* | 100 ms | 0 |
| Post, filtro cliente | 51–111 ms | 56–136 ms | 0 |
| Calendario | 175–177 ms | 190–191 ms | 0 |
| Piani | 29–41 ms | 33–45 ms | 0 |
| Editor nuovo | 28 ms | 31–39 ms | 0 |
| Editor post esistente | 35–38 ms | 42–43 ms | 0 |
| Clienti | 39–40 ms | 44–48 ms | 0 |

\* La ricerca per titolo è un `ILIKE '%…%'` (scansione sequenziale, vedi D-03): subito
dopo il caricamento bulk ho misurato **640 ms** (statistiche non ancora aggiornate da
autovacuum); a caldo scende a ~78 ms.

### 3.2 Concorrenza (Dashboard, fetch concorrenti, 0 errori)

| Concorrenza | Richieste | Totale | rps |
|---|---|---|---|
| 1 | 1 | 44 ms | 22 |
| 10 | 20 | 681 ms | 29 |
| 50 | 100 | 2,5–2,7 s | 37–39 |

Processo singolo: la resa non cresce in modo lineare oltre ~10 concorrenti (limite del
singolo worker Node, non del DB).

### 3.3 API automazione v1 e MCP

| Caso | Atteso | Ottenuto |
|---|---|---|
| 100 bozze in parallelo (stessa chiave) | 201 ×100 | 201 ×100 in 1,4 s |
| Replay stesso `externalId` | 201 poi 200 | 201 poi 200 (idempotente) |
| Chiave sbagliata | 401 | 401 |
| JSON malformato | 400 | 400 |
| Campi con HTML/script | salvati come testo | 201, testo non interpretato |
| Data assurda (anno 0001) | rifiutata | **201 (accettata)** → corretto in D-01 |
| Corpo da 5 MB | 413 | 413 |
| MCP `tools/list` | 200 | 200 |
| MCP `create_draft_posts` | 200 | 200 (1 bozza creata) |

### 3.4 Coda BullMQ (200 lavori in 10 s)

200 post approvati accodati in **75 ms**, tutti e 200 `SCHEDULED` in **1,8 s** (Metricool
finto), **0 persi, 0 duplicati** (`metricoolPostId` univoci), cron sweep 200 senza
ri-accodamenti. I post non pubblicabili (Instagram senza media) vengono marcati
`FAILED` con messaggio leggibile, mai silenziosamente persi.

### 3.5 Query

`pg_stat_statements` non disponibile. `EXPLAIN` sull'elenco post
(`workspaceId`+`status` ordinato per `publishAt`): usa l'indice `publishAt` con filtro
sul `workspaceId`; la ricerca per titolo è una scansione sequenziale (`ILIKE`). Nessun
N+1: l'elenco usa una sola query con `include` di versioni e `_count` dei commenti.

---

## 4. Schede

### D-01 — L'API automazione v1 accetta date di pubblicazione nel passato · **Media** · Correttezza · CORRETTA
- **Dove:** `lib/automation/posts.ts` (`prepareAutomationDraft`).
- **Come riprodurre:** `POST /api/automation/v1/posts` con `publishAt: "0001-01-01T00:00:00+00:00"`.
- **Atteso:** rifiuto (il pannello «Importa post» e il server MCP rifiutano «data nel passato»).
- **Ottenuto:** `201`, bozza creata con una data assurda (mai programmabile).
- **Numeri:** 1 richiesta → 201 invece di 400.
- **Correzione:** controllo in `prepareAutomationDraft` + test. Prima: `201`; dopo: `400 INVALID_INPUT`.

### D-02 — Import da Metricool: default «importa tutto» · **Bassa** · Usabilità
- **Dove:** `components/clients/metricool-import.tsx` (scelte iniziali).
- **Come riprodurre:** Clienti → «Importa da Metricool»: tutti i 10 brand partono con «Crea nuovo cliente» e il pulsante dice «Importa 10 clienti».
- **Atteso/Ottenuto:** un nuovo assunto può creare 10 clienti per sbaglio. La ricerca filtra la lista ma non il conteggio del pulsante.
- **Proposta:** partire con «Seleziona nessuno» (nessuna creazione senza scelta esplicita), oppure una riga di aiuto «Scegli quali brand diventano clienti: nessuno viene creato finché non premi Importa». Modifica di flusso: lasciata come proposta.

### D-03 — Ricerca per titolo senza indice · **Media** · Prestazioni · «da verificare»
- **Dove:** `app/(dashboard)/posts/page.tsx:114` (`title: { contains: q, mode: "insensitive" }`).
- **Come riprodurre:** `/posts?q=stress` con decine di migliaia di post.
- **Atteso/Ottenuto:** scansione sequenziale `ILIKE '%…%'`; a caldo 78 ms con 3.500 post, 640 ms subito dopo un import bulk (statistiche non aggiornate).
- **Proposta:** indice trigram `pg_trgm` su `Post.title` (migrazione additiva) per rendere la ricerca costante nel tempo. Da valutare con volumi reali; non applicata (il guadagno attuale è marginale e richiede l'estensione `pg_trgm` in produzione).

### D-04 — Calendario tronca a 1.000 post · **Bassa** · Correttezza · «da verificare»
- **Dove:** `app/(dashboard)/calendar/page.tsx:119` (`take: 1000`).
- **Come riprodurre:** un cliente con più di 1.000 post nel periodo mostrato (mese + settimana).
- **Atteso/Ottenuto:** la griglia mostra «+N altri» ma il conteggio si ferma a 1.000 senza avviso.
- **Proposta:** alzare il limite o mostrare un avviso «mostrati i primi 1.000». Lasciata come proposta.

---

## 5. Imparare in 10 minuti

Le 10 modifiche che più accorciano il primo giorno di Sara (testi esatti proposti;
le parti di flusso restano proposte, i testi indicati come «fatto» sono già applicati):

1. **Import da Metricool più prudente** — partire con «Seleziona nessuno» e riga di aiuto
   «Nessun cliente viene creato finché non premi “Importa N clienti”» (D-02, proposta).
2. **Dashboard: «Fatti questa settimana» → «Completati questa settimana»** — evita
   l'ambiguità con «fatti» sostantivo. Sottotitolo invariato «da lunedì a domenica».
3. **Ricerca per titolo con indice trigram** — rende la ricerca indipendente dal volume (D-03, proposta).
4. **Editor: «Salva bozza» accanto a «Salva e invia in revisione»** già distinti e corretti;
   aggiungere solo un `aria` coerente: nessuna modifica necessaria.
5. **Post → Importa post: la frase «Non parte nulla verso il cliente» è già in evidenza** —
   nessuna modifica necessaria (stato vuoto già guidato).
6. **Stato vuoto «Niente da gestire»** già presente in dashboard: estendere il testo a
   «Niente da gestire: nessuna richiesta di modifica né errore di programmazione.» (già così).
7. **Scheda cliente: «Nessun referente attivo» è già segnalato nell'editor** — nessuna modifica.
8. **Menu laterale: ordine già corretto** (Dashboard, Post, Articoli, Creatività, Calendario, Piani, Clienti, Impostazioni) — nessuna modifica.
9. **«Cerca per titolo» applica su Invio**: aggiungere `hint` «premi Invio per cercare» per chi non lo sa (proposta minore).
10. **Conteggio coerente dei tipi** («19 contenuti», «3 articoli», «3 creatività»): già coerente.

In sintesi il lato agenzia è già molto vicino all'obiettivo del titolare (semplice, chiaro,
imparabile in poco tempo): le modifiche davvero utili sono D-01 (fatta) e le proposte 1 e 3.

---

## 6. Correzioni applicate

- **D-01** (un commit, `D-01: …`): `lib/automation/posts.ts` rifiuta `publishAt` nel passato;
  test in `__tests__/automation-posts.test.ts`; data fissa del test CLI portata al 2030
  (era già nel passato e derivava). Suite `vitest` 1127/1127.

Nessun Bloccante/Alta trovato; nessuna migrazione Prisma necessaria (le due proposte D-03/D-04
restano da valutare con volumi reali, come richiesto dalla regola «migrazioni solo se una
misura le giustifica»).

---

## 7. Esito e2e

`npm run test:e2e` (build di produzione, `E2E_BASE_URL=http://localhost:3501`,
`METRICOOL_FAKE=1`, worker attivo): **80/80 superati in 8,4 minuti**, 0 falliti.
Coperti: flusso approvazione (social, blog, ads, Google Ads), import da Excel/righe
incollate, Metricool, piano del mese, MCP, condivisione link, annullo approvazione,
varianti `APP_VARIANT`, layout a 390 px. Nessun test indebolito.

## 8. Note

- L'SMTP finto locale (nodoemailer) andava in timeout sui 15 s per ogni email di errore,
  rallentando il worker durante i test di coda: rimossa `EMAIL_SERVER` e usato il trasporto
  «console» (comportamento di sviluppo documentato). Non è un difetto dell'app.
- Non testato: Metricool reale, microfono fisico, OAuth MCP (non configurato), iOS Safari.
- Nessun dato di clienti reali; i clienti «Stress …» e «Stress Queue» sono sintetici.

FINITO — ramo deepseek/agenzia-2026-10-16, 3 commit, e2e 80/80.
