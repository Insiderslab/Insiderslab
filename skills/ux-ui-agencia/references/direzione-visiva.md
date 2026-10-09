# Direzione visiva — scelte, non default

Si carica nella fase "Direzione visiva" di PROGETTA, quando si fa un restyling, e per il
gate G6. Il cliente paga un punto di vista: una proposta che potrebbe stare sul sito di
chiunque è una proposta sbagliata, anche se è "pulita".

## Indice
1. Lettura del progetto e tipo di superficie
2. Da dove nascono le scelte
3. Come si presentano le direzioni
4. Restyling: conservare o sostituire
5. Default da evitare (calibrazione)
6. Controllo (gate G6)

---

## 1. Lettura del progetto e tipo di superficie

Prima di qualsiasi colore, una riga:

> "Lo leggo come: **[tipo di pagina/prodotto]** per **[pubblico]**, tono **[2–3 aggettivi]**,
> superficie **[Persuasione / Operatività / Lettura / Esperienza]**, vincoli **[brand, stack]**."

Se la riga contiene un'ipotesi, si chiede conferma con **una** domanda.

| Superficie | Esempi | Priorità del design |
|---|---|---|
| **Persuasione** | home, landing, pricing, scheda servizio | chiarezza dell'offerta, prova, una conversione per pagina |
| **Operatività** | dashboard, gestionale, area clienti, app di lavoro | velocità di scansione, densità, stati, coerenza; l'espressività passa in secondo piano |
| **Lettura** | blog, documentazione, guide | tipografia, lunghezza riga, navigazione nel testo |
| **Esperienza** | portfolio, lancio di prodotto, evento | identità, momento memorabile, movimento intenzionale |

Il tipo si sceglie per **superficie**, non per prodotto: la landing di un gestionale è
Persuasione, il gestionale è Operatività. Checkout, form di preventivo e onboarding sono
misti: Persuasione per gerarchia e fiducia, Operatività per i campi.

## 2. Da dove nascono le scelte

Dal mondo del cliente, non dalla categoria. Materiali, luoghi, gesti del mestiere,
vocabolario, oggetti, documenti storici dell'azienda, il territorio. Un agriturismo in
Langa e una SPA urbana non si distinguono con "verde salvia vs rosa cipria", ma con ciò che
è vero di loro.

- **Colore**: 4–6 colori con nome e ruolo, presi da qualcosa di reale (materiale,
  luogo, prodotto). Un solo colore d'accento, bloccato su tutto il sito.
- **Tipografia**: una o due famiglie scelte per il carattere del progetto, non quelle che
  useremmo per chiunque. La tipografia porta la personalità della pagina.
- **Layout**: un'idea di impaginazione descritta in una frase e in un wireframe ASCII;
  allineamento deciso (sinistra, centrato, asimmetrico) e perché.
- **Un solo elemento memorabile.** Tutto il resto disciplinato e quieto. Prima di
  consegnare si toglie un accessorio.

Se il brief fissa una direzione (anche una che qui sotto è un "default"), **vince il brief**.

## 3. Come si presentano le direzioni

Due o tre direzioni **davvero diverse** (non tre sfumature della stessa), ognuna con:

```
Nome della direzione: ___
In una frase: ___
Da dove nasce (cosa del mondo del cliente): ___
Colori: ___ (nome · hex · ruolo)
Tipografia: ___ (famiglia · ruolo)
Layout: ___ (frase + wireframe ASCII della hero)
Elemento memorabile: ___
Rischio: ___ (cosa potrebbe non piacere o non funzionare)
```

Si mostrano le opzioni, **si aspetta la scelta esplicita** del cliente o del decisore indicato in `cliente.md`, poi si
applica. Mai applicare la direzione preferita "intanto".

Registro di agenzia: ogni direzione approvata si annota in `references/cliente.md §
Registro direzioni` (cliente, font, palette, data). Serve a non riproporre la stessa
combinazione a clienti diversi: sostituire un default con un altro default non è una scelta.

## 4. Restyling: conservare o sostituire

Prima si decide, esplicitamente, quale dei due:

