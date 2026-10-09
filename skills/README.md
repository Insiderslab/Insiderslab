# Skills InsidersLab

Sorgenti delle skill del dipartimento AI sviluppate in questo repository.

| Skill | Versione | Area | Cosa fa |
|---|---|---|---|
| [`ux-ui-agencia`](ux-ui-agencia/SKILL.md) | 1.1 | 🌐 Web & sviluppo | Lead UX/UI: audit di usabilità con punteggio calcolato dai rilievi, user flow, wireframe, direzione visiva, design system, spec per lo sviluppo, accessibilità WCAG 2.2 / EAA per piattaforme SaaS, dashboard, web app, app mobile, e-commerce e audit di siti online |

## Contenuto di `ux-ui-agencia`

```
ux-ui-agencia/
├── SKILL.md                         cinque modalità + harness H1-H4 (gate G1-G10)
├── references/                      caricati solo quando servono
│   ├── audit-euristiche.md          metodo, N1-N10, severità, priorità, punteggio
│   ├── accessibilita-eaa.md         WCAG 2.2 AA, EAA in Italia, protocollo di test
│   ├── design-system.md             token, colore, tipografia, stati, dark mode
│   ├── direzione-visiva.md          scelte non generiche, restyling, controllo G6
│   ├── pattern-per-tipo.md          landing, e-commerce, SaaS, app, form, tabelle
│   ├── microcopy.md                 UX writing in italiano (note ES/EN)
│   ├── handoff.md                   spec pronte per Elementor, React, app, Figma
│   ├── fonti.md                     skill pubbliche studiate e licenze
│   ├── cliente.md                   dati InsidersLab
│   └── cliente-template.md          template vuoto per altri clienti
├── assets/templates/                report audit, report accessibilità, brief, spec, user flow
├── scripts/
│   ├── contrast_check.py            gate G3: contrasto WCAG (hex e rgb), modo progetto/audit
│   └── audit_probe.js               misure Playwright: reflow, zoom, campi, target, focus, colori, axe
└── evals/                           prompt di test, esiti, fixture (esclusi dal pacchetto)
```

## Installazione

1. Scarica `dist/ux-ui-agencia.skill` (oppure ricrealo con lo script di packaging di
   `skill-creator`, che esclude automaticamente la cartella `evals/`).
2. Account personale: Impostazioni → Capabilities/Customize → Skills → carica il file.
   Organizzazione (Team/Enterprise): Organization settings → Skills → provisioning per tutti.
3. Richiede l'esecuzione di codice attiva. `audit_probe.js` richiede anche Node e
   Playwright (disponibili in Claude Code; altrimenti le stesse misure si fanno a mano).

## Da fare nelle altre skill (tramite `skill-factory`)

- `skill-factory/references/catalogo-skills.md`, sezione 🌐 WEB & SVILUPPO: aggiungere
  `ux-ui-agencia` e `web-factory-insiderslab`; segnare `web-creation-agencia` come deprecata.
- `web-factory-insiderslab` (tabella "Delegación a otras skills"): riga "Audit UX del sito
  attuale, direzione visiva, accessibilità oltre il go-live → `ux-ui-agencia`".
- `qc-sito-cliente` §8 e `digital-audit-agencia` §7: riga reciproca verso `ux-ui-agencia`
  (usabilità e conversione, non verità dei contenuti).
- Passare la v1.1 a `harness-audit` (SCHEDA) e i casi F-002…F-006 a `harness-replay`;
  esiti attuali in `ux-ui-agencia/evals/esiti-v1.md`.
