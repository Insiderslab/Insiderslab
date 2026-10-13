# Lavoro notturno per DeepSeek — 13/10/2026: Heili sempre a portata di mano + rifiniture UX/UI del portale

Due obiettivi per stanotte, nel portale del cliente (`app/review/[token]/…`):

- **A.** Heili diventa un **assistente galleggiante**: un pulsante fisso in basso a destra, presente in tutte le
  pagine del portale. Accompagna il cliente in ogni fase (home, piano, Griglia, Sfoglia, mese, singolo post) e lo
  aiuta a muoversi nella piattaforma.
- **B.** Rifiniture di UX/UI emerse dall'analisi di Claude (codice + schermate del test dell'11/10).
- **C.** Nuovo tipo di contenuto **«Sito web»** (revisione di un sito con annotazioni e Heili): **stanotte solo il
  documento di progetto**, il codice si fa dopo con Claude.

## Regole (le stesse della notte scorsa (Kimi), più due)

1. Leggi `AGENTS.md`, `docs/CONTRATTO.md`, `docs/STUDIO-DESIGN.md` e seguili. Testi in italiano, stati sempre con
   una parola, campi a 16 px, aree toccabili da 44 px, niente gradienti/emoji, movimento breve e solo con
   `prefers-reduced-motion: no-preference`.
2. Branch tuo: `git fetch origin && git checkout -b deepseek/notte-2026-10-13 origin/claude/bold-lovelace-xdiiw9`.
   Mai push su `claude/bold-lovelace-xdiiw9` o `main`, niente deploy, niente `.env`, segreti, migrazioni Prisma o
   `app/generated/`.
3. Un commit per attività con l'id in testa (`H-03: …`, `U-05: …`), push dopo ogni commit. Prima di ogni commit:
   `npx tsc --noEmit`, `npx eslint <file>`, `npx vitest run --maxWorkers=4` verdi. Non indebolire test.
4. **Sicurezza di Heili, invariabile:** Heili non approva, non invia, non programma, non cancella, non cambia stato
   a nulla. Può solo: parlare, aiutare a scrivere il feedback, preparare il riepilogo che il cliente invia con un
   pulsante, e **portare il cliente a una pagina** del suo portale. Mai link fuori da `/review/<token>/…`.
5. **Non rompere quello che c'è:** marcatori su immagine (punto), momento del video, passaggio dell'articolo,
   variante ads, modalità «decisione» (post da approvare) e «feedback» (dopo «Chiedi modifiche»), limiti di voce,
   riepilogo e `«Aggiungi al feedback»`. Gli e2e `assistant-after-changes`, `approval-flow`, `blog-flow`,
   `ads-flow`, `month-review`, `monthly-plan` devono restare verdi (aggiornali solo se cambia un'etichetta o un
   percorso, mantenendo le stesse verifiche).
6. **Schermate:** per ogni attività visibile salva prima/dopo a 390×844 e 1366×900 in `docs/notte/shots-13-10/`
   (cartella nuova, va bene committarla). Se gli e2e riscrivono `docs/screenshots/`, ripristinali.
7. Resoconto in `docs/notte/DEEPSEEK-2026-10-13-RESOCONTO.md`, aggiornato dopo ogni attività (riepilogo in cima).

## Com'è oggi (per orientarti)

- Heili è il componente `components/review/assistant-panel.tsx` (~1080 righe): chat testuale + dettatura +
  «Conversazione vocale» (WebRTC verso il modello live; `components/voice/use-live-conversation.ts`; lato server
  `lib/review-assistant/live-*.ts`, rotte `app/api/review/[token]/assistant/…`). La sessione è legata a
  `postId` + `versionNumber`.
- Viene montato **dentro** la sezione «Il tuo feedback» delle pagine contenuto (`components/portal/post-review.tsx`,
  `blog-review.tsx`, `ads-review.tsx`) tramite `AssistantToggle` / `AssistantActionButton`
  (`components/portal/review-pieces.tsx`). Le pagine passano al pannello `getVideoTime`, `getPointContext`,
  `getSelection`, `getContext` per i marcatori.
- Su home (`app/review/[token]/page.tsx`), piano (`piani/[planId]`), mese (`mese/[month]`) e Sfoglia
  (`components/portal/month/browse.tsx`, che ha solo un link «Parla con Heili» verso il post con `?heili=1`)
  Heili non c'è. Il layout (`app/review/[token]/layout.tsx`) mostra un pulsante separato «Guida e aiuto»
  (`components/help/help-guide.tsx`, contenuti in `lib/help/catalog.ts`).
