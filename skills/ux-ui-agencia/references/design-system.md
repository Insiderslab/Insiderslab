# Design system — token, scale, stati, componenti

Si carica in modalità DESIGN SYSTEM e nella fase UI della modalità PROGETTA.
Un design system per un cliente di agenzia non è una libreria da 200 componenti: è il
minimo insieme di decisioni che rende ogni schermata coerente e ogni modifica economica.

## Indice
1. Token a tre livelli
2. Colore
3. Tipografia
4. Spaziatura e layout
5. Forma, elevazione, movimento
6. Stati
7. Dark mode
8. Componenti: inventario e scheda
9. Consegna

---

## 1. Token a tre livelli

```
PRIMITIVI      →  SEMANTICI                 →  COMPONENTE (solo se serve)
blue-600          color.action.primary          button.primary.bg
gray-900          color.text.default            input.border.focus
space-4 (16px)    space.inset.md                card.padding
```

- I componenti usano **solo** token semantici. I primitivi non compaiono mai in una spec.
- Nomi per funzione, mai per aspetto: `color.text.muted`, non `grigio-chiaro`. Il rebranding
  cambia i valori, non i nomi.
- Su un page builder (es. Elementor) i semantici diventano Global Colors/Fonts con i nomi
  definiti in `cliente.md § Convenzioni stack`.

## 2. Colore

**Ruoli semantici minimi**

