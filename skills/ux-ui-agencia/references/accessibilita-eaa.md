# Accessibilità — WCAG 2.2 AA ed European Accessibility Act

Si carica in modalità ACCESSIBILITÀ e quando un audit tocca un prodotto soggetto all'EAA.
Questa skill dà la valutazione tecnica e di design. **Non** dà pareri legali: se la domanda
è "siamo obbligati? rischiamo sanzioni?", la risposta tecnica va affiancata da
`consulente-legale` e i riferimenti normativi vanno verificati sul testo vigente.

## Indice
1. Chi è coinvolto (EAA in Italia)
2. Lo standard tecnico di riferimento
3. I criteri che contano di più (con test)
4. Protocollo di test manuale
5. Cosa consegnare

---

## 1. Chi è coinvolto

- **Norma**: Direttiva (UE) 2019/882 (European Accessibility Act), recepita in Italia con
  il D.Lgs. 82/2022. Si applica ai prodotti immessi sul mercato e ai servizi forniti dal
  **28 giugno 2025**. Vigilanza sui servizi: AgID (linee guida operative sui servizi
  digitali segnalate nel 2026 — ⚠️ verificare numero e data della versione vigente sul
  sito AgID prima di citarle).
- **Regime transitorio**: i servizi possono continuare a essere forniti con prodotti già
  legittimamente in uso prima del 28 giugno 2025 fino al **28 giugno 2030**; i contratti di
  servizio conclusi prima restano validi fino alla scadenza, al massimo 5 anni. Cambia la
  risposta a "da quando siamo obbligati?": va valutato caso per caso.
