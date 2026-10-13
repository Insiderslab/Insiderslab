# Resoconto notturno Kimi — 12/10/2026

Branch: `kimi/notte-2026-10-12` (da `origin/claude/bold-lovelace-xdiiw9`).

## Riepilogo (aggiornato alla fine)

- Attività fatte: 0
- Saltate / non riuscite: 0
- Cosa deve controllare Claude domattina: in corso.

## Verifica della base (prima delle modifiche)

- `npx prisma generate` necessario: il client generato mancava dopo `npm ci` (errore TS2307 su `@/app/generated/prisma/client`). Dopo la generazione `npx tsc --noEmit` = 0 errori.
- `npx vitest run`: al primo giro 3–4 test falliti, **causa ambiente, non codice**:
  - `__tests__/automation-cli.test.ts` lancia l'eseguibile `python`, assente sul PATH di questo PC (presente solo `py`, Python 3.14.4). Aggiungendo `C:\Users\stefa\AppData\Local\Python\pythoncore-3.14-64` al PATH il test passa. Nessuna modifica al test.
  - `month-review.test.ts` e `plans.test.ts` fallivano solo sotto carico parallelo nel primo run; in isolamento e nel run completo successivo sono verdi.
- **Base finale verificata verde: 965/965 test, 59 file; tsc 0 errori.**

## ⚠️ INCIDENTE DA GESTIRE (priorità per Claude/Stefano)

Nel commit `05f424a` (K-05) ho committato per errore, con un `git add -A` troppo ampio, la cartella `qc-contenuti/`
(che era untracked alla radice del repo): file `__pycache__` **e `qc-contenuti/.env` con dentro una vera chiave
`TYPESAFE_API_KEY`**. Rimossa subito con il commit `98b6266`, ma la chiave **resta nella history del branch**
(`05f424a`) che è pubblico su GitHub. Da fare:
1. **Ruotare/revocare subito la chiave TypeSafe** (è compromessa).
2. Ripulire la history del branch (BFG o rebase + force-push): serve una decisione di Stefano, io non faccio
   rewrite della history.
Regola autoimposta dopo l'incidente: mai più `git add -A`; solo pathspec espliciti sui file dell'attività.

## Decisioni prese in autonomia

- Shim Python non aggiunto al repo: risolto solo a livello di ambiente della shell (PATH), senza toccare test o codice.

## Attività

### QA-01 — FATTA (commit 9b55e61)
- Problema: `loadSheet` chiamava `scheduleCheck(next, files)` con la closure obsoleta: foglio+immagini trascinati insieme → controllo server senza immagini → righe rosse false. Variante: dopo una modifica, un clic rapido su «Crea» si fidava di esiti vecchi.
- Fix: `loadSheet(parsed, label, filesNow)` riceve i file già uniti (`merged` da `handleFiles`); le righe senza esito server sono «Controllo…» (chip neutro + `data-state="checking"`), il riepilogo mostra «Controllo le righe…» e «Crea» resta disabilitato finché ogni riga inviabile ha un esito.
- File: `components/posts/import/import-wizard.tsx`, `components/posts/import/import-row.tsx`, `e2e/post-import.spec.mjs`.
- Test: rafforzato l'e2e «il modello compilato si rilegge» (attende l'esito del controllo server e verifica che la riga resti pronta senza «Immagine non trovata»). Nessun test RTL aggiunto: l'ambiente vitest è `node` e `@testing-library` non è installata (non installo dipendenze). e2e non rieseguiti stanotte (opzionali; richiedono build+DB+Redis): da rilanciare domattina.
- Verifiche: tsc 0, eslint 0, vitest 965/965.

### QA-02 — FATTA (commit d35c607)
- Problema: si può inviare un piano/post a un cliente con autoSchedule attivo ma senza brand Metricool: nessun avviso, il cliente riceve promesse («Uscirà il …») e i post finiscono in «Errore».
- Decisione (documentata): avviso **non bloccante** invece di rifiuto — un blocco impedirebbe invii legittimi fatti consapevolmente; l'avviso in tre punti (messaggio post-invio, banner + conferma nella pagina piano) risolve il danno reale (l'agenzia lo scopre prima dell'approvazione) e i testi del portale non promettono più la data quando la programmazione non può partire.
- Fix:
  - `submitForReview` restituisce `clientsWithoutScheduling` (clienti con autoSchedule && !metricoolBlogId); `sendPlan` lo propaga in `SendPlanResult`.
  - `submitFollowUp` (components/share/messages.ts) accetta `clientsWithoutScheduling` e aggiunge «Attenzione: … non ha un brand Metricool collegato…»; usato da `submitForReviewAction` e `sendPlanAction` (anche nel caso linkOnly, dove prima il follow-up spariva).
  - Pagina piano: banner giallo con link alla scheda cliente (prop `schedulingWarning` a `PlanEditor`, ripetuto nella conferma «Invia ora N post»).
  - Portale: nuovo flag `schedulingOn` (= autoSchedule && brand presente) su `PortalClient`/`PortalPlan`/prop di `Browse`; i testi «verranno programmati / Uscirà …» compaiono solo se `schedulingOn`, altrimenti la forma onesta «l'agenzia li programmerà» (già esistente).