- **Rinnovare** (si conserva l'identità e si migliora): leve in quest'ordine, fermandosi
  quando basta → tipografia → spaziature → colore → movimento → hero → sostituzione di
  blocchi interi.
- **Ridisegnare** (si sostituisce): si parte dalla direzione (§3), non dal sito vecchio.
  Non si lucida un aspetto che si è già deciso di buttare.

In entrambi i casi, **inventario da non rompere** (gate G9 della skill) prima di toccare
qualcosa: URL e slug, voci di menu, nomi e ordine dei campi dei form, logo, testi legali e
cookie, ID di analytics e pixel, contenuti che portano traffico. Ogni cambio di questi
elementi è una decisione dichiarata e approvata, mai un effetto collaterale. Se cambiano
gli URL, il piano redirect è di `web-factory-insiderslab` (agente 7).

## 5. Default da evitare (calibrazione)

Il design generato in automatico, e quello fatto di fretta, converge sugli stessi tratti.
Sono legittimi se il brief li chiede; altrimenti sono default, non scelte.

**Colore e superfici**
- Gradiente viola-blu su bianco; testo in gradiente.
- Sfondo crema con serif a contrasto e accento terracotta.
- Nero quasi puro con un solo accento acido (verde lime, arancione).
- Vetro smerigliato decorativo; mesh gradient dietro la hero.
- Grigio puro per testi secondari su superfici colorate (va tinto verso la tinta della superficie).

**Tipografia**
- La stessa sans neutra (Inter, Roboto, Arial, font di sistema) per qualsiasi progetto.
- Una sola parola del titolo evidenziata in corsivo, grassetto o colore.
- Etichetta in maiuscoletto spaziato sopra ogni titolo ("eyebrow" a ogni sezione).
- Font monospace per piccoli dati, solo per sembrare tecnici.

**Impaginazione**
- Kit da SaaS: tutto in card arrotondate identiche, stesso raggio ovunque, stessa ombra
  grigia leggera, card dentro card.
- Tre card di "vantaggi" uguali con icona, titolo e due righe.
- Hero con numero grande, etichetta piccola e gradiente.
- Numerazione 01 / 02 / 03 su contenuti che non sono una sequenza.
- Sezioni a zig-zag immagine/testo ripetute più di due volte di fila.
- Bordo colorato spesso su un lato delle card.

**Dettagli e movimento**
- Freccia "→" aggiunta a ogni link e bottone.
- Stringhe di metadati con il punto mediano ("A · B · C") ovunque.
- Emoji usate come icone.
- Dissolvenza dal basso su ogni sezione, hover animato su ogni card.

**Contenuti**
- Numeri troppo perfetti (99,99%, +300%), nomi segnaposto (Acme, Mario Rossi ovunque),
  verbi vuoti ("eleva", "rivoluziona", "senza soluzione di continuità", "sblocca").
- Lorem ipsum nei mockup presentati al cliente: il testo cambia il design.

## 6. Controllo (gate G6)

Si esegue in una passata separata da chi ha disegnato (chi produce non giudica).

| # | Domanda | Fallisce se |
|---|---|---|
| 1 | Questa impaginazione potrebbe stare, identica, sul sito di un prodotto non correlato? | sì |
| 2 | Rifacendo il lavoro per un brief simile di un altro cliente, arriveremmo qui? | sì, per palette, font o hero |
| 3 | Quanti tratti della §5 compaiono senza che il brief li chieda? | più di 2 |
| 4 | Si sa dire da dove nasce ogni scelta (§2)? | una scelta non ha origine |
| 5 | C'è un solo elemento memorabile, o tutto chiede attenzione? | più elementi in competizione |
| 6 | Il registro di agenzia mostra la stessa coppia font/palette su un altro cliente? | sì |

Esito: `APPROVATO` oppure `DA RIVEDERE` + quali punti + cosa si è cambiato e perché.
Qualità minima che vale sempre, a prescindere dalla direzione: responsive fino a 320px,
focus visibile, `prefers-reduced-motion` rispettato, contrasti verificati.
