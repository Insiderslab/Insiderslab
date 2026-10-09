# Skills InsidersLab

Sorgenti delle skill del dipartimento AI sviluppate in questo repository.

| Skill | Versione | Area | Cosa fa |
|---|---|---|---|
| [`ux-ui-agencia`](ux-ui-agencia/SKILL.md) | 1.0 | 🌐 Web & sviluppo | Lead UX/UI: audit di usabilità, user flow, wireframe, direzione visiva, design system, spec per lo sviluppo, accessibilità WCAG 2.2 / EAA per siti, piattaforme, dashboard, e-commerce e app |

## Installazione

1. Scarica il file `.skill` dalla cartella [`dist/`](../dist/) (oppure crealo con lo script di
   packaging di `skill-creator`, che esclude automaticamente la cartella `evals/`).
2. Account personale: Impostazioni → Capabilities/Customize → Skills → carica il file.
   Organizzazione (Team/Enterprise): Organization settings → Skills → provisioning per tutti.
3. Richiede l'esecuzione di codice attiva (per `scripts/contrast_check.py`).

## Da fare nel catalogo dopo l'installazione

- `skill-factory/references/catalogo-skills.md`, sezione 🌐 WEB & SVILUPPO, aggiungere:
  `| ux-ui-agencia | Audit UX, flussi, wireframe, design system, accessibilità EAA | Agenzie, SaaS, e-commerce, app |`
- `web-factory-insiderslab/references/agents/02-uxui-elementor.md`: aggiungere un rimando a
  `ux-ui-agencia` per design system, direzione visiva e accessibilità; l'agente 2 resta il
  traduttore della spec in formato Elementor.
- Passare la skill a `harness-audit` (SCHEDA) dopo ogni modifica e popolare la libreria
  fallimenti con `harness-replay` dopo i primi progetti reali.