- File: lib/posts.ts, lib/plans.ts, components/share/messages.ts, app/(dashboard)/posts/actions.ts, app/(dashboard)/plans/actions.ts, app/(dashboard)/plans/[id]/page.tsx, components/plans/plan-editor.tsx, components/portal/types.ts, post-review.tsx, plan-review.tsx, month/browse.tsx, app/review/[token]/posts/[postId]/page.tsx, piani/[planId]/page.tsx, mese/[month]/page.tsx, __tests__/plans.test.ts, share-link.test.ts, portal-review.test.ts.
- Test: nuovo caso in plans.test.ts («flags a client with auto-schedule but no Metricool brand»); casi singolare/plurale in share-link.test.ts; fixture PortalClient aggiornate in portal-review.test.ts. Passo e2e monthly-plan non aggiunto (e2e opzionali stanotte): domattina valutare.
- Verifiche: tsc 0, eslint 0, vitest 966/966 (--maxWorkers=4; con il default i due test noti «month-review» e «plans portal 404» vanno in timeout 5 s sotto carico, già al baseline — flake di ambiente, passano sempre in isolamento).

### QA-05 — FATTA (commit 762025a)
- Problema: MCP `create_month_plan` diceva sempre «Non è stato inviato al cliente» anche con piano già inviato.
- Fix: frase costruita da `plan.sentAt`/`plan.status` con `planStatusLabel` («È già stato inviato al cliente (stato In revisione)…»).
- File: lib/mcp/tools/write.ts, __tests__/mcp-tools.test.ts.
- Test: nuovo caso «says the plan was already sent when it has been».
- Verifiche: tsc 0, eslint 0, vitest 967/967.

