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

## Fase 3 (da fare)

Interfaccia: menu/«Attività» con contatore, pagina `app/(dashboard)/attivita`,
scheda cliente «Social media manager», riga «Hai N compiti» in dashboard.
