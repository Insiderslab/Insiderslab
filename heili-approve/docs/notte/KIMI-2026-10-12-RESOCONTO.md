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
