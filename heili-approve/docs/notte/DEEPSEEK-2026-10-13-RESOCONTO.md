# Resoconto notte DeepSeek — 13/10/2026 (branch `deepseek/notte-2026-10-13`)

## Riepilogo in cima

- **Fatte:** H-01, H-02, U-01, H-03, H-04, U-03, U-02, U-06, U-07, U-05, U-04, U-08, H-05
- **Saltate:** niente di previsto; **e2e e schermate impossibili** (vedi punto 1 e 2 sotto)
- **Resta da fare:** niente sul piano; la verifica visiva/e2e delle attività H/U resta all'ambiente completo
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

### H-02 — Il pannello di oggi dentro il dock (fatta, commit `1e85947`)

- `PostReview`, `BlogReview`, `AdsReview` registrano il contesto di revisione (post, versione, modalità decisione/feedback, marcatori video/passaggio/variante/punto, azioni) e non montano più `AssistantPanel` inline: il dock lo monta con le stesse prop e la stessa chiave di sessione. Il pulsante «Parla con Heili» accanto al commento apre il dock; `?heili=1` lo apre all'arrivo.
- Nuovo flusso dal pannello: «Indica un punto sull'immagine» / «Indica il momento sul video» chiude il dock, il tocco su anteprima/«Commenta a 0:07» diventa un marcatore nel messaggio (`insertMarker`) e il dock si riapre. Su desktop il dock è non modale, quindi i marcatori restano cliccabili.
- Rimossi `AssistantToggle` e «Torna al commento manuale». Aggiornate le spec `e2e/assistant-after-changes.spec.mjs` (pulsante `heili-dock-button`, punto sull'immagine → `[punto media=0…`, intro di modalità feedback al posto dell'intestazione nascosta) e `e2e/approval-flow.spec.mjs` (senza chiave AI: dock = Guida, nessuna chat).
- **Incidente tecnico (risolto)**: per rinominare una funzione ho usato `Get-Content | Set-Content` di PowerShell, che ha doppiocodificato gli accenti di `post-review.tsx`. Ho riparato con una conversione inversa cp1252→UTF-8, rimosso il BOM e verificato la `diff` (nessun altro danno). Verificato anche il testo «sarà» nel markup.
- tsc/eslint/vitest verdi (990 test).

### U-01 — Messaggi del cliente duplicati (fatta, commit `9dafeee`)

- Guardia sincrona sull'invio (ref `sendingRef`, non solo lo stato `busy`: Invio + clic nello stesso istante non fanno partire due POST), bolla ottimistica nascosta appena la copia del server è l'ultimo messaggio, nuovo tentativo senza duplicare.
- Test unit `assistant-message-dedup.test.ts` su `visiblePendingMessage` e `sendBlocked`; e2e aggiornato: con il mock che risponde sempre la stessa frase, messaggio del cliente e risposta compaiono **una volta sola**.

### H-03 — Guida su tutte le pagine (fatta, commit `b84e4ee`)

- La Guida deterministica era stata costruita con H-01 (frase di stato dal contesto, prossimo passo, scorciatoie, domande frequenti dal catalogo, scheda accanto a Feedback nelle pagine contenuto).
- Test unit sulla scelta del prossimo passo (la `next` vince, quelle fuori dal portale vengono scartate) e sulle schede; e2e `approval-flow`: dalla home la Guida offre il primo post da rivedere (`href` esatto).

### H-04 — La voce in primo piano (fatta, commit `e03c783`)

- «Parla a voce» è il pulsante grande in cima al pannello, con «oppure scrivi» sotto; la logica di `useLiveConversation` non è cambiata.
- Durante la chiamata: stato con parola e punto colorato (Preparo il contesto… / Collegamento… / In ascolto / Heili sta parlando / In pausa / Salvo la conversazione…), tempo residuo, «Silenzia», «Termina», sottotitoli dal vivo in una fascia leggibile.
- Voce non disponibile: il pulsante resta e una riga spiega il motivo proponendo la chat. Test unit su `liveStatus` (7 casi).

### U-03 — Passi del riepilogo (fatta, commit `0f59db4`)

- Indicatore compatto «1 Parla · 2 Controlla · 3 Invia» in cima al pannello con `aria-current="step"`. Il riepilogo **era già modificabile** nella casella prima dell'invio (`changesDraft`): nessun cambio lato server necessario. Test unit su `assistantStep`.

### U-02 — Chi parla nel riepilogo (fatta, commit `2966548`)

- Il blocco nel pannello ora è «Riepilogo per l'agenzia»; i tre prompt di riepilogo (social, articolo, annunci) chiedono la prima persona («Vorrei che…»), senza report sul cliente e senza il suo nome. Test prompt aggiornati sui tre tipi.

### U-06 — Intestazione e chiusura del pannello (fatta, commit `cc7c464`)

- «Torna al commento manuale» rimosso con H-02; il dock ha X «Chiudi Heili» in alto a destra e titolo «Heili» + contesto. Nel campo commento «Annulla» compare solo quando c'è qualcosa da scartare (a vuoto niente pulsante a tutta larghezza). Test unit sul composer vuoto.

### U-07 — Attesa ed errori della chat (fatta, commit `ecb2b60`)