- **Servizi coinvolti** (quelli che interessano un'agenzia): e-commerce e in generale i
  servizi venduti online a consumatori, servizi bancari al consumatore, trasporto
  passeggeri (siti, app, biglietteria), comunicazioni elettroniche, accesso a servizi
  audiovisivi, e-book. Rientrano siti **e** app mobile del servizio.
- **Esenzione microimprese**: le microimprese che forniscono **servizi** (meno di 10
  persone **e** fatturato annuo o totale di bilancio non superiore a 2 milioni di euro)
  sono esentate dai requisiti per i servizi. Non vale per chi fabbrica prodotti.
- **Pubblica amministrazione e grandi imprese**: regime della Legge 4/2004 ("Stanca") e
  linee guida AgID, con dichiarazione di accessibilità annuale (per le PA e per i privati
  con fatturato medio oltre 500 milioni, scadenza di riferimento 23 settembre).
- **Sanzioni**: previste dal D.Lgs. 82/2022, ma le fonti secondarie riportano importi
  diversi. ⚠️ Non citare cifre al cliente senza il testo vigente: è materia di
  `consulente-legale`.
- **Chi risponde a "siamo obbligati?"**: questa skill dà un orientamento tecnico sul
  perimetro, sempre marcato "da verificare". La risposta definitiva la dà il consulente
  legale del cliente o `consulente-legale` (stessa politica dell'agente QA di
  `web-factory-insiderslab`).
- **Cosa chiede la norma in pratica**: il servizio deve essere percepibile, utilizzabile,
  comprensibile e robusto; il fornitore deve pubblicare le informazioni su come il servizio
  soddisfa i requisiti (nelle condizioni generali o in una pagina dedicata, spesso chiamata
  "dichiarazione di accessibilità").

Per un cliente fuori perimetro (es. sito vetrina di una microimpresa) l'accessibilità
resta un requisito di qualità di agenzia: la soglia AA si applica comunque ai nostri
progetti, solo che non è un obbligo legale del cliente.

## 2. Standard tecnico

Il riferimento tecnico è la norma **EN 301 549**, che per il web rimanda alle WCAG livello
AA. Attenzione alla differenza:
- la v3.2.1 (che rimanda alle WCAG 2.1) è citata in Gazzetta UE per la direttiva sul
  **settore pubblico** (2016/2102); per l'EAA oggi è il riferimento tecnico di fatto, **non**
  una presunzione di conformità;
- la presunzione di conformità all'EAA arriverà con la citazione di una norma armonizzata ai
  sensi della 2019/882: la v4.1.1, allineata alle WCAG 2.2, risulta pubblicata a settembre
  2026 con citazione attesa (fonte secondaria: deque.com). ⚠️ Verificare lo stato prima di
  scriverlo al cliente.

Nei nostri progetti si lavora comunque su **WCAG 2.2 AA**: include i criteri della 2.1
(tranne il 4.1.1 Parsing, rimosso) più criteri nuovi utili per mobile e form (target, focus non coperto, trascinamento con
alternativa, aiuto coerente, autenticazione accessibile, nessun inserimento ridondante).

## 3. I criteri che contano di più

Sono quelli che falliscono più spesso nei siti e nelle app che vediamo. Non sostituiscono la
lista completa WCAG, ma coprono la maggior parte dei problemi reali.

| Criterio | Cosa chiede | Test rapido |
|---|---|---|
| 1.1.1 Contenuti non testuali | Alternativa testuale per immagini informative; `alt=""` per le decorative | Ispeziona le immagini: l'alt descrive la funzione, non "immagine1.jpg" |
| 1.3.1 Info e relazioni | Struttura nel codice: titoli in ordine, liste, tabelle con intestazioni, etichette legate ai campi | Outline dei titoli; `label for` / `aria-labelledby` sui campi |
| 1.3.5 Scopo dell'input | `autocomplete` corretto sui dati personali | Nome, email, telefono, indirizzo hanno `autocomplete` |
| 1.4.1 Uso del colore | Il colore non è l'unico segnale (errori, link nel testo, grafici) | Guarda in scala di grigi |
| 1.4.3 Contrasto minimo | 4,5:1 testo normale, 3:1 testo grande | `scripts/contrast_check.py` |
| 1.4.4 Ridimensionamento testo | Leggibile e funzionante al 200% | Zoom browser 200% |
| 1.4.10 Reflow | Nessuno scroll orizzontale a 320 CSS px | Viewport 320 o zoom 400% |
| 1.4.11 Contrasto non testuale | 3:1 per bordi input, icone informative, indicatori di focus e stato | Script con `--uso ui` |
| 1.4.12 Spaziatura testo | Il layout regge se l'utente aumenta interlinea e spaziature | Bookmarklet text-spacing |
| 1.4.13 Contenuto su hover/focus | Tooltip e popover chiudibili con Esc, persistenti, raggiungibili col puntatore | Hover e Esc |
| 2.1.1 Tastiera | Tutto azionabile da tastiera | Percorso completo solo con Tab/Invio/Spazio/frecce/Esc |
| 2.1.2 Nessuna trappola | Si esce da modali, menu, iframe | Tab dentro e fuori da ogni componente |
| 2.4.1 Salto blocchi | Link "Vai al contenuto" o landmark | Primo Tab della pagina |
| 2.4.3 Ordine del focus | Ordine logico e coerente con la lettura | Percorso Tab |
| 2.4.4 Scopo del link (A) | Lo scopo del link si capisce dal testo o dal suo contesto (frase, paragrafo, cella) | "Scopri di più" ripetuto senza contesto = fallimento; testo autosufficiente è il 2.4.9 (AAA), obiettivo di agenzia |
| 2.4.7 Focus visibile | Indicatore visibile su ogni elemento | Mai `outline: none` senza sostituto |
| 2.4.11 Focus non coperto (AA) | L'elemento con focus non è **interamente** nascosto da header sticky, cookie banner, chat (nessuna parte coperta è il 2.4.12, AAA) | Tab con banner aperti |
| 2.5.7 Movimenti di trascinamento | Alternativa a click per ogni drag (slider, riordino, kanban) | Prova senza trascinare |
| 2.5.8 Dimensione target | ≥ 24×24 CSS px o spaziatura equivalente | Misura i bounding box |
| 3.1.1 Lingua della pagina | `lang` corretto (`it`, `es`...) | Attributo su `html` |
| 3.2.2 All'input | Cambiare un campo non provoca cambi di contesto inattesi | Select che naviga da solo = fallimento |
| 3.3.1 Identificazione errori | Errore descritto a testo, legato al campo | Invio form vuoto |
| 3.3.2 Etichette o istruzioni | Etichette visibili e istruzioni sui formati | Placeholder ≠ etichetta |
| 3.3.7 Inserimento ridondante | Non richiedere di nuovo dati già forniti nello stesso processo | Indirizzo di fatturazione = spedizione precompilabile |
| 3.3.8 Autenticazione accessibile | Nessun test cognitivo obbligatorio per il login (incolla password consentito, gestori password funzionanti) | Incolla nella password, autocomplete OTP |
| 4.1.2 Nome, ruolo, valore | Componenti custom con ruoli e stati ARIA corretti | Screen reader su menu, tab, accordion, switch |
| 4.1.3 Messaggi di stato | Conferme e errori annunciati senza spostare il focus | `aria-live` su toast e risultati di ricerca |

Movimento: rispettare `prefers-reduced-motion`; nessun contenuto che lampeggia più di 3
volte al secondo (2.3.1); animazioni automatiche oltre 5 secondi con pausa (2.2.2).

## 4. Protocollo di test manuale (30–60 minuti per flusso)

1. **Automatico come primo filtro**: axe DevTools o Lighthouse sulle pagine dei task. Gli
   errori trovati sono certi; l'assenza di errori non prova nulla.
2. **Solo tastiera**: percorrere ogni task critico senza mouse. Annotare dove il focus si
   perde, è invisibile, è coperto o segue un ordine illogico.
3. **Zoom e reflow**: 200% e viewport 320 px. Annotare tagli, sovrapposizioni, scroll
   orizzontale.
4. **Screen reader**: VoiceOver (macOS/iOS) o NVDA (Windows) sul task principale. Ascoltare
   titoli, etichette dei campi, annunci di errore, nome dei bottoni-icona.
5. **Colore e contrasto**: estrarre le coppie colore usate (testo, link, bottoni, bordi
   input, focus, placeholder, testo su immagini) e passarle allo script.
6. **Mobile**: target, gesti con alternativa, orientamento libero (1.3.4), zoom non bloccato
   (`user-scalable=no` è un rilievo).

## 5. Cosa consegnare

- Tabella dei rilievi con criterio WCAG, dove, evidenza, severità (scala in
  `audit-euristiche.md`) e correzione. La severità segue la regola WCAG unica di
  `audit-euristiche.md § 6` (4 se impedisce a un gruppo di utenti un task critico, 3 se lo
  rende più faticoso, altrove almeno 2).
- Esito per criterio della tabella §3: ✅ / ❌ / non verificato, nel template
  `assets/templates/report-accessibilita.md`, con il verdetto `CONFORME AA` /
  `NON CONFORME AA (n criteri ❌)` / `NON VALUTABILE`.
- Piano di rimedio ordinato: prima ciò che blocca un task, poi ciò che è sistemico
  (token di colore, componente focus), poi il resto.
- Se il cliente è nel perimetro EAA: bozza dei contenuti per la pagina informativa
  sull'accessibilità (stato di conformità, contenuti non accessibili, contatto per le
  segnalazioni), da far validare a `consulente-legale` prima della pubblicazione.