- Problemi visti nelle schermate:
  - il pannello è lungo e inline, e la voce sta in fondo, sotto la chat;
  - l'intestazione «Torna al commento manuale» confonde;
  - la barra Chiedi modifiche/Approva copre il fondo del pannello;
  - nel test sono comparsi messaggi del cliente duplicati (vedi U-01).

---

## Parte A — Heili galleggiante

### H-01 — Fondamenta: contesto di pagina e «dock» nel layout del portale

- Crea un provider client `HeiliProvider` montato in `app/review/[token]/layout.tsx` (sotto l'intestazione) e un
  hook `useHeiliPage(context)` che ogni pagina del portale usa per registrare il proprio contesto:
  ```ts
  type HeiliPageContext = {
    page: "home" | "plan" | "plan-grid" | "browse" | "month" | "post" | "article" | "ads";
    title: string;                 // es. "Piano social di novembre", "Post 3 di 12"
    summary?: string;              // es. "12 post, 3 da rivedere"
    // Pagine dove il cliente può andare da qui (calcolate dal SERVER, solo href /review/<token>/…):
    destinations: Array<{ id: string; label: string; href: string; kind: "next" | "plan" | "home" | "post" | "view" }>;
    // Solo nelle pagine contenuto: quello che serve al pannello di oggi
    review?: { postId: string; versionNumber: number; mode: "decision" | "feedback"; kind: AssistantContentKind;
               getVideoTime?, getPointContext?, getSelection?, getContext?, onSubmitChanges, onApprove?, … };
  };
  ```
  Le `destinations` arrivano dalla pagina server (stessi dati che già calcola: prossimo post da rivedere, piano,
  vista Griglia/Sfoglia, home). Il client **non** costruisce href liberi: Heili può proporre solo quelle.
- Componente `HeiliDock` (client) dentro il provider:
  - **Pulsante galleggiante**: tondo 56 px, icona `HeiliAssistantIcon`, `aria-label="Parla con Heili"`. Fisso in
    basso a destra con `env(safe-area-inset-bottom)`. Sulle pagine con `DecisionBar` deve stare **sopra** la barra
    (misura l'altezza della barra o esponi una variabile CSS `--decision-bar-h` dalla `DecisionBar`), mai sopra i
    pulsanti.
  - **Apertura**: su telefono un bottom sheet a tutta larghezza alto fino al 85% (riusa
    `components/portal/bottom-sheet.tsx` se adatto); su desktop (≥1024 px) un pannello laterale destro di 400 px che
    non copre il contenuto principale. Esc chiude, focus intrappolato quando è modale (telefono), focus restituito
    al pulsante, `aria-live="polite"` per i nuovi messaggi.
  - **Prima visita**: una nuvoletta discreta accanto al pulsante «Ciao, sono Heili: ti accompagno nella revisione»,
    che sparisce al primo tocco o dopo 6 s. Si ricorda in `localStorage` per token, in un `try/catch`.
- Rimuovi il pulsante separato «Guida e aiuto» dal layout del portale: i suoi contenuti vanno dentro il dock (H-03).
  Il componente `HelpGuide` resta per l'area agenzia.
- Test: unit sul provider (registrazione e cambio di contesto alla navigazione) e sul filtro delle destinazioni
  (rifiuta href fuori da `/review/<token>/`). E2e: il pulsante è visibile su home, piano, Sfoglia, post, non copre
  Approva a 390 px, Esc chiude.

### H-02 — Sulle pagine contenuto: il pannello di oggi dentro il dock

- Nelle pagine post/articolo/ads il dock mostra **lo stesso** `AssistantPanel` di oggi, con le stesse prop (prese da
  `review` del contesto). Togli il pannello inline dalla sezione «Il tuo feedback». Il pulsante «Parla con Heili» nel
  campo commento resta, ma apre il dock.
- Tutti i marcatori devono continuare a funzionare con il dock aperto. Su telefono serve un modo per tornare
  all'immagine e toccare un punto: un pulsante «Indica un punto sull'immagine» chiude temporaneamente il sheet,
  e dopo il tocco il marcatore entra nel messaggio e il sheet si riapre. Stesso schema per «Usa il momento attuale»
  del video.
- `?heili=1` (da Sfoglia) apre il dock già aperto.
- La modalità («decisione»/«feedback») e tutte le regole server restano quelle di oggi (`checkAssistantAccess`).
- Test: aggiorna `e2e/assistant-after-changes.spec.mjs` (stesse verifiche, Heili aperto dal pulsante galleggiante)
  e verifica che un punto sull'immagine e un momento video arrivino nel messaggio.

### H-03 — Modalità «Guida» su tutte le pagine (senza modello AI)

Quando la pagina non è un contenuto da commentare, o quando il cliente sceglie «Come funziona?», il dock mostra la
**Guida**:
- In alto una frase di stato costruita dal contesto: es. «Sei nel piano di novembre: 12 post, 3 da rivedere.»
- **Prossimo passo** in evidenza: un pulsante con la prima destinazione `kind: "next"` («Rivedi il prossimo post»).
- **Scorciatoie** (chip) dalle altre `destinations`: «Vai alla griglia», «Rivedi veloce (Sfoglia)», «Torna
  all'inizio»…
- **Domande frequenti** dal catalogo client di `lib/help/catalog.ts` (quello di «Guida e aiuto»), filtrate per pagina
  quando ha senso.
- Nelle pagine contenuto la Guida è una seconda scheda accanto a «Feedback» («Feedback · Guida»).
- Niente chiamate al modello in questa modalità: è tutta deterministica, veloce e gratis.
- Test: unit sulla scelta del prossimo passo per ogni pagina; e2e che dalla home il dock porti al primo post da
  rivedere.

### H-04 — La voce in primo piano

- In cima al pannello Heili (modalità feedback/decisione) un pulsante grande «Parla a voce» (microfono), con sotto
  «oppure scrivi»; la chat testuale sotto. Oggi «Conversazione vocale» è in fondo: spostala in alto senza cambiare
  la logica di `useLiveConversation`.
- Durante la chiamata: stato chiaro con parola + icona (In ascolto / Heili sta parlando / In pausa), tempo residuo,
  «Silenzia», «Termina»; sottotitoli dal vivo (testo cliente e testo Heili che già ricevi) in una fascia leggibile.
- Se la voce non è disponibile (browser, permessi, limiti giornalieri) il pulsante resta visibile ma spiega il
  motivo in una riga e propone la chat (riusa i testi fatti per QA-10).
- Test: unit sugli stati; nessun e2e con microfono reale.

### H-05 — Documento di progetto per la «Guida a voce» (solo documento, niente codice)

Il passo successivo è che Heili guidi anche **a voce** la piattaforma, per esempio «portami al prossimo post» o
«apri la griglia». Stanotte **non implementarlo**: scrivi `docs/HEILI-GUIDA-VOCALE.md` con una proposta dettagliata:
- **Sessione live senza post:** contesto del portale con titoli, stati e numeri, senza media.
- **Strumento `navigate`:** la funzione che il modello chiama accetta solo un `id` tra le `destinations` inviate dal
  server. Il browser esegue `router.push` solo se l'id è nella lista ricevuta.
- **Dove passa la chiamata allo strumento:** spiega come si collega all'architettura attuale (WebRTC più canale
  laterale, `lib/review-assistant/live-runtime.ts`, oggi `tools: []`).
- **Limiti e costi.**
- **Rischi**, cioè l'iniezione di istruzioni dai testi dei post, **e come evitarli.**
- **I test necessari.**

Sarà rivisto da Claude e Stefano.

---

## Parte B — Rifiniture UX/UI

### U-01 — Chat di Heili: messaggi del cliente duplicati (Media, da riprodurre)
Nella schermata del test (`Il testo mi sembra troppo formale` ripetuto tre volte, con due risposte uguali) i
messaggi del cliente compaiono più volte. Riproduci con il mock AI dell'e2e `assistant-after-changes`. Controlla
invio doppio (Invio + clic), messaggio ottimistico più quello del server, e nuovi tentativi
(`sendMessage(true)` in `assistant-panel.tsx`). Correggi in modo che ogni messaggio compaia una volta, e che un
nuovo tentativo non duplichi. Test di unità o e2e che lo dimostri.

### U-02 — Riepilogo di Heili: chi parla (Bassa)
Il riepilogo che il cliente rivede è mostrato come «Tu» ma è scritto in terza persona («Il cliente vorrebbe…»).
Mostralo come «Riepilogo per l'agenzia» (non «Tu»), e nel prompt del riepilogo chiedi la **prima persona**
(«Vorrei che…»). Aggiorna i test del prompt.

### U-03 — Passi del riepilogo chiari (Media)
Il flusso «Prepara il riepilogo per l'agenzia» → controllo → «Invia le modifiche all'agenzia» / «Aggiungi al
feedback» è a due passi ma non si vede. Aggiungi un indicatore compatto «1 Parla · 2 Controlla · 3 Invia» in cima al
pannello, con il passo attuale evidenziato. Il riepilogo deve essere modificabile prima dell'invio se oggi non lo è
(verifica; se richiede cambi lato server, salta e annota).

### U-04 — Barra delle decisioni su telefono (Bassa)
A 390 px «Chiedi modifiche» va su due righe. Pulsanti su una riga, testo 16 px, altezza 48 px. **Non cambiare**
quale dei due è il principale (decisione aperta di Stefano, QA-09).

### U-05 — Home del portale più diretta (Media)
Nella home (`app/review/[token]/page.tsx`):
- c'è un doppione: «Rivedi il piano del mese» in alto e «Rivedi il piano» nella scheda. Tieni un solo
  invito principale;
- «0 approvati» quando è zero non serve;
- i tre passi «Guarda · Commenta · Concludi» li mostri pieni solo alla prima visita (poi riga compatta
  «Come funziona?» che apre la Guida di Heili, H-03);
- il titolo grande «Un contenuto alla volta.» va ridotto: in evidenza ciò che c'è da fare («3 post aspettano la tua
  revisione»).