| Token | Uso | Verifica |
|---|---|---|
| `color.bg.default` / `color.bg.subtle` | sfondo base e alternato | — |
| `color.surface` / `color.surface.raised` | card, pannelli, menu | — |
| `color.text.default` | testo di lettura | ≥ 4,5:1 su tutti gli sfondi in cui compare |
| `color.text.muted` | testo secondario | ≥ 4,5:1 (l'errore più comune) |
| `color.action.primary` (+ `.hover`, `.pressed`) | CTA e link | testo sul colore ≥ 4,5:1; colore sullo sfondo ≥ 3:1 |
| `color.border` / `color.border.input` | separatori / bordi dei campi | input ≥ 3:1 (WCAG 1.4.11) |
| `color.focus` | anello di focus | ≥ 3:1 su tutti gli sfondi adiacenti |
| `color.feedback.success/warning/danger/info` | stati e messaggi | testo e icona, mai solo colore |

**Regole**
- Palette base di 4–6 colori con nome; scala tonale (50–900) solo per i colori che
  servono davvero in più tonalità.
- Il colore d'azione si riserva alle azioni: se è anche decorazione, la CTA si perde.
  Un solo colore d'accento, lo stesso su tutto il prodotto.
- Grigi e ombre leggermente tinti verso la tinta del brand: il grigio neutro puro rende
  tutto anonimo. Su superfici colorate il testo secondario si tinge della superficie,
  non si fa grigio.
- Hover, focus e premuto **aumentano** il contrasto, non lo riducono.
- Ogni coppia testo/sfondo dichiarata nel design system passa da
  `scripts/contrast_check.py --palette`. L'output va nel documento.

**Elenco minimo di coppie per il gate G3** (tutte obbligatorie, più quelle specifiche
del prodotto):

| Primo piano | Sfondi su cui verificarlo | Uso nello script |
|---|---|---|
| `color.text.default` | `bg.default`, `bg.subtle`, `surface` | testo |
| `color.text.muted` | `bg.default`, `bg.subtle`, `surface` | testo |
| testo dei bottoni | `color.action.primary` e i suoi stati hover/pressed | testo |
| `color.action.primary` (link e bordo bottone secondario) | `bg.default`, `surface` | testo se è un link, ui se è un bordo |
| `color.border.input` | `bg.default`, `surface` | ui |
| `color.focus` | `bg.default`, `surface`, `color.action.primary` | ui |
| testo e icone di `feedback.*` | i rispettivi sfondi di avviso e `bg.default` | testo / ui |
| placeholder (se usato) | sfondo del campo | testo |

`decorativo` è ammesso solo per elementi senza testo e senza funzione (sfondi, ornamenti).
- Testo su immagini: overlay o area di sfondo che garantisca il contrasto sul punto più
  chiaro dell'immagine, non sulla media.
- Grafici e stati non distinti solo dalla tinta (daltonismo: ~8% degli uomini).

## 3. Tipografia

- Una o due famiglie, chiaramente diverse se due. Self-hosted, `font-display: swap`,
  solo i pesi usati (di solito 2–3).
- **Scala**: rapporto costante (1,2 per interfacce dense, 1,25 per siti, 1,333 per siti
  editoriali o con titoli grandi). Base 16px.
- Esempio 1,25 su base 16: 12,8 · 16 · 20 · 25 · 31,25 · 39 · 48,8 (arrotondare).
- Titoli fluidi con `clamp()` tra mobile e desktop invece di 3 valori fissi.

| Livello | Token | Mobile | Desktop | Interlinea | Note |
|---|---|---|---|---|---|
| Display / H1 | `type.display` | ___ | ___ | 1,1–1,2 | |
| H2 | `type.h2` | ___ | ___ | 1,2–1,3 | |
| H3 | `type.h3` | ___ | ___ | 1,3 | |
| Corpo | `type.body` | ≥ 16px | 16–18px | 1,5–1,7 | serif: un po' più di interlinea |
| Piccolo | `type.small` | ≥ 14px | 14px | 1,4–1,5 | mai per testo essenziale |
| Etichetta UI | `type.label` | 14px | 14px | 1,2 | |

- Lunghezza riga 45–80 caratteri (`max-width: 65ch` sul testo).
- Testo giustificato: no sul web (fiumi di spazio, peggio per la dislessia).
- Tutto maiuscolo solo per etichette brevissime e con spaziatura aumentata; mai per frasi.
- Dati e tabelle: cifre tabulari.

## 4. Spaziatura e layout

- Scala su base 4/8: 4 · 8 · 12 · 16 · 24 · 32 · 48 · 64 · 96 (128 per hero).
- **Densità** decisa per superficie (vedi `direzione-visiva.md § 1`):

| Densità | Intervallo di spaziature usate | Per |
|---|---|---|
| Ariosa | 24–96px | siti, landing, Persuasione ed Esperienza |
| Standard | 16–64px | aree clienti, app consumer |
| Compatta | 8–32px | dashboard, gestionali, tabelle (Operatività) |
- **Prossimità**: lo spazio dentro un gruppo è sempre minore di quello tra gruppi.
  È la regola che più spesso distingue un layout ordinato da uno "quasi giusto".
- Padding verticale di sezione deciso una volta (es. 96/48) e rispettato.
- Griglia: 4 colonne mobile, 8 tablet, 12 desktop; gutter 16/24/24–32; contenuto massimo
  1200–1320px, testo lungo 65ch.
- Breakpoint di riferimento: < 768 · 768–1279 · ≥ 1280 (adattare al builder usato).
- Allineamento: sinistra di default per testo e moduli; centrato solo per blocchi brevi.

## 5. Forma, elevazione, movimento

- **Raggi**: 2–3 valori con significato (es. 4 controlli, 8 card, pieno per pill/avatar).
  Non lo stesso raggio su tutto: la forma comunica la gerarchia. Un elemento annidato ha
  raggio minore o uguale al contenitore (raggio interno = esterno − padding).
- **Elevazione**: 2–3 livelli (piatto, sollevato, sovrapposto). Le ombre indicano
  sovrapposizione reale (menu, modali), non decorazione. Mai card dentro card.
- **Livelli di sovrapposizione** (z-index) dichiarati come token: contenuto, sticky,
  dropdown, overlay, modale, toast. Niente `z-index: 9999` sparsi.
- **Movimento** (token `motion.duration.*`, `motion.easing.*`):

| Tipo | Durata | Easing |
|---|---|---|
| Micro (hover, toggle, focus) | 100–150 ms | ease-out |
| Componenti (accordion, dropdown, toast) | 200–300 ms | ease-out entrata / ease-in uscita |
| Transizioni di pagina o pannelli grandi | 300–400 ms | ease-in-out |

- Il movimento spiega un cambiamento (da dove arriva, dove va). Un solo momento orchestrato
  per pagina vale più di animazioni su ogni sezione.
- Uscite più rapide delle entrate (circa 60–70% della durata); in sequenza, sfalsamento di
  30–50 ms tra elementi. Niente rimbalzi o elastici di default.
- Il movimento si può interrompere e non blocca mai l'input. Si animano solo `transform`
  e `opacity`.
- `prefers-reduced-motion: reduce` → niente spostamenti, solo dissolvenze brevi o nulla.

## 6. Stati

Ogni componente interattivo dichiara tutti gli stati. "Lo farà il builder" non è una spec.

| Stato | Regola |
|---|---|
| Default | — |
| Hover | solo rinforzo, mai unica fonte di informazione (non esiste su touch) |
| Focus visibile | anello ≥ 2px, contrasto ≥ 3:1, non coperto da elementi sticky |
| Attivo / premuto | feedback immediato |
| Disabilitato | si capisce perché; preferire abilitato + messaggio quando possibile |
| Caricamento | il bottone mantiene larghezza e mostra stato; niente doppio invio |
| Errore | testo + icona + colore, accanto all'elemento |
| Successo | conferma esplicita, annunciata agli screen reader |
| Vuoto | spiega e invita ad agire |
| Selezionato / corrente | distinguibile senza colore (peso, indicatore, icona) |

## 7. Dark mode

- Non è l'inversione dei colori: si ridefiniscono i token semantici per il tema scuro.
- Sfondo grigio molto scuro, non nero puro; l'elevazione si esprime con superfici più
  chiare, non con ombre.
- Colori saturi desaturati e schiariti: lo stesso blu del tema chiaro vibra sul nero.
- Ricontrollare **tutte** le coppie con lo script: i contrasti cambiano.
- Rispettare `prefers-color-scheme` e offrire la scelta manuale se il prodotto si usa a lungo.
- Il tema predefinito si sceglie da **dove e quando** si usa il prodotto, non dalla
  categoria ("i SaaS sono scuri" non è un motivo).
- Nel codice: `color-scheme: dark`, `meta theme-color` coerente, colori espliciti anche per
  i controlli nativi (select, scrollbar, selezione del testo).

## 8. Componenti: inventario e scheda

Prima si fa l'**inventario** di ciò che esiste (screenshot di tutti i bottoni, tutti i
campi, tutte le card del prodotto): mostra quante varianti inutili ci sono e giustifica il
lavoro al cliente.

