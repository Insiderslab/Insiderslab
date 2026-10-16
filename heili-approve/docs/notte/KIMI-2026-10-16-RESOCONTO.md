# Resoconto 16/10/2026 — stress test e semplicità del portale CLIENTE

Eseguito al posto di Kimi (non raggiungibile da questo ambiente) da Claude, sul brief
`KIMI-2026-10-16-CLIENTE.md`. Gli id `K-xx` sono quelli del brief. Ramo di lavoro: `worktree-agent-a29826a892322dfcd`
(da `claude/bold-lovelace-xdiiw9` @ `6bfc30a`), niente push.

## Riepilogo

- **8 schede corrette** (K-01…K-08, un commit ciascuna) e **7 lasciate come proposta/nota** (K-09…K-15: cambiano
  la disposizione o il flusso, toccano file di Heili appena corretti o l'area agenzia).
- Per gravità: **Bloccanti 0 · Alte 1 · Medie 7 · Basse 6 · Note 1**.
- Il portale **regge bene i 300 contenuti** (numeri sotto). Il difetto grave trovato è un altro: **senza rete «Approva» e
  «Chiedi modifiche» restavano bloccati per sempre** (K-01, corretto).
- Heili: il pulsante si apre **al primo tocco in tutti i casi provati** (prima dell'idratazione, dopo cambio pagina,
  dopo «Chiedi modifiche», dopo «Approva», dopo «Annulla»).
- «Sito web»: saltato (non è ancora nel ramo).
- Verifica finale: vedi l'ultima riga.

## Ambiente e metodo

- Build di produzione, Postgres e Redis locali, database `approve_cliente` (nuovo), app su 3601, worker con
  `METRICOOL_FAKE=1`, server con Heili e finto provider AI su 3603 (e2e: 3602/3603). Chromium di Playwright a
  390×844 (telefono, tocco) e 1366×900.
- **Il server ha 4 CPU condivise con altri agenti che lavoravano in parallelo: i tempi sotto sono indicativi, non
  assoluti.** «CPU 4×» = `Emulation.setCPUThrottlingRate` a 4 sopra questo carico.
- Dati di stress: `scripts/create-stress-client.ts` (K-00): un cliente con 300 post Instagram di un mese, tutti da
  rivedere (nota: `submitForReview` accetta al massimo 200 post per volta, quindi un **piano** non può contenerne 300;
  il portale li offre come «Rivedi tutto dicembre insieme»).
- Schermate (prima delle correzioni) in `docs/notte/shots-16-10-kimi/`.

## Parte 1 — Le tre persone

| | Marta, 58 anni (link da WhatsApp) | Luca (40 contenuti in 10 minuti) | Giulia (modifica precisa a voce) |
|---|---|---|---|
| Primo sguardo | Saluto, «Ci sono 7 post che aspettano la tua approvazione», un solo pulsante scuro «Rivedi il piano del mese». Bene. | Piano: la barra in basso offre subito «Approva tutto il piano (6)». | Pagina del post: «Tocca un punto dell'immagine…», «Cosa ne pensi? Scrivilo oppure dettalo». Chiaro. |
| Parola che non capisce | «Metricool» nel foglio di approvazione (K-03); «Elenco» (K-08); «Richieste raccolte» (K-08) | «modalità veloce» / «uno per uno» / «Sfoglia» sono lo stesso percorso o no? (K-05) | «Invia» in Heili: va a Heili o all'agenzia? (K-12) |
| Tocchi | Approvare un post: **2** (Approva, «Sì, approva»). Chiedere una modifica: **3** + testo (freccia, poi «Chiedi modifiche»). | Dal piano a Sfoglia **2**, poi **1 per post** (Approva, nessuna conferma; toast 10 s). 40 post = 42 tocchi, oppure **2** con «Approva tutto il piano». | Foto: tocco sul punto + testo + freccia + «Chiedi modifiche». Articolo: selezione + «Commenta questa frase». |
| Errori possibili | Approvare per sbaglio: il foglio di conferma lo impedisce. «Annulla» ambiguo (K-06). Chiedi modifiche senza commenti: messaggio chiaro («Non hai ancora indicato modifiche…»). | Doppio tocco: **un solo** evento APPROVED. «Annulla» al nono secondo: funziona, il post torna «Da approvare». | Commento non inviato + Approva: bloccato con messaggio chiaro. |
| Heili | Il pulsante si trova (angolo in basso a destra, «?» sull'icona dove è solo Guida). Il fumetto «Ciao, sono Heili» copre per 6 s parte del testo, solo alla prima visita. | Apre al primo tocco anche dopo cambio pagina e dopo Annulla. | Feedback e Guida si aprono; con la voce spenta la scheda mostra comunque «1 Parla · 2 Controlla · 3 Aggiungi» (K-12). La dettatura risponde «Ti ascolto…». |

A 1366×900 il portale è ordinato (anteprima e feedback affiancati, barra «Chiedi modifiche / Approva» in basso);
nessuna sovrapposizione col pulsante di Heili.

## Parte 2 — Stress del portale

**300 contenuti** (cliente «Stress 300», dicembre 2026). CPU condivisa; 1× = nessun rallentamento aggiunto.

| Pagina | CPU 1× | CPU 4× | Note |
|---|---|---|---|
| Home (300 card) | 0,75 s | 1,8 s | 4.614 nodi, 64.000 px di altezza, immagini `lazy` (K-11) |
| Panoramica / Griglia del mese | 0,6 / 0,5 s | 1,0 / 1,0 s | 1.700 nodi, 300 immagini `lazy` |
| Sfoglia | 1,0 s | 1,2 s | 250 nodi; «Successivo» 230–370 ms a 4× |
| Tocco su «Rivedi tutto dicembre insieme» fino alla pagina | — | 1,7 s | |
| Scorrimento 3 s della griglia | — | 149 fotogrammi, **0 oltre 50 ms** | |

Resta fluido: **nessuna correzione necessaria** (K-11 è solo una proposta di ordine).

**Tocchi ripetuti e rete** (post singoli, 390 px):
- Doppio tocco su «Sì, approva»: 1 approvazione. Approva due volte da due schede: la seconda è idempotente («Fatto!»).
- «Annulla» al nono secondo: il toast c'è ancora, il post torna `IN_REVIEW`, evento `APPROVAL_UNDONE`.
- «Chiedi modifiche» con POST ritardati di 3 s: «Invio…» disabilitato, secondo tocco ignorato, **un solo** `CHANGES_REQUESTED`.
- **Senza rete: «Sì, approva» restava su «Approvazione…» e «Chiedi modifiche» su «Invio…» per sempre, senza messaggio
  né «Riprova»** (K-01).

**Testi estremi** (commento): solo emoji e 5.000 caratteri senza spazi: ok; HTML/`<script>`/`onerror`: mostrato come testo,
nessun dialog eseguito; **link lunghissimo o 5.000 caratteri senza spazi: pagina larga 2.670 px a 390 px** (K-02).
Il campo taglia a 5.000 caratteri.

**Due dispositivi**: la seconda scheda non si aggiorna da sola; al primo tentativo dice «L'agenzia ha aggiornato questo post»
(falso: era la mia approvazione) (K-04). Il tentativo di commentare è comunque rifiutato con «Questo post è già stato approvato».

## Parte 3 — Schede per gravità

### Bloccanti
Nessuno.

### Alte

**K-01 — Senza rete «Approva» e «Chiedi modifiche» restano bloccati per sempre** — *corretto (4da504f)*
- Dove: `components/portal/post-review.tsx` (`confirmApprove`, `requestSavedChanges`), `blog-review.tsx`, `ads-review.tsx`,
  `plan-review.tsx`, `month/browse.tsx`; tutte `await` di un'azione server senza `try/catch`.
- Come riprodurre: apri un post, tocca «Approva», disattiva la rete, tocca «Sì, approva».
- Atteso: messaggio e possibilità di riprovare. Ottenuto: foglio fermo su «Approvazione…» (non si chiude: è `busy`),
  nessun messaggio; idem «Invio…» su «Chiedi modifiche»; solo il ricaricamento sblocca.
- Correzione: `components/portal/safe-actions.ts` trasforma l'eccezione in `{ ok: false, error }`; le pagine mostrano
  «Non riesco a collegarmi: controlla la connessione e riprova. Quello che hai scritto è ancora qui.» e restano usabili.
- Schermate: `luca-20-offline-approve.png`, `luca-21-offline-changes.png` (prima). Test: `__tests__/safe-actions.test.ts`,
  `e2e/portal-resilience.spec.mjs`.

### Medie

**K-02 — Un commento con una parola lunghissima allarga la pagina** — *corretto (413116f)*
- Dove: `comment-list.tsx` e altri testi dell'utente nel portale; colonne della griglia di `post-review.tsx`.
- Riprodurre: incolla un link di 1.000 caratteri nel commento e invialo. Atteso: va a capo. Ottenuto: scorrimento
  orizzontale (2.670 px a 390 px). Correzione: `overflow-wrap:anywhere` e `min-w-0`. Schermata: `giulia-40-comment-longlink.png`.

**K-03 — Il cliente legge «verrà programmato su Metricool»** — *corretto (85852d1)*
- Dove: `post-review.tsx` (`scheduleSentence`), foglio «Approvi questo post?» e pannello «Fatto!».
- Ora: «Il post verrà programmato per mercoledì 21 ottobre alle 08:30.» Schermata: `luca-10-sheet-approva.png` (prima).

**K-04 — Lo stesso link su due dispositivi: «L'agenzia ha aggiornato questo post»** — *corretto (b649fe2, testo)*
- Ora: «Questo post è cambiato nel frattempo: l'ha aggiornato l'agenzia, oppure lo hai già rivisto da un altro dispositivo.»
  (anche articoli, annunci, Sfoglia). Schermata: `giulia-42-two-tabs-changes.png`.
- **Proposta (flusso)**: aggiornare la pagina da sola quando torna in primo piano (`visibilitychange` → `router.refresh()`),
  così la barra «Approva» non resta su un contenuto già deciso.

**K-05 — Tre nomi per lo stesso percorso del piano** — *corretto (407df29)*
- «Rivedi in modalità veloce», «Rivedi veloce (Sfoglia)» (Heili), scheda «Sfoglia»; e «Rivedi uno per uno» sembrava un sinonimo.
- Ora: «Sfoglia i post, uno alla volta» (pulsante e scorciatoia di Heili) e «Apri il primo post».

**K-06 — «Annulla» vuol dire due cose opposte** — *corretto (b811cf8)*
- Nel foglio chiude («non approvare»), nel toast ritira l'approvazione. Ora il toast dice «Annulla l'approvazione»
  (a 360 px va a capo sotto «Approvato · 9 s»). Schermata: `luca-11-approved-toast.png` (prima).

**K-07 — La Guida di Heili parla come un'altra pagina** — *corretto (7a38915)*
- «Rivedere il piano del mese» citava Elenco/Anteprima Instagram, mentre in alto ci sono Panoramica, Griglia, Sfoglia; due
  voci avevano passi da 400+ caratteri. Riscritte; test `help-guide` limita i passi a 330 caratteri e vieta «Metricool».

**K-09 — Piano a telefono: nella prima schermata c'è solo «Approva tutto il piano»** — *proposta*
- Dove: `app/review/[token]/piani/[planId]/page.tsx` + `plan-review.tsx`. Il messaggio dell'agenzia (8 righe) spinge
  «Sfoglia i post, uno alla volta» e «Apri il primo post» sotto la piega; resta visibile solo la barra fissa «Approva tutto il
  piano (6)». Proposta: messaggio a 4 righe con «Leggi tutto». Schermata: `marta-02-plan.png`.

### Basse

**K-08 — Parole che il cliente non usa** — *corretto (cef52fd)*: «Elenco» (telefono) → «Tutti i post»; «Richieste raccolte» → «Commenti salvati».

**K-10 — Prima visita sulla pagina di un post: i tre passi spingono il post sotto la piega mentre «Approva» è già visibile** — *proposta*
- `components/portal/portal-intro.tsx`. Non si approva per sbaglio (c'è il foglio di conferma), ma Marta vede «Approva»
  prima del contenuto. Proposta: una riga compatta sotto il post, o i tre passi dopo l'anteprima. Schermata: `marta-03-post.png`.

**K-11 — Home con 300 contenuti: 300 card in 64.000 px** — *proposta*
- `app/review/[token]/page.tsx`. Fluida (vedi tabella) ma lunga. Proposta: i primi 20 di «Da approvare» e «Mostra gli altri 280».
  Schermata: `stress-300-home.png`.

**K-12 — Heili: «Invia» è ambiguo e la scheda «Parla a voce» spenta mostra 3 passi inutili** — *proposta*
- `components/review/assistant-panel.tsx` (righe ~927 e ~1126). Lasciato per non toccare Heili appena corretto.
  Proposte: «Invia» → «Scrivi a Heili»; con la voce spenta: «La conversazione a voce non è disponibile per questo contenuto: scrivi o
  detta il messaggio qui sotto.» senza i passi 1-2-3 e senza «su questo servizio». Schermata: `giulia-50-3-after-chiedi-modifiche.png`.

**K-13 — Nel piano «Griglia» (in alto) e «Anteprima Instagram» (sotto) sono la stessa cosa** — *proposta*
- `components/plans/plan-bits.tsx`, condiviso con l'agenzia (STUDIO-DESIGN usa «Anteprima Instagram» lì): da decidere con il titolare.

### Note

**K-14 — Un piano non può avere più di 200 post** (`submitForReview`: «Puoi inviare al massimo 200 post alla volta»).
Il messaggio è chiaro per l'agenzia; per 300 post il portale offre già «Rivedi tutto il mese insieme». Nessuna azione.

**K-15 — Agenzia: i link «← Precedenti» / «Successivi →» dell'elenco post sono alti 20 px a 390 px** — *proposta (area agenzia, non toccata)*
- `app/(dashboard)/posts/page.tsx` (~righe 250-262). Compare quando i post superano una pagina: con 776 post nel database di
  prova `e2e/agency-touch.spec.mjs` fallisce («Successivi →» 89×20). Proposta: `inline-flex min-h-11 items-center`.
  Con il database ripulito dai dati di stress l'intera suite e2e passa.

## «Imparare in 2 minuti» — le 10 modifiche che più accorciano il tempo per capire

1. **[fatto K-01]** Rete assente: «Non riesco a collegarmi: controlla la connessione e riprova. Quello che hai scritto è ancora qui.»
2. **[fatto K-03]** Foglio di conferma: «Il post verrà programmato per mercoledì 21 ottobre alle 08:30.» (mai nomi di strumenti).
3. **[fatto K-06]** Toast: «Approvato · 9 s» + «Annulla l'approvazione».
4. **[fatto K-05]** Piano: «Sfoglia i post, uno alla volta» e «Apri il primo post»; Heili dice lo stesso.
5. **[fatto K-04]** Avviso dopo un cambio: «Questo post è cambiato nel frattempo: l'ha aggiornato l'agenzia, oppure lo hai già rivisto da un altro dispositivo.»
6. **[fatto K-07]** Guida, piano: «Panoramica: l'elenco dei post. Griglia: i post Instagram uno accanto all'altro, come sul profilo. Sfoglia: un post alla volta, con Approva e Commenta.»
7. **[fatto K-08]** «Tutti i post» al posto di «Elenco» e «Commenti salvati» al posto di «Richieste raccolte».
8. **[proposta K-12]** In Heili: «Scrivi a Heili» al posto di «Invia»; con la voce spenta: «La conversazione a voce non è disponibile per questo contenuto: scrivi o detta il messaggio qui sotto.»
9. **[proposta K-09]** Piano: messaggio dell'agenzia a 4 righe + «Leggi tutto», così «Sfoglia i post, uno alla volta» è nella prima schermata.
10. **[proposta K-10]** Prima visita sul post: una riga «Come funziona: Guarda · Approva o scrivi cosa cambiare · Fatto» sotto l'anteprima, non sopra, con «Ho capito».

## Cosa lascio al titolare (flusso o disposizione)

K-04 (aggiornamento automatico al ritorno in primo piano), K-09, K-10, K-11, K-12, K-13, K-15. Nessuna è bloccante.

## Non testato e perché

Microfono e dettatura reali (Chromium simula «Ti ascolto…»), voce GPT-Live, iOS Safari e Android Chrome reali,
Metricool vero, email vere, rete mobile reale (offline simulato con Playwright), «Sito web» (non nel ramo).

## Commit

K-00 `e82d3c4` · K-01 `4da504f` · K-02 `413116f` · K-03 `85852d1` · K-04 `b649fe2` · K-06 `b811cf8` · K-05 `407df29` ·
K-07 `7a38915` · K-08 `cef52fd`.

## Esito

- `npx tsc --noEmit`: 0 errori. `npx eslint .`: 0 errori, 0 avvisi. `npx vitest run --maxWorkers=2`: 1.173 test, 87 file, tutti verdi.
- Suite e2e completa (`npm run test:e2e`, database ripulito): **102/102** (8,4 min, con CPU condivisa).
  Il nuovo `e2e/portal-resilience.spec.mjs` ha 8 prove (K-01…K-06, K-08); ho visto i difetti a mano prima di correggerli
  (blocco offline, pagina larga 2.670 px, testi vecchi).
- Spec esistenti adattate solo per i testi cambiati: `undo-approval` («Annulla l'approvazione»), `portal-layout` («Apri il primo post»).

FINITO — ramo worktree-agent-a29826a892322dfcd, 9 commit (K-00…K-08) più questo resoconto, e2e 102/102