- «Heili sta scrivendo» con tre puntini, animazione solo con `prefers-reduced-motion: no-preference` (`.typing-dots` in `globals.css`). Errore su una riga con «Riprova»; il testo scritto non si perde (torna nella casella quando il server non l'ha salvato). Test unit su sorgente e gate reduced-motion.

### U-05 — Home più diretta (fatta, commit `0bd3f25`)

- Un solo invito principale (il pulsante in evidenza; la scheda del piano resta una porta quieta «Apri il piano»), niente «0 approvati» (né «0» con soli cambi richiesti) nella barra di avanzamento, titolo ridotto e frase su ciò che aspetta il cliente in evidenza.
- I tre passi «Guarda · Commenta · Concludi» solo alla prima visita (localStorage per token), poi riga compatta «Come funziona?» che apre la Guida di Heili. Test su progress bar a zero e riga compatta.

### U-04 — Barra delle decisioni su telefono (fatta, commit `01f7415`)

- Pulsanti 48 px/16 px, nessun ritorno a capo a 390 px anche per «Invia le mie decisioni» (che mantiene la sua larghezza). Il principale non cambia (QA-09). Test unit sulle classi delle tre barre.

### U-08 — Sfoglia su telefono (K-10) (fatta, commit `ae24629`)

- Intestazione della card su due righe compatte (titolo fra le frecce, poi stato e versione), avanzamento con nuova taglia `xs` della `PlanProgressBar`, spazio riservato sotto la card su telefono: il pulsante galleggiante di Heili resta sopra la barra (`--decision-bar-h`) e fuori dall'immagine. **Verifica visiva 390×844 non fatta**: serve l'ambiente con database.
- Nota: il timeout dei test vitest è passato a 15 s in `vitest.config.ts` (i render delle pagine con il dock superavano i 5 s sotto carico; verifiche invariate).

### H-05 — Documento «Guida a voce» (fatta, `docs/HEILI-GUIDA-VOCALE.md`)

- Proposta completa e volutamente **non implementata**: sessione live di portale senza media, strumento `navigate` con soli id validati dal server, consegna della direttiva via polling sulla rotta voce, limiti/costi, rischi di iniezione e contromisure, test necessari. Da rivedere con Claude e Stefano.

## Verifica finale (ultima notte)

- `npx tsc --noEmit`: **pulito**.
- `npx vitest run --maxWorkers=4`: **67 file, 1003 test, tutti verdi**.
- `npm run build` **tentato**: si ferma con `FATAL ERROR: Zone Allocation failed - process out of memory` (Turbopack, esaurimento risorse della macchina — probabilmente anche per il processo esterno QA-17 attivo). Non è un errore di codice emerso dai test; **va rilanciato in CI** o su una macchina libera.
- E2e e schermate: **non eseguibili stanotte** (niente Postgres, Redis, worker, Playwright né `sh` su questa macchina). La cartella `docs/notte/shots-13-10/` non è stata creata; le spec e2e sono aggiornate dove serviva e vanno eseguite in ambiente completo.

## Commit sul branch (da `f81d10b`)

```
742e830 H-01  dock di Heili nel portale
1e85947 H-02  il pannello di Heili vive nel dock
9dafeee U-01  un solo messaggio del cliente in chat
b84e4ee H-03  la Guida di Heili
e03c783 H-04  la voce in primo piano
0f59db4 U-03  indicatore dei passi
2966548 U-02  riepilogo per l'agenzia, prima persona
cc7c464 U-06  intestazione e chiusura del pannello
ecb2b60 U-07  attesa con i puntini, errore con «Riprova»
0bd3f25 U-05  home più diretta
01f7415 U-04  barra delle decisioni su una riga
ae24629 U-08  Sfoglia su telefono (K-10)
436fc94 H-05  documento Guida a voce
```

## Cosa deve controllare Claude domattina

1. **e2e**: eseguire `assistant-after-changes`, `approval-flow`, `blog-flow`, `ads-flow`, `month-review`, `monthly-plan` (aggiornate: assistant-after-changes per il pulsante galleggiante e il punto sull'immagine; approval-flow per la Guida senza chiave AI). Verificare in particolare: focus/Esc del dock, `?heili=1`, «Indica un punto sull'immagine», nessun overflow a 390 px (barre decisionali U-04 e Sfoglia U-08).
2. **Schermate prima/dopo**: da fare in ambiente con database (`docs/notte/shots-13-10/` non esiste).
3. **QA-17 esterno**: il working tree contiene ancora le modifiche dell'altro processo (wording «annunci», test aggiornati, `glossary.test.ts`), preservate in `stash@{0}` «qa17-wip». Non sono mie e non le ho committate: decidere se committarle, scartarle o riapplicarle. Nota: senza di esse, 6 test sul wording sono rossi anche sulla base (vedi sopra).
4. **Build di produzione**: lanciarla in CI (stanotte fallisce per OOM della macchina, non per errori di codice).
5. **Revisione di `docs/HEILI-GUIDA-VOCALE.md`** (H-05): decisioni su tool Live vs backend, polling vs SSE, salvataggio o no delle sessioni di guida.
6. **Dettaglio di prodotto da confermare**: in Sfoglia il pulsante galleggiante sopra la barra e lo spazio riservato sotto la card vanno visti a 390×844 reali; in H-04 i testi «Silenzia»/«Termina» sostituiscono le vecchie etichette.