### U-06 — Pannello Heili: intestazione e chiusura (Bassa)
Togli «Torna al commento manuale»: nel dock c'è la X «Chiudi» in alto a destra e il titolo «Heili» con il contesto
(«Post 3 di 12 · Instagram»). Se il campo commento è vuoto, niente pulsante «Annulla» a tutta larghezza.

### U-07 — Stati di attesa e di errore della chat (Bassa)
Mentre Heili risponde: «Heili sta scrivendo…» con tre puntini (fermi con reduced motion). In caso di errore:
messaggio in una riga e «Riprova», senza perdere il testo scritto.

### U-08 — Sfoglia su telefono: più spazio all'immagine (Bassa) — è la K-10 della notte scorsa (Kimi)
Se non è già stata fatta: intestazione compatta in Sfoglia, immagine 4:5 intera sopra la barra Commenta/Approva a
390×844. Il pulsante galleggiante di Heili non deve coprire l'immagine né la barra.


---

## Parte C — Revisione di un sito web («Sito web»): STANOTTE SOLO IL PROGETTO

**Richiesta di Stefano.** Il cliente rivede un sito, di solito la versione di prova di un sito fatto da noi, con le
stesse funzioni dei post: annotazioni puntuali, commenti scritti o dettati, Heili che guida, e alla fine approva o
chiede modifiche.

