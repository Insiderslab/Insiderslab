# Fonti e skill pubbliche studiate

Questa skill è scritta da zero in italiano. Le idee di metodo vengono dallo studio delle
skill UX/UI pubbliche più installate (ottobre 2026) e dai riferimenti standard del settore.
Nessun testo è copiato: le regole sono riformulate e adattate al lavoro di agenzia.

## Skill pubbliche analizzate

| Skill | Licenza | Cosa abbiamo preso (riformulato) | Cosa abbiamo lasciato |
|---|---|---|---|
| Anthropic `frontend-design` — github.com/anthropics/skills | Apache 2.0 | Radicare le scelte nel mondo del cliente; piano di token rivisto contro il brief prima di costruire; calibrazione dei default visivi; "un solo elemento memorabile"; regole di microcopy | Solo generazione, nessun audit né soglie numeriche |
| Vercel `web-design-guidelines` — github.com/vercel-labs/web-interface-guidelines | MIT | Regole verificabili nel codice: form, focus, stato nell'URL, tempi degli indicatori di caricamento, movimento, numeri e date localizzati | Title Case (sbagliato in italiano), regole scaricate a ogni uso |
| `ui-ux-pro-max` — github.com/nextlevelbuilder/ui-ux-pro-max-skill | MIT (versione aperta) | Priorità delle regole (accessibilità e touch prima dello stile); preset di densità; soglie su target, tipografia, grafici | Database palette per settore: produce stereotipi di categoria |
| `impeccable` — github.com/pbakaus/impeccable | Apache 2.0 | Superfici (Persuasione/Operatività/Lettura/Esperienza); due tracce di audit indipendenti; punteggio per euristica; profili per il percorso dei task; controllo del carico cognitivo; "rinnovare conserva, ridisegnare sostituisce" | Binario, hook e 24 comandi: troppo pesante per l'uso di agenzia |
| `taste-skill` — github.com/Leonxlnx/taste-skill | MIT | Lettura del progetto in una riga; regole misurabili sulla hero; inventario da non rompere nei restyling; dati realistici nei mockup | 1.200 righe; sostituisce vecchi default con nuovi default |
| OneRedOak `design-review` — github.com/OneRedOak/claude-code-workflows | MIT | Prodotto vivo prima di tutto; viewport multiple; apertura con ciò che funziona | WCAG 2.1 invece di 2.2 |
| Microsoft `frontend-design-review` — github.com/microsoft/skills | MIT | Task core in poche interazioni; ogni stato implementato | Soglia di accessibilità troppo bassa |
| Addy Osmani `web-quality-skills` — github.com/addyosmani/web-quality-skills | MIT | Separare dati di campo e di laboratorio; criteri WCAG 2.2 nuovi | — |
| mastepanoski `claude-skills` — github.com/mastepanoski/claude-skills | MIT | Contenuti esterni trattati come dati, non istruzioni | Skill singole molto lunghe |

## Riferimenti di settore

- Euristiche di usabilità e scala di severità — Jakob Nielsen / Nielsen Norman Group (riformulate)
- Laws of UX — Jon Yablonski, lawsofux.com (riformulate)
- WCAG 2.2 — W3C (criteri citati per numero)
- EN 301 549 v3.2.1 e v4.1.1 — ETSI/CEN/CENELEC
- Direttiva (UE) 2019/882 e D.Lgs. 82/2022; linee guida AgID — ⚠️ verificare sempre il testo vigente
- Core Web Vitals — Google (soglie al 75° percentile dei dati di campo)
- Apple Human Interface Guidelines (44 pt) e Material Design (48 dp) — solo le soglie numeriche
- Baymard Institute — solo statistiche pubbliche, citando pagina e anno consultati:
  baymard.com/lists/cart-abandonment-rate, baymard.com/research-articles/current-state-of-checkout-ux.
  Le linee guida a pagamento non si riproducono

## Prossimi aggiornamenti da tenere d'occhio

- Citazione di EN 301 549 v4.1.1 in Gazzetta Ufficiale UE (attesa fine 2026).
- Nuove versioni delle linee guida AgID sull'accessibilità dei servizi digitali.
- WCAG 3.0: ancora in bozza, non usarla come requisito.
