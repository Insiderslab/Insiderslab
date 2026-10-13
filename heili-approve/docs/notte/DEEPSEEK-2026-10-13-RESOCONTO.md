# Resoconto notte DeepSeek — 13/10/2026 (branch `deepseek/notte-2026-10-13`)

## Riepilogo in cima

- **Fatte:** H-01
- **Saltate:** niente finora
- **Resta da fare:** H-02 → U-01 → H-03 → H-04 → U-03 → U-02 → U-06 → U-07 → U-05 → U-04 → U-08 → H-05 (ordine del piano)
- **Da controllare da Claude domattina:**
  1. **e2e non eseguibili stanotte** (mancano Postgres, Redis, worker e Playwright su questa macchina; `sh` non c'è). Le spec e2e sono state aggiornate solo dove il percorso cambia; vanno eseguite in CI/ambiente completo.
  2. **Schermate prima/dopo non fatte** per lo stesso motivo: l'app non parte senza database. La cartella `docs/notte/shots-13-10/` non è stata creata.
  3. **Interferenza in working tree**: alle 01:10 un altro processo ha creato `stash@{0}` «qa17-wip» (su questo branch) e ha applicato in working tree le sue modifiche (wording «annunci» al posto di «creatività ads», test aggiornati). Non sono mie: **non le ho committate** e non le ho toccate. Le mie commit restano pulite. Il tree le contiene ancora insieme alle mie; lo stash le conserva.
  4. **Baseline prima dell'interferenza**: 6 test già rossi (3 file: `client-services`, `portal-review`, `share-link`), tutti sul wording «creatività ads» vs «annunci». Con le modifiche QA-17 applicate dal processo esterno la suite è verde. Non li ho corretti io.
- **Verifica finale di stanotte:** (aggiornata in fondo)

## Preparazione

- Fetch + `git checkout -b deepseek/notte-2026-10-13 origin/claude/bold-lovelace-xdiiw9` (base `f81d10b`).
- `npm ci`, `npx prisma generate` OK. Python reale in PATH per `automation-cli.test.ts`.
- Letti `AGENTS.md`, `docs/CONTRATTO.md`, `docs/STUDIO-DESIGN.md`, `docs/notte/DEEPSEEK-2026-10-13-HEILI.md`.
- Baseline `npx tsc --noEmit`: pulito. Baseline `npx vitest run --maxWorkers=4`: 6 falliti (vedi sopra), poi spariti con l'applicazione del QA-17 esterno.

## Attività

### H-01 — Fondamenta del dock (fatta, commit `742e830`)

- Nuovi: `components/portal/heili/` (`types.ts`, `rules.ts`, `context.tsx`, `heili-page.tsx`, `heili-dock.tsx`, `heili-guide.tsx`).
- `HeiliProvider` nel layout del portale; ogni pagina registra contesto e destinazioni **calcolate dal server** (home, piano nelle tre viste, mese, Sfoglia). Le destinazioni vengono rifiltrate nel client: solo `/review/<token>/…`, niente `..` (test unit).
- Pulsante galleggiante 56 px con `aria-label` «Parla con Heili», sopra la barra delle decisioni grazie a `--decision-bar-h` esposto dalla `DecisionBar`; nuvoletta di prima visita (localStorage per token, try/catch, 6 s); sheet modale su telefono, pannello 400 px su desktop; Esc chiude; focus restituito.
- La Guida deterministica (frase di stato dal contesto, prossimo passo, scorciatoie, domande frequenti dal catalogo) è nel dock; rimosso «Guida e aiuto» dal layout cliente (`HelpGuide` resta per l'agenzia).
- Test: `__tests__/heili-dock.test.ts` (8). tsc/eslint/vitest verdi.
- Aggiornati al nuovo albero i test strutturali `month-review.test.ts` e `plans.test.ts` (stesse verifiche, il frame non è più l'unico figlio di `<main>`).
- **Non eseguiti**: e2e «pulsante visibile su home/piano/Sfoglia/post, non copre Approva a 390 px, Esc chiude» — ambiente assente (vedi sopra).
