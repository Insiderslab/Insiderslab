# Attività — riepilogo Fase 1 (DeepSeek · 18/10/2026)

Fase 1 di 3 completata (dati + servizio, nessuna UI): modello `AgencyActivity` con
migrazione additiva `20261018120000_agency_activity`, servizio `lib/activity.ts` e test
`__tests__/activity.test.ts`. `tsc --noEmit` verde, `eslint` verde, `vitest` 1401/1401.
Resta da fare (fasi 2–3): agganci nei flussi esistenti (`recordActivity`/`closeTasksForPost`),
menu/«Attività», scheda cliente «Social media manager», dashboard e pagina `/attivita`.