Set minimo per un sito: bottone, link, campo di testo, select, checkbox/radio, card,
navigazione (desktop + mobile), footer, avviso, modale, accordion.
Per una piattaforma, in più: tabella, filtri/chip, tab, toast, menu a tendina, paginazione,
stato vuoto, skeleton, badge, avatar, date picker, upload.

Scheda componente:
```
Nome: ___            Scopo: ___ (quando usarlo / quando NO)
Anatomia: ___        Varianti: ___ (primario, secondario, distruttivo, ghost...)
Dimensioni: ___      Stati: (tabella §6)
Contenuto: lunghezze, icone sì/no, testo troncato come
Accessibilità: ruolo, tastiera, annunci, target
Esempi: ✅ ___ / ❌ ___
```

## 9. Consegna

- Documento del design system (token con valori, tabella contrasti generata dallo script,
  scala tipografica, spaziature, raggi, ombre, movimento, schede componente).
- Per Elementor: Global Colors/Fonts con i nomi di `cliente.md § Convenzioni stack` +
  spec in formato `spec-sezione.md` di `web-factory-insiderslab`.
- Per codice: file di token (CSS custom properties o JSON in formato Design Tokens) +
  mappatura nel tema (Tailwind o equivalente).
- Per Figma: variabili e stili collegati agli stessi nomi.
