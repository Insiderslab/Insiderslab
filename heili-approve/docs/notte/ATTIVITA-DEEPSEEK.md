# Attività — riepilogo (DeepSeek · 18/10/2026)

## Fase 1 (completata)

Dati + servizio, nessuna UI: modello `AgencyActivity` con migrazione additiva
`20261018120000_agency_activity`, servizio `lib/activity.ts` e test
`__tests__/activity.test.ts`.

## Fase 2 (completata)

Agganci nei flussi esistenti («Dove nascono» di `docs/ATTIVITA.md`), senza cambiare il
comportamento esistente. Ogni `recordActivity`/`closeTasksForPost` è in un try/catch che non
blocca mai l'azione del cliente né l'email.

- `lib/notifications.ts`: helper `recordActivitySafe` e chiamate in
  `notifyChangesRequested` (CHANGES_REQUESTED, oppure WEBSITE_NOTES per i siti),
  `notifyApproved` (APPROVED/INFO), `notifyScheduleFailed` (SCHEDULE_FAILED),
  `notifyPlanComment` (PLAN_COMMENT), `notifyPlanApproved` e `notifyPlanDecided`
  (PLAN_APPROVED/INFO). Chiavi di dedupe come da tabella (`changes:<post>:v<n>`,
  `approved:<post>:v<n>`, `schedule-failed:<post>:v<n>`, `plan-comment:<comment>`,
  `plan-approved:<plan>`).
- `lib/posts.ts`: `recordClientCommentSafe` in `addComment` (commento del cliente senza
  decisione → CLIENT_COMMENT, `comment:<id>`); `closeTasksForPostSafe` in
  `submitForReview` (ogni post inviato in revisione) e in `cancelPost`.
- `lib/approval-undo.ts`: `undoApproval` chiude l'INFO `approved:<post>:v<n>` con la nuova
  `closeInfoActivity` (`lib/activity.ts`).
- Test: `__tests__/activity-notifications.test.ts` (agganci nelle email, incluso che un
  errore di `recordActivity` non blocca la notifica), `__tests__/activity-posts-hooks.test.ts`
  (chiusura task su invio/annullamento, CLIENT_COMMENT), più `closeInfoActivity` in
  `activity.test.ts`.

Verifica: `tsc --noEmit` verde, `eslint` verde, `vitest` 1415/1415.

## Fase 3 (completata)

Interfaccia, come da sezione «Interfaccia» di `docs/ATTIVITA.md`:

- **A-07** — voce «Attività» nel menu dell'agenzia (tra Dashboard e Post) con il numero
  dei compiti aperti (mie + non assegnate, `countOpenTasks`); il chip «N da gestire» della
  barra in alto ora porta a `/attivita`; `/attivita` protetta in `proxy.ts` e titolata in
  `components/top-bar.tsx`.
- **A-08** — pagina `app/(dashboard)/attivita/page.tsx` (schede «Da fare / Notifiche»,
  interruttore «Solo i miei / Tutti», filtro cliente, righe con icona/tipo, cliente,
  titolo, estratto a 2 righe, data relativa, assegnatario; azioni «Apri», «Fatto»,
  «Riapri», «Assegna a…», «Segna tutte come lette», «Mostra completate» ultimi 30 giorni).
  Server actions in `app/(dashboard)/attivita/actions.ts` che usano `lib/activity.ts` e
  verificano il workspace come le altre actions. Aggiunti `listCompletedTasks` e
  `countUnreadNotifications` a `lib/activity.ts`, `listWorkspaceMembers` a
  `lib/workspace.ts`, helper puri in `components/attivita/helpers.ts` e test
  `__tests__/activity-ui.test.ts`.
- **A-09** — campo «Social media manager» (select dei membri + «Nessuno») in
  `components/clients/client-form.tsx`; `ownerUserId` persistito in `lib/clients.ts`
  (validato come membro del workspace); elenco clienti mostra il nome del responsabile.
- **A-10** — riga «Hai N compiti in Attività» con link nella dashboard.

Verifica: `tsc --noEmit` verde, `eslint .` verde, `vitest run --maxWorkers=2` 1424/1424.

Commit: `eeb39bf` (A-07), `24d12f9` (A-08), `b67ae03` (A-09), `26a8506` (A-10).

FINITO — ramo deepseek/attivita-2026-10-18.
