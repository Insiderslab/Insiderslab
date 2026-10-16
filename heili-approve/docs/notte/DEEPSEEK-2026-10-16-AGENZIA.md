# Lavoro per DeepSeek — 16/10/2026: stress test e semplicità del lato AGENZIA

Sei un esperto di QA, prestazioni e usabilità. Oggi metti alla prova **la parte dell'agenzia** di Approve by Heili
(`app/(dashboard)/…`) e le sue API, come la userebbe un social media manager nuovo il primo giorno e come la
stresserebbe un'agenzia con molti clienti. Obiettivo del titolare: **semplice, chiara, facile da imparare in poco
tempo**, e solida sotto carico.

Kimi, in parallelo, lavora sul lato CLIENTE (`docs/notte/KIMI-2026-10-16-CLIENTE.md`): non toccare il portale
(`app/review/…`, `components/portal/*`, `components/review/*`, `components/voice/*`).

## Regole (non negoziabili)

1. Leggi e segui `AGENTS.md`, `docs/CONTRATTO.md`, `docs/STUDIO-DESIGN.md` e la skill
   `.claude/skills/approve-qa/SKILL.md` (avvio dell'app, porte, finti servizi, cookie di sviluppo
   `authjs.session-token=dev-session-stefano-insiderslab-0000000001`).
2. Branch tuo: `git fetch origin && git checkout -b deepseek/agenzia-2026-10-16 origin/claude/bold-lovelace-xdiiw9`.
   Push **solo** su `deepseek/agenzia-2026-10-16`. Mai su `claude/bold-lovelace-xdiiw9` o `main`, niente deploy.
3. **Segreti:** mai `git add -A` né `git add .`. Aggiungi i file uno per uno e controlla `git status` prima di ogni
   commit. Mai committare `.env`, `.env.*`, `dump.rdb`, `__pycache__`, chiavi o token.
4. Migrazioni Prisma **solo additive** (indici, colonne nullable) e solo se una misura le giustifica; scrivi nel
   resoconto il prima/dopo. Niente `app/generated/`.
5. Un commit per attività con l'id in testa (`D-04: …`), push dopo ogni commit. Prima di ogni commit:
   `npx tsc --noEmit`, `npx eslint <file toccati>`, `npx vitest run --maxWorkers=4` verdi. Mai indebolire i test.
6. **Sicurezza:** l'MCP e le chiavi `approve_auto_` creano solo bozze: mai approvare, inviare o programmare. Un
   cliente non deve mai vedere dati di un altro. Se trovi un buco di sicurezza, scheda **Bloccante** e correzione
   subito, con test.
7. Testi in italiano, stati sempre con una parola, campi 16 px, aree toccabili 44 px, niente scorrimento
   orizzontale a 390 px.
8. Resoconto in `docs/notte/DEEPSEEK-2026-10-16-RESOCONTO.md`, aggiornato dopo ogni attività (riepilogo in cima).

## Parte 1 — Primo giorno di un social media manager (analisi)

A 1366×900 e a 390×844, recita **Sara, appena assunta**, che senza spiegazioni deve:

1. aggiungere un cliente (anche importandolo da Metricool in modalità finta);
2. creare 3 post social (uno carosello, uno video), 1 articolo, 1 creatività ads (anche Google Ads);
3. importare 30 post da Excel e da righe incollate;
4. inviare in revisione e mandare il link al cliente (WhatsApp/QR);
5. leggere le richieste di modifica, fare la nuova versione, rimandare;
6. preparare e inviare il piano del mese;
7. collegare la sua AI con l'MCP (Impostazioni).

Per ogni passo annota: secondi per capire dove andare, parole non chiare, passaggi superflui, stati vuoti senza
indicazioni, errori senza «Riprova». Schermate in `docs/notte/shots-16-10-deepseek/`. Se nel ramo c'è il tipo
nuovo **«Sito web»** (riga di codice/plugin «Sul sito»), prova anche: crea il sito, copia la riga, «Verifica
installazione», leggi le note del cliente con «Apri nel punto», e giudica se le istruzioni di installazione
(`docs/INSTALLARE-SUL-SITO.md`) bastano a una persona non tecnica.

## Parte 2 — Stress test (numeri, non impressioni)

Crea dati grandi con uno script `scripts/stress-agency.mjs` (non nel seed): 50 clienti, 3.000 post, un cliente con
500 post in un mese, 1.000 commenti, 20 versioni per post. Poi misura e metti in tabella p50/p95/errori:

- pagine: dashboard, elenco post con ogni filtro e ricerca, calendario, piano del mese, editor, clienti;
- con 1, 10 e 50 richieste contemporanee (`npx autocannon` o uno script Node con fetch concorrenti);
- API: `docs/AUTOMATION-API.md` e MCP (`POST /mcp`): 100 bozze create in parallelo con la stessa chiave,
  chiave sbagliata, chiave revocata, corpo di 5 MB, JSON malformato, campi con HTML/script, date assurde;
- import: file da 2.000 righe, colonne mancanti, separatore `;`, date italiane, celle vuote, righe duplicate;
- coda BullMQ: 200 approvazioni in 10 secondi (Metricool finto) → nessun lavoro perso o doppio, cron sweep ok;
- query: log di Prisma o `pg_stat_statements`, cerca N+1 e query senza indice.

## Parte 3 — Rapporto e correzioni

1. In cima al resoconto le schede `D-01…` per gravità, ognuna con: dove (rotta e file), come riprodurre,
   atteso/ottenuto, numeri, proposta.
2. Sezione **«Imparare in 10 minuti»**: le 10 modifiche che più accorciano il primo giorno di Sara (testi esatti
   proposti, ordine del menu, scorciatoie, esempi pronti, stati vuoti che spiegano il passo successivo).
3. **Correggi** tu, un commit per scheda: tutte le Bloccanti e Alte, le Medie di prestazioni con numeri prima/dopo,
   e i testi/stati vuoti della sezione «Imparare in 10 minuti». Le modifiche di flusso grandi lasciale come proposta.
4. Alla fine esegui l'intera suite e2e (`npm run test:e2e`) e scrivi l'esito nel resoconto.

Quando hai finito, l'ultima riga del resoconto è:
`FINITO — ramo deepseek/agenzia-2026-10-16, N commit, e2e X/Y`.
