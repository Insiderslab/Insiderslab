# Prompt per Muse: correzioni ai 4 branch `muse/*` di heili-platform (revisione del 13/10)

Incolla in Muse (sul PC di Stefano, cartella `heili-platform`) tutto il blocco qui sotto, così com'è.

---

Sei l'agente che ha scritto i branch `muse/ux-core`, `muse/page-viste`, `muse/accessibilita` e `muse/test-ambientali` di **Insiderslab/heili-platform**. Un revisore indipendente li ha letti tutti e quattro: **nessuno è pronto per il merge**. Correggi i punti qui sotto **nell'ordine indicato**, rispettando `AGENTS.md` e `docs/LEGGI-AI-CODING.md`:
- un branch per mandato;
- nessun merge su `main`;
- un registro di lavoro aggiornato per ogni branch.

## Ordine di lavoro
1. **page-viste** per primo: è la modifica strutturale e gli altri ci si appoggiano.
2. **accessibilita**: rifai il rebase su page-viste.
3. **ux-core**: rifai il rebase su page-viste e accessibilita, poi porta le sue modifiche dentro i moduli `shell-*`.
4. **test-ambientali**: è indipendente, puoi farlo in qualsiasi momento.

## 1. muse/page-viste
- **ALTA: la regex di `safeWorkspaceSlug` è doppiamente escapata.**
  - In `app/lib/shell-validation.ts:310` c'è `/[\\u0300-\\u036f]/g`. Così la classe copre l'intervallo `0`–`\` e cancella cifre, maiuscole, `u` e `f`.
  - Esempi: «Acme Srl» → `cme-rl` invece di `acme-srl`; «AGENTE» → `workspace`.
  - Lo slug finisce in `POST /api/brain/agents`. Ripristina la regex di `main` (combinanti U+0300–U+036F) e aggiungi un **test di comportamento**: «Acme Srl» → `acme-srl`, «Studio Rossi» → `studio-rossi`, «Caffè Àrtico» → `caffe-artico`, «AGENTE» → `agente`.
  - Correggi anche il registro, che la dichiara «byte-identica».
- **Test indeboliti: ripristina la forza originale.** Le stringhe originali esistono ancora, nei file nuovi.
  - `tests/product-management-ui.test.mjs`:
    - torna a verificare il validatore runtime `["oauth2","api-token","local","none"]`, non il tipo TypeScript;
    - rimetti i controlli di unicità `.size !== providers.length` e `clients.length`;
    - `MAX_LOCAL_WORKSPACES = 12` con il valore;
    - rimetti l'asserzione su `describeConnectorSync(selectConnectorAccount(accounts, connector), now)`.
  - `tests/product-interop-ui.test.mjs:57-58`: di nuovo `connect-heili\.ps1` e `-Client \$\{selected\.id\}`.
  - **Asserzioni negative su tutta la shell.** Crea un helper che legge `app/page.tsx` più **tutti** i file `app/components/shell-*.tsx` e `app/lib/shell-*.ts`, e usalo per: `NEXT_PUBLIC_`, `type="password"`, `--token ` e la lista del gergo di `testi-imprenditore`.
  - `tipo-effettivo-da-tag.test.mjs` deve tornare a leggere anche `page.tsx`.
- Regola §3.6: il commit di refactor da solo non deve essere rosso. Se necessario riordina i commit sul **tuo** branch (è tuo, e nessuno l'ha ancora unito), così che i test siano verdi a ogni commit.

## 2. muse/accessibilita (rebase su page-viste)
- **MEDIA: `tests/accessibilita.test.mjs:97`** asserisce `.space-select-wrap::after { … color: #a5b8b1`, ma ux-core toglie quella regola. Asserisci invece `.space-select-chevron`, con lo stesso colore e contrasto.
- **BASSA: il nome accessibile non è l'etichetta visibile.** Collega il select a `id="space-label"` con `aria-labelledby`, e allinea il testo sr-only a «Spazio attivo» (WCAG 2.5.3). Togli l'`htmlFor` ridondante.
- Nit: il test del contrasto verifichi anche che i colori del menu siano davvero dichiarati nel CSS.

## 3. muse/ux-core (rebase su page-viste + accessibilita, modifiche portate nei moduli)
- **MEDIA: tutti ora atterrano su Note invece che su Panoramica.** L'effetto di `page.tsx:900-905` rimbalza prima che le preferenze siano caricate. Collegalo a `settingsReady`, e non spostare la vista se quella corrente è visibile o è Panoramica.
- **MEDIA: il testo specifico dell'errore di login spesso non compare.** Si vede solo nel ramo `authBanner === "retry"`. In `authBannerState`, conta `authErrorCode` come un tentativo, così il messaggio si vede anche da un'altra scheda o con il sessionStorage bloccato.
- **MEDIA: agli utenti esistenti spariscono dei moduli.**
  - **Web:** «primo avvio» deve valere solo se non esiste nessun dato dell'utente, non solo perché manca la chiave `heili.product-settings.v1`. Non mostrare solo i moduli essenziali a chi ha già spazi o dati.
  - **Desktop:** in `desktop/main.cjs:35`, un file corrotto o illeggibile non deve ricadere sugli essenziali. Mostra tutti i moduli e scrivi un avviso nel log.
- **BASSA: i pulsanti verso moduli nascosti non fanno niente.** «Aggiungi una fonte», `openWiki` e `openClientWiki` con il modulo nascosto: attiva il modulo oppure mostra un messaggio chiaro con il link alle Impostazioni.
- **Nit:**
  - «Chiudi» deve chiudere davvero il banner.
  - Allinea commento e codice di `readAuthError` e gestisci il vecchio `?auth_error=access_denied`.
  - **Una sola fonte per regola (§3.2):** `AUTH_ERROR_CODES` in un solo modulo condiviso, e la lista delle viste in un solo posto, riusata da `OPTIONAL_VIEWS` e dal `knownViews` del desktop.
  - Test per il redirect quando manca il cookie di stato e quando lo scambio del codice fallisce.
  - Aggiorna le sezioni 5 e 8 del registro.
- `tests/moduli-essenziali.test.mjs` va ripuntato sui moduli `shell-*`. Usa l'helper creato in page-viste.

## 4. muse/test-ambientali
- **ALTA: senza build i test ora PASSANO.** `rendered-html.test.mjs:8,31` e `desktop-security.test.mjs:69` fanno `t.diagnostic` + `return`, che in node 22 conta come **pass**. Gli helper `need*` devono **fallire** (`assert.fail` con il messaggio chiaro), mai passare.
- **MEDIA: le dipendenze mancanti ora diventano SKIP di default.**
  - `t.skip()` senza `return` lascia girare il test e nasconde l'errore.
  - `t.skip()` dentro `test.before` non salta niente, verificato in node 22.
  - Correzione: per default **fallire** con il messaggio chiaro; saltare solo con un flag esplicito (per esempio `HEILI_TEST_ALLOW_SKIP=1`) e con `return` subito dopo.
  - Correggi il registro: un salto nell'hook non salta il file.
- **BASSA: `tests/tsx-loader.mjs:36`.** Imposta `esbuildChecked = true` solo **dopo** un import riuscito.
- **Nit:** il messaggio di `desktop/local-server.cjs` deve nominare il percorso reale (`app-dist`). `main.cjs:280-282` deve mostrarlo, non ignorarlo.

## Prove (per ogni branch)
- `npm ci`: incollandoti questo prompt Stefano lo autorizza, solo per questo lavoro e solo nella cartella `heili-platform`.
- `npm run lint`
- `npm test` (build + `node --test`): **tutto verde**, con il **numero di test** prima e dopo nel registro.
- Prova anche **senza build** (`node --test tests/*.test.mjs` dopo aver tolto `dist`): i test che hanno bisogno della build devono essere **rossi** con il messaggio chiaro, non verdi.
- **Sabotaggi:**
  - rompi lo slug: il nuovo test deve fallire;
  - togli `settingsReady`: un test deve fallire;
  - fai tornare un `need*` a «passa»: un test deve fallire.
- Dopo i rebase: `moduli-essenziali` e `accessibilita` devono passare **insieme**.

## Consegna
- Push dei branch aggiornati: hai rifatto il rebase dei **tuoi** branch, quindi va bene `--force-with-lease`.
- Per ogni branch, un riepilogo: cosa hai corretto, i numeri dei test e cosa resta da verificare nel browser (vista iniziale, banner dopo un vero errore di login, primo avvio del desktop).
- **Non unire su `main`**: lo decide Stefano dopo la nuova revisione.
