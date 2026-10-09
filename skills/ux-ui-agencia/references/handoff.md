# Handoff — dal design allo sviluppo senza domande di ritorno

Criterio di successo: **chi costruisce non deve tornare a chiedere nulla, e chi produce gli
asset non deve indovinare misure.** Se una spec dice "sezione servizi elegante", ha fallito.

## 1. Definizione di "spec pronta"

Una spec di schermata (template `assets/templates/spec-schermata.md`) è pronta solo se ha:

- obiettivo della schermata e **una** azione primaria con destinazione;
- layout con griglia, larghezza massima e ordine del focus;
- contenuti con lunghezze massime (o il testo definitivo);
- comportamento a 3 viewport (mobile, tablet, desktop);
- tutti gli stati degli elementi interattivi (o "N/A" motivato);
- casi limite: testo lungo, vuoto, errore di rete, permessi;
- solo token (nessun hex o px fuori scala);
- criteri di accettazione verificabili ("Dato… quando… allora…");
- note asset con formato, misure in px, proporzione, punto focale, peso massimo.

## 2. Per stack

### WordPress + Elementor (stack standard di agenzia)
La spec si traduce nel formato dell'agente 2 di `web-factory-insiderslab`: Container
(flex row / column / grid N col), gap, padding desktop/mobile, larghezza boxed/full, widget
Elementor, Loop Grid se il contenuto si ripete, Global Colors e Global Fonts con i nomi
semantici del design system. Massimo 3 livelli di container annidati. Il build, i gate di
fase e il go-live restano di `web-factory-insiderslab`.

### React / Next.js / Vue con Tailwind o CSS
- Token esportati come CSS custom properties (`--color-bg-surface`, `--space-4`) e mappati
  nel tema Tailwind; nessun valore arbitrario (`text-[13px]`) nei componenti.
- Ogni componente con props per varianti e stati (`variant`, `size`, `disabled`, `loading`).
- Componenti accessibili di base: preferire librerie headless collaudate (Radix, React Aria,
  Headless UI) a menu, modali e tab scritti da zero.
- Focus: `:focus-visible` con anello ≥ 2px e contrasto ≥ 3:1; `scroll-padding-top` pari
  all'altezza dell'header sticky, così il focus non finisce sotto.
- Movimento: durata e easing da token; `@media (prefers-reduced-motion: reduce)` gestito;
  mai `transition: all`, solo `transform` e `opacity`.
- Semantica: `<button>` per le azioni, `<a href>` per la navigazione, mai `div` cliccabili;
  bottoni-icona con `aria-label`; toast e validazione con `aria-live="polite"`.
- Form: `type`, `inputmode`, `autocomplete` corretti; incolla mai bloccato; input mobile a
  16px (sotto, iOS zooma); invio mai disabilitato in anticipo; all'errore focus sul primo
  campo errato; avviso di modifiche non salvate.
- Stato nell'URL: filtri, tab, paginazione, ricerca. Ogni vista importante ha un link diretto.
- Caricamento: indicatore dopo 150–300 ms, visibile almeno 300–500 ms (niente sfarfallio);
  aggiornamento ottimistico con ripristino o "Annulla" per le azioni reversibili.
- Layout: `min-height: 100dvh` invece di `100vh`; `env(safe-area-inset-*)` su mobile;
  immagini con `width`/`height` o `aspect-ratio`; immagine LCP con `fetchpriority="high"` e
  senza lazy load; liste oltre ~50 elementi virtualizzate.
- Testo e numeri: `…` (carattere unico) negli stati "Salvataggio…"; spazio non separabile
  tra numero e unità ("10&nbsp;MB"); date, numeri e valute con `Intl.*('it-IT')`;
  `font-variant-numeric: tabular-nums` nei dati; `text-wrap: balance` sui titoli.
- Mai `user-scalable=no` o `maximum-scale=1` nel viewport: bloccano lo zoom (WCAG 1.4.4).

### App mobile (iOS / Android / Flutter / React Native)
- Target 44×44 pt (iOS) / 48×48 dp (Android) per tutti i controlli.
- Safe area, notch e barra dei gesti rispettati; tastiera che non copre il campo attivo.
- Navigazione principale in basso, 3–5 voci; gesti sempre con alternativa visibile.
- Testo dinamico (Dynamic Type / font scale) supportato fino ad almeno 200% senza tagli.
- Componenti nativi quando esistono (date picker, share sheet, selettori).

### Figma (quando il file lo consegniamo noi)
- Pagine: Copertina · Flussi · Wireframe · UI · Componenti · Archivio.
- Auto layout ovunque, varianti per stati, stili/variabili collegati ai token.
- Nomi dei frame = nomi delle schermate nella spec; nessun "Frame 384".
- Annotazioni accanto al frame per comportamento, stati e casi limite.

## 3. Criteri di accettazione — formato

```
Dato che sono un utente non autenticato sulla pagina prodotto
Quando premo "Aggiungi al carrello"
Allora il contatore del carrello si aggiorna entro 300 ms,
  compare una conferma annunciata agli screen reader,
  e il focus resta sul bottone.
```

## 4. Definizione di fatto (UI)

- [ ] Corrisponde alla spec a 3 viewport (screenshot di confronto)
- [ ] Tutti gli stati presenti e raggiungibili
- [ ] Percorso tastiera completo, focus visibile
- [ ] Contrasti verificati con lo script sui colori implementati
- [ ] Nessun valore fuori token nel codice o nel builder
- [ ] Testi definitivi, nessun lorem ipsum
- [ ] Core Web Vitals entro soglia sulla pagina interessata