**Decisione presa (non riaprirla):**
1. **Siti nostri → «Sul sito»**: una riga di codice nel sito (`<script src="https://approve.heili.cloud/heili-review.js"
   data-site="CHIAVE" defer></script>`). Il cliente apre il sito vero dal link di revisione, naviga normalmente e con il
   pulsante galleggiante di Heili tocca un elemento per commentarlo. Il plugin WordPress verrà dopo, solo come comodità
   per inserire la riga.
2. **Siti non nostri → «Istantanee»**: il server fotografa le pagine a tutta altezza (computer 1440 px, telefono
   390 px) e il cliente annota sulle foto, come sulle immagini dei post.
3. Scartato: caricare il sito «attraverso» Approve con un proxy, perché è fragile e farebbe girare codice estraneo
   nel nostro dominio.

### C-01 — Documento di progetto `docs/SITO-WEB.md` (unica attività della Parte C stanotte: niente codice)

Scrivilo in italiano, nello stile di `docs/VARIANTI.md`, con decisioni concrete e i file da toccare. Deve coprire:

- **Modello dati.** Nuovo `ContentKind` `WEBSITE`. Contenuto della versione: URL del sito, modalità
  (`live`/`snapshot`), pagine e, per le istantanee, le catture. Un «giro di revisione» corrisponde a una versione:
  l'approvazione vale per il giro. Ancoraggio dei commenti in `PostComment.anchor`: `{ pageUrl, device,
  viewport: {w,h}, selector, textSnippet, offsetX, offsetY, scrollY, captureRef? }` per «Sul sito»;
  `{ pageId, device, x, y }` per «Istantanee».
- **Lo script «Sul sito»**, e perché è la soluzione semplice:
  - è minuscolo: un selettore di elementi più un iframe;
  - tutta l'interfaccia di Heili e dei commenti vive in un **iframe servito da approve.heili.cloud**, sopra il sito.
    Il codice del sito e quello di Approve restano separati;
  - comunicano con `postMessage`, con controllo rigoroso dell'origine;
  - l'interfaccia dello script è in Shadow DOM, così non si mescola con il CSS del sito;
  - si attiva **solo** se l'indirizzo contiene il frammento di revisione (`#heili-review=<token>`), che non arriva ai
    log dei server. Per i visitatori normali non fa nulla e non carica altro;
  - il token viene scambiato con una sessione breve, legata a revisore, sito e versione, salvata in `sessionStorage`;
  - l'API di Approve accetta richieste solo dalle origini registrate per quel sito (CORS);
  - lo script non legge cookie, campi password o valori dei moduli. I campi vengono mascherati nelle catture.