### QA-03 — FATTA (commit 5d65caf)
- Problema: dopo «Crea N bozze» la schermata del risultato restava scorsa a metà: `window.scrollTo` non fa nulla perché l'area agenzia scorre dentro `<main>`.
- Fix: `useEffect` su `finished` che scorre `document.querySelector("main")` in cima e porta il focus sul titolo (`tabIndex={-1}`); stesso schema applicato a `components/clients/metricool-import.tsx` (unico altro `window.scrollTo` nell'area agenzia; quelli del portale restano: lì lo scroll è sulla finestra).
- File: components/posts/import/import-wizard.tsx, components/clients/metricool-import.tsx, e2e/post-import.spec.mjs.
- Test: asserzione `toBeInViewport()` sul titolo del risultato nell'e2e (da rilanciare domattina).
- Verifiche: tsc 0, eslint 0, vitest 967/967.

### QA-04 — FATTA (commit 64f220e)
- Problema: il portale prometteva «riceverai un'email» anche a referenti senza email (caso previsto: «il link lo mandi tu»).
- Decisione: formula unica con due varianti — con email «riceverai un'email quando sarà pronta», senza «l'agenzia ti avviserà / ti avviseremo». Helper `newVersionNotice(hasEmail)` in review-pieces.tsx riusato dai tre pannelli; i «riceverai un messaggio» degli stati CHANGES_REQUESTED allineati alla stessa regola.
- Fix: prop `reviewerHasEmail` a PostReview/BlogReview/AdsReview (dalla pagina, `Boolean(reviewer.email)`); subtitle della sezione «Modifiche richieste» nella home del portale con la stessa scelta.
- File: components/portal/review-pieces.tsx, post-review.tsx, blog-review.tsx, ads-review.tsx, app/review/[token]/posts/[postId]/page.tsx, app/review/[token]/page.tsx, __tests__/portal-review.test.ts.
- Test: nuovo caso «never promises an email to a reviewer without one» (render con e senza email). Asserzione e2e approval-flow non aggiunta (e2e opzionali stanotte).
- Verifiche: tsc 0, eslint 0, vitest 968/968.

### K-01 — FATTA (commit 3bf0648)
- Problema: `list_posts` contava 8, `get_post`/UI/`list_open_feedback` 6; sul post ads `list_open_feedback` 1 contro 2 della UI; totale errato.
- Causa: `list_posts` e la panoramica usavano `openClientCommentCounts` (che somma anche le conversazioni Heili: è la regola di *idoneità* del portale, non il conteggio dei commenti); `get_post` e `list_open_feedback` filtravano alla sola versione corrente mentre la scheda post dell'agenzia conta tutti i commenti non risolti.
- Decisione (documentata): la regola condivisa è quella visibile all'agenzia nella scheda post — **tutti i commenti del cliente non risolti, di ogni versione** (risposte incluse come righe, commenti per variante/asset inclusi, conversazioni Heili escluse perché non sono commenti). È l'unica che rende coerenti i numeri osservati in produzione (6 + 2 = 8) e «uguale a quello del pannello».
- Fix: predicato `isOpenClientComment` + helper `openClientCommentTotals` in lib/posts.ts; usati da `list_posts`, `get_post` (conteggio non più dalla pagina di commenti caricata, che è limitata), `get_month_overview`, `list_open_feedback` (che ora elenca tutti i non risolti e indica la `version` di ciascun commento) e dalla scheda post dell'agenzia. `openClientCommentCounts` resta per l'idoneità del portale (regola diversa, già documentata).
- File: lib/posts.ts, lib/mcp/tools/read.ts, app/(dashboard)/posts/[id]/page.tsx, __tests__/mcp-tools.test.ts.
- Test: nuovo caso con commenti su versioni diverse, risolti, risposte agenzia, commento per variante e conversazione assistente → i quattro strumenti danno lo stesso numero (4) e il totale è la somma reale.
- Verifiche: tsc 0, eslint 0, vitest 969/969.

### K-02 — FATTA (commit 1320351)
- Problema: Heili diceva «il button «Aggiungi al feedback»», ma nella chat il pulsante visibile è «Prepara il riepilogo per l'agenzia»; in più «button» in italiano.
- Fix: costanti `ASSISTANT_BUTTONS` in lib/review-assistant/shared.ts (prepareSummary / submitChanges / addToFeedback) usate dal pannello (sorgente unica, `ASSISTANT_FEEDBACK_COPY.submitLabel` riusa la costante) e dai prompt; i prompt descrivono i due passi («prima il pulsante X, poi, controllando il riepilogo, Y») sia in modalità decisione sia feedback; aggiunta a SHARED_RULES la regola «call it "pulsante" (never "button") and quote its exact Italian label»; istruzioni vocali (live-config) con le stesse costanti e la stessa regola; «with the button «Approva»» → «pulsante «Approva»».
- Nota: il prompt in modalità feedback mantiene il framing base + override finale (struttura voluta): il test verifica che l'override citi le etichette giuste e sia dopo il framing base.
- File: lib/review-assistant/shared.ts, prompt.ts, live-config.ts, components/review/assistant-panel.tsx, __tests__/assistant-buttons.test.ts (nuovo).
- Test: 4 casi — etichette esatte in decisione/feedback, voce per 3 tipi × 2 modalità, controllo statico che il pannello usi le costanti (niente letterali duplicati).
- Verifiche: tsc 0, eslint 0, vitest 973/973.

### K-03 — FATTA (commit c3944a7)
- Problema: «Seleziona le bozze da inviare (N)» contava anche i post in «Modifiche richieste» (reinviabili).
- Decisione: opzione (a) — il testo diventa «Seleziona i post da inviare (N)». Motivo: la transizione `submit` in lib/domain.ts copre DRAFT e CHANGES_REQUESTED e `sendPlan` reinvia entrambi: il reinvio multiplo è voluto. Commento nel codice + helper `selectForSendLabel` in components/posts/helpers.ts.
- File: components/posts/helpers.ts, components/posts/post-list.tsx, __tests__/posts-ui.test.ts.
- Test: righe miste (bozza, modifiche richieste, approvato) → selezionabili 2, etichetta «post», non «bozze».
- Verifiche: tsc 0, eslint 0, vitest 974/974.

### K-08 — FATTA (commit 86faf42)
- Problema: dopo «Chiedi modifiche» il campo commento e Heili sparivano fino al ricaricamento.
- Fix: `feedbackOpen = post.status === "CHANGES_REQUESTED" || outcome === "changes"`; `canComment` resta vero dopo l'esito «changes» (mai dopo «approved»); `finish("changes")` riapre una bozza generale; hint e notice usano `feedbackOpen`; `assistantMode` diventa "feedback" come al reload. «Approva» non riappare (DecisionBar e approve restano legati a `canAct`). In ads-review l'esito è un oggetto: coperto anche «decisioni con tutto scartato» (CHANGES_REQUESTED); la bozza riaperta rispetta il tipo VariantDraft.
- File: components/portal/post-review.tsx, blog-review.tsx, ads-review.tsx, e2e/assistant-after-changes.spec.mjs.
- Test: esteso il primo test e2e: dopo «Chiedi modifiche», senza reload, visibili hint «puoi aggiungere altro», «Invia commento» e «Parla con Heili»; assenti «Approva» e «Chiedi modifiche». Da rilanciare domattina.
- Verifiche: tsc 0, eslint 0, vitest 974/974.

### QA-06 — FATTA (commit 6eb93dd)
- Fix: etichetta riga import «Titolo (visibile al cliente)» (la stessa forma già usata dall'editor, per coerenza); istruzioni del modello: «visibile anche al cliente (portale ed email)… se vuoto usiamo le prime parole»; docs/AGENT-IMPORT.md allineato. Il campo mostra già l'anteprima del titolo automatico nel placeholder/summary della riga.
- File: components/posts/import/import-row.tsx, lib/post-import/template.ts, docs/AGENT-IMPORT.md.
- Test: nessuno esistente citava quei testi; il template resta rileggibile (coperto da post-import-parse.test.ts).
- Verifiche: tsc 0, eslint 0, vitest 974/974.

### QA-11 — FATTA (commit 53637f1)
- Fix: in `@media (max-width: 640px)` aggiunta `.field { font-size: 16px; min-height: 44px; }` (la specificità di `.field` batteva la regola sugli elementi). Anche l'input del BrandPicker usa `.field`, quindi è coperto.
- File: app/globals.css, e2e/post-import.spec.mjs.
- Test: controllo e2e a 390 px su fontSize ≥ 16 e altezza ≥ 44 (da rilanciare).
- Verifiche: tsc 0, eslint 0 (css ignorato da eslint), vitest 974/974.

### QA-12 — FATTA (commit 07adbe7)
- Fix: drawer chiuso `inert` + `aria-hidden` sotto lg (matchMedia 1024 px); aperto: `role="dialog"` `aria-modal` con focus spostato dentro; Esc chiude (listener in DashboardShell) e il fuoco torna al pulsante «Apri menu» (ref passata a TopBar). Su desktop (lg) comportamento invariato.
- File: components/sidebar.tsx, components/dashboard-shell.tsx, components/top-bar.tsx, e2e/post-import.spec.mjs.
- Test: e2e a 390 px: aside inerte da chiuso, non inerte da aperto, Esc richiude e «Apri menu» è focused (da rilanciare).
- Verifiche: tsc 0, eslint 0, vitest 974/974.

### QA-13 — FATTA (commit c7cbf31)
- Fix: nuova utility `.touch-target` (44×44) in globals.css; «Rispondi»/«Segna come risolto»/«Annulla» di comment-thread → `.btn .btn-quiet/.btn-primary .btn-sm` (44 px su mobile come da regola già esistente); caselle della lista post dentro label 44×44 e barra con `min-h-11`; frecce settimana e «+ Nuovo contenuto» del calendario con `touch-target`; «← Tutti i post» e schede della pagina post con `min-h-11`; pulsanti di post-actions → `.btn`/`.btn-primary`; «Apri menu» 44×44; chip «N da gestire» con `min-h-11`.
- Non toccato: il «+» della vista mese (solo desktop, compare al hover del puntatore).
- File: app/globals.css, comment-thread.tsx, post-list.tsx, post-actions.tsx, top-bar.tsx, calendar/page.tsx, posts/[id]/page.tsx, e2e/post-import.spec.mjs.
- Test: misura e2e del bersaglio «Apri menu» ≥ 44×44 a 390 px (da rilanciare).
- Verifiche: tsc 0, eslint 0, vitest 974/974.

### QA-07 — FATTA (commit 9d6f514)
- Fix: colonna facoltativa «Formato» nel modello e nel parser (`Post`/`Reel`/`Storia`, oppure `Rete: Formato`, es. «Instagram: Reel», più voci con `|`): mappa su `networkOptions` (si fonde con `network_options` JSON, la colonna visibile vince per rete); errori leggibili per formato sconosciuto, rete non nella riga, formato non offerto. Modello .xlsx/.csv aggiornato (riga esempio «Post»), istruzioni aggiornate, docs/AGENT-IMPORT.md aggiornato. Il wizard passa `format` al server.
- File: lib/post-import/rows.ts, table.ts, template.ts, components/posts/import/import-wizard.tsx, docs/AGENT-IMPORT.md, __tests__/post-import-service.test.ts, post-import-parse.test.ts.
- Test: 3 nuovi casi (Reel su IG+FB, «Instagram: Reel» + merge JSON, errori) e roundtrip del modello aggiornato.
- Verifiche: tsc 0, eslint 0, vitest 977/977.

### QA-08 — FATTA (commit 0b61466)
- Fix: nella barra sticky dell'import (quando ci sono righe da correggere) «Vai alla prossima da correggere» (scorre ciclicamente alle righe invalide, `scrollIntoView` sul `<li id="import-row-N">`) e filtro «Mostra solo da correggere».
- Decisione: NON fatto il ripiego delle righe pronte in una riga di riepilogo (cambio UI più invasivo, rischio rottura e2e che compilano i campi; il filtro copre il bisogno principale). Barra sticky lasciata com'è (già compatta dopo le modifiche di QA-01).
- File: components/posts/import/import-wizard.tsx, import-row.tsx, e2e/post-import.spec.mjs.
- Test: e2e con filtro (resta 1 riga invalida) e salto alla riga in viewport (da rilanciare).
- Verifiche: tsc 0, eslint 0, vitest 977/977.

### QA-10 — FATTA (commit 7841890)
- Fix: (1) microfono non supportato → il suggerimento sotto il campo diventa «Scrivi il tuo commento» invece di «Scrivi o detta» (hook `useSpeechSupported` riusato dai composer); (2) permesso negato → messaggio nel flusso della pagina sotto la riga dei comandi (niente popup `absolute` che copriva «Annulla»): il DictationButton solleva l'errore al genitore con `onErrorChange` e i tre composer (commento, asset ads, piano) lo mostrano con `role="alert"`; testo «Il microfono è bloccato: consentilo dalle impostazioni del sito e riprova, oppure scrivi»; (3) `no-speech` → «Non ti ho sentito: riprova, oppure scrivi il messaggio.»
- File: components/voice/use-speech-input.ts, dictation-button.tsx, components/portal/comment-composer.tsx, components/ads/asset-comment-composer.tsx, components/portal/plan-review.tsx, __tests__/voice-input.test.ts.
- Test: asserzioni sui nuovi testi in voice-input.test.ts. e2e con SpeechRecognition simulato non aggiunto (opzionale).
- Verifiche: tsc 0, eslint 0, vitest 977/977.

### K-04 + QA-15 — FATTE (commit 9240572, voce scritta a posteriori: la sessione precedente si era interrotta prima)
- K-04: un'unica metrica di avanzamento in Panoramica, Griglia e Sfoglia — «N di M revisionati» (approvati + con modifiche) con sotto il dettaglio, via `PlanProgressBar` condivisa (month-frame commenta «Same metric as the Panoramica»).
- QA-15: plurali corretti con il nuovo helper `lib/plural.ts` (`plural(n, "commento", "commenti")`), applicato ai testi del portale (browse, plan-bits).
- File: lib/plural.ts (nuovo), components/plans/plan-bits.tsx, components/portal/month/browse.tsx, components/portal/month/month-frame.tsx, __tests__/plan-rules.test.ts, e2e/month-review.spec.mjs.
- Test: 14 nuove asserzioni in plan-rules.test.ts; e2e aggiornato ai nuovi testi («0 di 5 revisionati»).
- Verifiche (della sessione precedente): tsc 0, eslint 0, vitest 977/977.

### K-05 — FATTA
- Problema: in Panoramica le schede «Panoramica · Griglia · Sfoglia» erano a sinistra, in Griglia/Sfoglia a destra (flex `justify-between` con il link «← indietro»): cambiando vista si spostavano.
- Fix: in `MonthFrame` il selettore va su una riga sua, sotto il link «← indietro», allineato a sinistra — la stessa posizione che ha in Panoramica (`PlanReview`). Su telefono il selettore prende tutta la riga (nuova classe `month-view-tabs` + regola `@media (max-width: 640px)` con i tab `flex: 1`), così la posizione è identica nelle tre viste. In Sfoglia (compact) su telefono il link «← indietro» resta nascosto come prima, ma ora è nascosto tutto il nav, non solo il link.
- Decisione: la regola full-width è limitata al selettore del portale (`month-view-tabs`), non a `.studio-view-tabs` generico, per non cambiare il tablist dell'area agenzia in plan-bits.
- File: components/portal/month/month-frame.tsx, components/portal/month/view-switch.tsx, app/globals.css, e2e/month-review.spec.mjs.
- Test: e2e — a 390 px e a 1366 px la x del selettore è identica tra Panoramica e Griglia, più `expectNoHorizontalScroll` (da rilanciare domattina).
- Verifiche: tsc 0, eslint 0, vitest 978/978 (--maxWorkers=4).

### K-06 — FATTA
- Problema: chiave creata il 12/10 «per 30 giorni» mostrava «Scade il 10/11/2026» (atteso 11/11) — 30×24 h assolute con il cambio dell'ora legale in mezzo; «Revoca» agiva subito.
- Fix scadenza: nuova `automationTokenExpiry(now, days)` in `lib/automation/auth.ts`: fine del giorno (23:59:59) del giorno di calendario di Roma «oggi + N giorni», calcolata con gli helper esistenti `toZonedDateTimeString`/`zonedDateTimeToUtc` di `lib/metricool/payload.ts`. La pagina mostrava già la data in fuso Roma, quindi ora data promessa = data mostrata.
- Fix revoca: conferma con il `BottomSheet` condiviso (quello delle decisioni del portale): titolo «Revocare la chiave «nome»?», testo «Le AI che la usano smetteranno di funzionare subito.», pulsanti «Sì, revoca» (bg-error, stile già usato in ad-variant-review) e «Annulla». La revoca avviene solo dal foglio.
- File: lib/automation/auth.ts, app/(dashboard)/settings/automation-actions.ts, components/settings/automation-settings.tsx, __tests__/automation-actions.test.ts, e2e/mcp.spec.mjs.
- Test: 3 unit test sulla scadenza (30 giorni dal 12/10 → 11/11; a cavallo del cambio d'ora 25/10; mai prima di adesso). e2e nuovo in mcp.spec.mjs: crea chiave «E2E revoca», verifica la data mostrata, Revoca → foglio → Annulla (resta), Revoca → Sì, revoca (sparisce e `revokedAt` nel DB). Da rilanciare domattina.
- Verifiche: tsc 0, eslint 0, vitest 981/981 (primo run: 2 test noti flaky — month-review/plans — in timeout sotto carico, verdi al rerun e in isolamento).

### K-07 — FATTA
- Verificati tutti i template `${n} …` di lib/, components/ e app/: la gran parte era già a posto («media» e «post» sono invarianti in italiano; molti punti avevano già il ternario o la guardia `> 1`; i testi del portale erano stati sistemati con QA-15/K-04).
- Fix reali, tutti con l'helper `plural` di QA-15:
  - `lib/mcp/tools/read.ts` — list_clients («1 cliente:»), list_posts («1 commento aperto» per post), get_post («1 media, 1 commento (1 aperto del cliente)»), list_open_feedback (totale «1 commento aperto su 1 post» e riga «…: 1 commento»);
  - `lib/mcp/tools/write.ts` — riepilogo di create_draft_posts: «Bozze: 1 creata, 0 già esistenti, 0 non riuscite» (prima «1 create»).
- Non toccati (già corretti): blog.ts (alt immagini), helpers.ts (varianti decise), notifications.ts, posts.ts (media aggiunti/rimossi, guardati), ads.ts e zod con costanti > 1, import-wizard, plan-editor, dashboard, post-list, plan-review, ads-review.
- File: lib/mcp/tools/read.ts, lib/mcp/tools/write.ts, __tests__/mcp-tools.test.ts.
- Test: nuovo caso «uses the singular in the Italian summaries when there is exactly one» (1 cliente, 1 commento: i tre strumenti + list_open_feedback al singolare); il plurale resta coperto dal caso K-01 («4 commenti aperti»).
- Verifiche: tsc 0, eslint 0, vitest 982/982.

### QA-14 — FATTA
- Fix: la mappa `THE` di post-share-panel è diventata `TO_THE` con preposizioni articolate («al post», «all'articolo», «alle creatività») e la frase è «…porta direttamente {TO_THE[kind]} nella revisione di …». Usata solo in quel punto. e2e share-link non controllava quel testo.
- File: components/share/post-share-panel.tsx, __tests__/share-link.test.ts.
- Test: nuovo caso che renderizza il pannello per i tre tipi e verifica la forma giusta (e l'assenza di «a il/a l'/a le»).
- Verifiche: tsc 0, eslint 0, vitest 983/983.

### QA-16 — FATTA
- Fix: tolta la classe CSS `capitalize` (maiuscola ogni parola: «Lunedì 12 Ottobre») dai due titoli del calendario; nuovo helper `ucFirst` in components/posts/helpers.ts che maiuscola solo la prima lettera: «Ottobre 2026», «Lunedì 12 ottobre».
- File: components/posts/helpers.ts, app/(dashboard)/calendar/page.tsx, __tests__/posts-ui.test.ts.
- Test: 3 asserzioni su `ucFirst`.
- Verifiche: tsc 0, eslint 0, vitest 984/984.

### QA-17 — FATTA
- Glossario fissato: lato agenzia «Post social», «Articoli», «Creatività ads»; lato cliente (portale, email, WhatsApp) **«Annunci»**, mai «ads» né «creatività».
- Lato cliente: `variant.ts` COUNT_WORDS→annunci e «set di annunci», nuova `clientServicesSentence` (quella esistente resta per l'agenzia); `notifications.ts` email batch AD→annunci; `share/messages.ts` WhatsApp→annunci; portale: nuova mappa `PORTAL_KIND_LABELS` (helpers) usata da tag, tabs e `KindLabel` («Annuncio»); tagline «I tuoi annunci da approvare»; ads-review tutti i testi→annunci; actions.ts «Questo set di annunci è già stato approvato».
- Lato agenzia: `KIND_CONFIG.BLOG_ARTICLE.plural` «Articoli di blog»→«Articoli» (menu/dashboard coerenti); errori «Creatività non trovate»→«Creatività ads non trovate» (creative-decisions, export route); email agenzia «Creatività approvate»→«Creatività ads approvate»; pulsanti «Importa da Excel»→«Importa post» (come il titolo della pagina), help catalog allineato.
- File: lib/variant.ts, lib/notifications.ts, lib/domain.ts, lib/creative-decisions.ts, lib/help/catalog.ts, components/share/messages.ts, components/portal/{helpers,kind-label,kind-tabs,portal-header,post-card,ads-review}, app/(dashboard)/posts/page.tsx, app/(dashboard)/plans/page.tsx, app/api/export/ads/[postId]/route.ts, app/review/[token]/{actions.ts,page.tsx}, __tests__/{glossary.test.ts (nuovo),client-services.test.ts,share-link.test.ts,portal-review.test.ts}, e2e/{client-services.spec.mjs,post-import.spec.mjs}.
- Test: nuovo `__tests__/glossary.test.ts` (4 casi): parole cliente nelle funzioni condivise, portale, email/WhatsApp, e scansione statica di components/portal + app/review: nessun «creativit» nel codice del portale. Aggiornati i test esistenti alle nuove diciture; e2e client-services aggiornato (da rilanciare).
- Verifiche: tsc 0, eslint 0, vitest 988/988 (worktree dedicata, vedi nota sotto).

### NOTA DI SESSIONE — convivenza con deepseek/notte-2026-10-13 (IMPORTANTE per Claude)
- Durante QA-17 un agente DeepSeek ha fatto checkout del suo branch `deepseek/notte-2026-10-13` **nella stessa working directory** (base: merge `ce1a782` del mio lavoro della notte 12/10 fino a K-04+QA-15, più una revisione del mio QA-11 in globals.css, più il suo lavoro H-01 «dock di Heili nel portale»). Le mie modifiche QA-17 non committate si sono trovate nella sua tree; lui le ha riconosciute («QA-17 esterno» nel suo resoconto) e NON le ha committate.
- Per non collidere ho spostato il mio lavoro in una **worktree separata** (`%TEMP%\opencode\kimi-wt`, branch `kimi/notte-2026-10-12`) e ho committato QA-17 da lì. Da qui in poi lavoro solo nella worktree.
- Le copie delle mie modifiche QA-17 rimaste nella tree principale (quella di deepseek) andrebbero tolte da chi ci lavora (o da me quando deepseek avrà finito): sono i file del commit QA-17 sul mio branch. Non le ho tolte io perché deepseek era attivo in quel momento.
- Il branch di deepseek NON contiene i miei commit di questa notte (K-05, K-06, K-07, QA-14, QA-16, QA-17): il merge finale li dovrà includere; attenzione ai file toccati da entrambi (components/portal/*, app/review/*, e2e/month-review.spec.mjs).

### QA-18 — FATTA
- Fix: «Nuovo contenuto» nella lista post ora usa `btn btn-primary` come gli altri pulsanti (era una classe ad hoc: testo non centrato, angoli squadrati, altezza < 44).
- Il caso «calendar/page.tsx:150» della scheda non esiste più: il «+ Nuovo contenuto» del calendario è stato sistemato con QA-13 (touch-target) e non usa quella classe.
- Nota: restano altri pulsanti con la classe ad hoc (`bg-accent px-4 py-2…`) in clients/page.tsx, posts/page.tsx (stato vuoto), client-form, archive-button, ad-review, blog-review, post-review (area agenzia): non toccati per minimalità — se si vuole uniformare tutto, valutare una passata unica.
- File: app/(dashboard)/posts/page.tsx.
- Test: nessun test asseriva quella classe; verifica visiva rimandata agli screenshot e2e (SHOTS/E1-posts-m.png) domattina.
- Verifiche: tsc 0, eslint 0, vitest 988/988.

### QA-19 — FATTA
- Fix: `lib/mcp/protocol.ts` imposta la lingua italiana di zod (`z.config(zodItalian())`, zod 4.3.6 include la locale `it`): «Opzione non valida: atteso uno tra "DRAFT"|…», «Input non valido: atteso stringa, ricevuto undefined», «Troppo grande: number deve avere <=50 elementi».
- Decisione (documentata nel codice): la config di zod è process-wide — dopo la prima chiamata MCP tutto il server parla italiano. Accettabile e anzi coerente: tutta l'app è in italiano e nessun test (verificato con grep su __tests__ ed e2e) asseriva messaggi zod in inglese. Suite completa verde dopo il cambio.
- File: lib/mcp/protocol.ts, __tests__/mcp-protocol.test.ts, __tests__/mcp-tools.test.ts.
- Test: mcp-protocol (testo «Troppo grande», niente «Too big/Invalid input/Invalid option»); mcp-tools nuovo caso «reports invalid arguments in Italian» (enum, campo mancante, limite).
- Verifiche: tsc 0, eslint 0, vitest 989/989.

### QA-20 — FATTA
- Fix: nella scheda «Collega la tua AI (MCP)» il testo non cita più un percorso del repository («Il titolare può attivarlo: guida in docs/COLLEGARE-AI-MCP.md» → «Per attivare l'accesso con account, chiedi al titolare.») e «(vedi sotto)» è diventato esplicito («nella sezione «Codex e Claude Code» qui sotto»). La chiave appena creata ha ora il pulsante «Copia chiave» (CopyButton condiviso, stile btn).
- Nota: il riferimento «qui sopra» già presente a «Importa con Codex o Claude» era già esplicito: invariato.
- File: components/settings/mcp-settings.tsx, components/settings/automation-settings.tsx, e2e/mcp.spec.mjs.
- Test: e2e — la scheda non contiene «docs/»; dopo «Crea chiave» è visibile «Copia chiave» (da rilanciare).
- Verifiche: tsc 0, eslint 0, vitest 989/989.

### QA-22 — FATTA
- Fix: `.field` ora borda con `--color-line-strong` invece del filetto chiaro (1,28:1); `--color-line-strong` scurito da #8ca0a6 (2,73:1) a **#7b8f95 (3,38:1 su bianco, WCAG 1.4.11 ≥ 3:1)**; `--color-muted` scurito da #5b7179 (4,46:1 su surface-sunken) a **#57707a (4,55:1 su sunken, 5,24:1 su bianco)**. Rapporti calcolati con la formula WCAG (script node, nel log della sessione).
- Decisione: scuriti i token globali (non solo `.field`): migliora anche i bordi dei `.btn` e delle chip, che usano gli stessi token; nessun test asseriva i valori esadecimali. Gli screenshot e2e andranno rigenerati/verificati a occhio domattina.
- Non trattato: il pulsante «Invia» disabilitato (3,2:1) — la scheda stessa lo dichiara accettabile (stato disabilitato).
- File: app/globals.css, e2e/post-import.spec.mjs.
- Test: e2e — il bordo calcolato di un campo è rgb(123,143,149) (da rilanciare).
- Verifiche: tsc 0, eslint 0 (css ignorato), vitest 989/989.

### QA-23 — FATTA
- Fix: il modello CSV ora usa «;» (separatore elenco di Excel in italiano) invece di «,»; BOM mantenuto (ora scritto come `\uFEFF` esplicito, più robusto del carattere letterale). L'importatore legge già entrambi (`detectDelimiter`), quindi i vecchi CSV con «,» continuano a funzionare. Nessuna riga `sep=;`: il parser la leggerebbe come prima riga di dati.
- Nota di rischio gestita: in una prima stesura il BOM letterale si era perso nella riscrittura della riga (era un carattere invisibile nel file); il test esistente «csv version has a BOM» l'ha intercettato subito. Le celle con «,» o «;» dentro sono già virgolettate da `csvCell`.
- File: lib/post-import/template.ts, __tests__/post-import-parse.test.ts.
- Test: il caso del modello ora verifica anche che la prima riga contenga «;»; roundtrip invariato e verde. Verifica con Excel reale rimandata (la scheda diceva «da verificare»): la logica è quella standard dei CSV italiani.
- Verifiche: tsc 0, eslint 0, vitest 989/989.

### QA-24 — FATTA
- Fix: nuova `resolveBaseUrl(env)` in lib/env.ts — una variabile definita ma vuota o di soli spazi conta come non impostata (`PUBLIC_BASE_URL` → `NEXTAUTH_URL` → `http://localhost:3000`), barra finale tolta, e se il valore non è un URL assoluto http(s) errore chiaro di configurazione. Usata sia da `getBaseUrl()` sia da `getMcpConfig` (prima la logica era duplicata e vulnerabile in entrambe). `.env.example` documenta che `APP_URL` non esiste e che vuota = non impostata.
- Decisione: errore (throw) su valore relativo invece di fallback silenzioso — un URL di base sbagliato produce link rotti nelle email ai clienti e nei media consegnati a Metricool: meglio un errore evidente subito (stesso stile di ENCRYPTION_KEY). Nessun codice esistente passa valori relativi (suite verde).
- File: lib/env.ts, lib/mcp/config.ts, .env.example, __tests__/env.test.ts (nuovo).
- Test: 4 casi — vuota/spazi → fallback; preferenza e barra finale; valore relativo → errore; getMcpConfig con vuota → URL assoluti.
- Verifiche: tsc 0, eslint 0, vitest 993/993.

### QA-25 — FATTA
- Fix: in `checkImportRows` (il controllo server che il wizard esegue a ogni modifica) due righe con la stessa impronta (`draftFingerprint`) nello stesso foglio → la seconda è marcata «Uguale alla riga N: creerebbe una bozza identica» (N = numero di riga del foglio, coerente con l'etichetta «Riga N» del wizard).
- Decisione (documentata nel resoconto): bloccante, non solo avviso — la scheda ammetteva entrambe; nel wizard una riga con issue non è «pronta», quindi non viene creata. Coerente con la promessa dell'import «non duplica mai»: per duplicare davvero basta cambiare un campo (titolo, ora). Il percorso automazione/MCP (source_id espliciti) non è toccato: lì la deduplica è responsabilità del chiamante.
- File: lib/post-import/service.ts, __tests__/post-import-service.test.ts.
- Test: nuovo caso — tre righe (due identiche + una con titolo diverso): la seconda non ok con il messaggio, la terza ok.
- Verifiche: tsc 0, eslint 0, vitest 994/994.

### QA-26 — FATTA
- Fix (1) intestazioni: in `tableToRows`, se la prima riga contiene almeno una colonna riconosciuta e la prima cella NON sembra una data/seriale Excel, è trattata come intestazione anche sotto la soglia precedente (2 colonne note): un foglio «Giorno | Quando | Post» ora dà l'errore chiaro «Nella prima riga mancano le colonne: Reti, Testo…» invece di importare l'intestazione come «Riga 1» con errore di data. Una prima cella che è già una data resta dato nell'ordine standard (comportamento invariato, coperto da test).
- Fix (2) date Excel: `serialToText` ora produce «15/10/2026» (e «15/10/2026 10:30», già accettato da evaluateRow via il fallback «joined») invece di «2026-10-15» — coerente con il placeholder e con ciò che l'utente vede in Excel. Le ore sole restano «10:30».
- Nota: un primo giro di test ha intercettato una mia svista nella regex «sembra una data» (mancava l'anno opzionale) — corretta; è il caso in cui una cella di testo piegata su un alias («Testo») avrebbe attivato la nuova regola su una riga di dati vera.
- File: lib/post-import/table.ts, __tests__/post-import-parse.test.ts.
- Test: nuovo caso per la regola intestazioni (errore chiaro + riga di dati invariata); aggiornate le attese del seriale Excel al formato italiano (1900 e 1904).
- Verifiche: tsc 0, eslint 0, vitest 995/995.

### QA-27 — FATTA
- Fix: il modulo «Aggiungi referente» in `ReviewerList` compare solo se il cliente ha già almeno un referente; il primo si crea dal modulo rapido «Chi approva per …?» in «Link per il cliente» (stessa pagina, subito sopra). Un solo percorso per il primo referente, il modulo completo (con «Invia il link via email») per i successivi — come già suggeriva il testo «Altre persone, email e nuovi link: Referenti».
- File: components/clients/reviewer-list.tsx, e2e/share-link.spec.mjs.
- Test: e2e — su cliente appena creato `add-reviewer-form` assente, dopo «Crea link» presente (da rilanciare).
- Verifiche: tsc 0, eslint 0, vitest 995/995.
