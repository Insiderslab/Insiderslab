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