- **Fotografia della zona commentata.** Valuta due strade:
  - cattura dal browser, che è inaffidabile;
  - cattura lato server della stessa pagina, con la stessa larghezza e lo stesso scorrimento, riusando la cattura
    delle Istantanee.
  Scegli e motiva. «Apri nel punto» per l'agenzia: link al sito con l'elemento evidenziato.
- **Istantanee.** Cattura nel media-worker con Chromium (`playwright-core`). Spiega l'impatto sull'immagine Docker.
  Sicurezza anti-SSRF:
  - solo http(s);
  - DNS risolto e IP privati, loopback, link-local e metadata cloud rifiutati, anche dopo ogni redirect;
  - timeout, altezza e dimensione massime;
  - nessun download e nessuna credenziale.
  Ricattura = nuova versione dopo l'invio.
- **Heili.** Ramo «sito web» nei prompt: chiede pagina, sezione, dispositivo e tipo di problema (testo, immagini,
  disposizione, qualcosa che non funziona). Riceve come contesto la pagina e l'elemento selezionato. Valgono gli
  stessi limiti (non approva, non invia). Il pulsante galleggiante della Parte A è lo stesso componente: dentro il
  sito vive nell'iframe.
- **Flusso agenzia.** Creare il «Sito web», scegliere la modalità, copiare la riga di codice con la chiave del sito,
  verificare l'installazione («Script trovato sul sito»), inviare in revisione, leggere le note, nuovo giro, segnare
  come pubblicato.
- **Flusso cliente.** Sul telefono e sul computer, come per gli altri contenuti, con le stesse decisioni e la stessa
  pagina di riepilogo.
- **Rischi e test.**
  - Unit: anti-SSRF, validazione delle origini, scambio del token.
  - E2E: un sito statico locale con lo script installato. Il cliente commenta un elemento, l'agenzia vede la nota e
    apre nel punto.
- **Fasi.**
  1. Modello dati, Istantanee e revisione lato cliente: riusa quasi tutto dell'esistente.
  2. Script «Sul sito» e iframe di Heili.
  3. Plugin WordPress e siti protetti da password.
  Indica anche quanto pesa ciascuna fase.

---

## Ordine

H-01 → H-02 → U-01 → H-03 → H-04 → U-03 → U-02 → U-06 → U-07 → U-05 → U-04 → U-08 → H-05 →
C-01.

**C-01 (il documento) va fatto comunque**: se alle 3:00 non l'hai ancora iniziato, fermati con la Parte A/B al punto
in cui sei (commit verde) e scrivi C-01.
Se H-01 o H-02 non riescono dopo 3 tentativi: annulla, annota il motivo e fai le U-xx (sono indipendenti), poi
H-05.

## Non stanotte
- Decidere quale tra «Approva» e «Chiedi modifiche» è il pulsante principale (QA-09) e l'«Annulla»
  dell'approvazione in Sfoglia (QA-29): aspettano Stefano.
- Implementare la guida a voce con navigazione (solo il documento H-05).
- Qualsiasi codice per i siti web (Parte C): stanotte solo il documento C-01. Nessuna migrazione Prisma.
- Qualsiasi modifica alle regole server di Heili (`checkAssistantAccess`, limiti voce).
