# Lavoro per Kimi — 16/10/2026: stress test e semplicità del lato CLIENTE

Sei un esperto di usabilità e QA. Oggi metti alla prova **il portale del cliente** di Approve by Heili
(`app/review/[token]/…`) come lo userebbe una persona non tecnica, da telefono, con fretta. Obiettivo del titolare:
**la piattaforma deve essere semplice, chiara e facile da imparare in pochi minuti**, e reggere l'uso intenso.

DeepSeek, in parallelo, lavora sul lato AGENZIA (`docs/notte/DEEPSEEK-2026-10-16-AGENZIA.md`): non toccare le sue
pagine (`app/(dashboard)/…`, `components/posts/*`, `components/clients/*`, import, impostazioni).

## Regole (non negoziabili)

1. Leggi e segui `AGENTS.md`, `docs/CONTRATTO.md`, `docs/STUDIO-DESIGN.md` e la skill
   `.claude/skills/approve-qa/SKILL.md` (avvio dell'app, porte, finti servizi, cookie di sviluppo).
2. Branch tuo: `git fetch origin && git checkout -b kimi/cliente-2026-10-16 origin/claude/bold-lovelace-xdiiw9`.
   Push **solo** su `kimi/cliente-2026-10-16`. Mai su `claude/bold-lovelace-xdiiw9` o `main`, niente deploy.
3. **Segreti:** mai `git add -A` né `git add .`. Aggiungi i file uno per uno e controlla `git status` prima di ogni
   commit. Mai committare `.env`, `.env.*`, `dump.rdb`, `__pycache__`, chiavi o token. (Il 12/10 una chiave è finita
   in un ramo pubblico: la CI ora blocca il push, ma il danno lo fa il push stesso.)
4. Niente migrazioni Prisma, niente `app/generated/`, niente modifiche a `components/voice/*` o alla parte vocale
   di `components/review/assistant-panel.tsx` (Claude l'ha appena corretta).
5. Un commit per attività con l'id in testa (`K-03: …`), push dopo ogni commit. Prima di ogni commit:
   `npx tsc --noEmit`, `npx eslint <file toccati>`, `npx vitest run --maxWorkers=4` verdi. Mai indebolire i test.
6. **Heili non approva, non invia, non programma, non cancella.** Può parlare, aiutare a scrivere il feedback,
   preparare il riepilogo e portare il cliente a una pagina del suo portale.
7. Testi in italiano, stati sempre con una parola, campi 16 px, aree toccabili 44 px, niente scorrimento
   orizzontale a 390 px, niente emoji o gradienti.
8. Resoconto in `docs/notte/KIMI-2026-10-16-RESOCONTO.md`, aggiornato dopo ogni attività (riepilogo in cima).

## Parte 1 — Analisi (prima di scrivere codice)

Avvia l'app con la build di produzione e i dati del seed. Poi recita **tre persone**, sempre a 390×844 (telefono)
e una volta a 1366×900:

- **Marta, 58 anni, titolare di un ristorante**: apre il link da WhatsApp, non ha mai visto Approve.
- **Luca, marketing manager**: deve approvare 40 contenuti del mese in 10 minuti.
- **Giulia**: vuole chiedere una modifica precisa su una foto e su un passaggio di un articolo, a voce.

Per ognuna misura e annota (con schermate in `docs/notte/shots-16-10-kimi/`):

- **Tempo per capire**: quanti secondi servono per sapere cosa fare? Cosa guarda per primo? C'è una parola che
  non capisce?
- **Passi**: quanti tocchi per approvare un post, per chiedere una modifica, per approvare tutto il mese?
- **Errori possibili**: può approvare per sbaglio? Capisce «Annulla»? Capisce che la modifica è stata inviata?
- **Heili**: il pulsante si trova? Si apre sempre al primo tocco (anche dopo cambio pagina, dopo «Chiedi modifiche»,
  dopo «Approva» e «Annulla»)? La Guida aiuta davvero? La voce e la dettatura danno sempre un riscontro?
- **Sito web** (se presente nel ramo: tipo di contenuto nuovo «Sito web», con «Apri il sito» e «Sul sito»):
  il cliente capisce come lasciare una nota su un elemento del sito?

## Parte 2 — Stress del portale

- Un cliente con **300 contenuti** nel mese (crea i dati con uno script in `scripts/`, non nel seed): Panoramica,
  Griglia e Sfoglia restano fluide? Tempo al primo tocco utile con CPU rallentata 4× (Playwright)?
- **Tocchi ripetuti**: doppio tocco su «Approva», «Approva tutto il piano», «Annulla» al nono secondo, «Chiedi
  modifiche» con rete lenta (Playwright `route` con ritardo 3 s) e senza rete: nessun doppione, messaggi chiari,
  «Riprova».
- **Testi estremi**: commento di 5.000 caratteri, solo emoji, HTML/script incollato, link lunghissimi.
- **Due dispositivi**: lo stesso link aperto su due schede; si approva in una, l'altra si aggiorna o lo dice?

## Parte 3 — Rapporto e correzioni

1. Scrivi in cima al resoconto le schede `K-01…` ordinate per gravità (Bloccante, Alta, Media, Bassa), ognuna con:
   dove (rotta e file), come riprodurre, atteso/ottenuto, proposta, schermata.
2. Aggiungi la sezione **«Imparare in 2 minuti»**: le 10 modifiche che più accorciano il tempo per capire il portale,
   con il testo esatto proposto per bottoni, titoli e messaggi.
3. Poi **correggi** tu, un commit per scheda, in quest'ordine: Bloccanti, Alte, poi le modifiche di testo e di
   chiarezza della sezione «Imparare in 2 minuti» che non cambiano il flusso. Le modifiche di flusso (cosa succede
   dopo un tocco) lasciale come proposta per il titolare.
4. Alla fine esegui l'intera suite e2e (`npm run test:e2e`, vedi la skill) e scrivi nel resoconto l'esito.

Quando hai finito, l'ultima riga del resoconto è: `FINITO — ramo kimi/cliente-2026-10-16, N commit, e2e X/Y`.
