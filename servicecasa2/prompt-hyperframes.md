# Prompt pronti — Friul Service Casa

Come si usano: apri **claude.ai** (web o desktop) in una chat con il connettore **HyperFrames by HeyGen** attivo, allega il **logo PNG** e incolla un prompt per volta. Parti dal Video 1: quando lo stile ti convince, chiedi di usarlo come template per il 2 e il 3.

---

## Stile comune (è già incluso in ogni prompt)

> Brand "Friul Service Casa", pronto intervento casa 24h a Udine e provincia. Video 16:9 1920x1080, circa 50 secondi, voiceover italiano maschile calmo e rassicurante, sottotitoli sempre visibili. Palette: rosso #E30613, nero #111111, bianco #FFFFFF. Font bold corsivo squadrato (Saira Condensed ExtraBold Italic per i titoli, Saira Semi Condensed per i testi). Elemento grafico ricorrente: le scie di velocità rosse del logo, da usare nelle transizioni e dietro al numero di telefono. Usa il logo allegato nell'intro (2s) e nella chiusura. Intro, grafica dei 3 step e chiusura identiche in tutta la serie. Pronuncia "Friul Service Casa" come "Friùl Sèrvis Casa". Il numero va letto "tre sette sette, zero otto zero, zero sette sette quattro" e mostrato come "377 080 0774", grande, in rosso su bianco, visibile per tutti gli ultimi 10 secondi, con un pulsante "CHIAMA ORA" che pulsa.

---

## Video 1 — Fabbro

```
[STILE COMUNE]
Tema: PRONTO INTERVENTO FABBRO.
Scena 1 (0-5s) VO: "Chiavi dimenticate dentro, serratura bloccata o, peggio, una porta forzata dai ladri?" — Testo grande: "CHIUSO FUORI? SERRATURA BLOCCATA?" + icona porta/chiave.
Scena 2 (5-14s) VO: "Prima cosa: niente panico e non provare a forzare la porta da solo. Rischi di rovinare serratura e infisso e di spendere il doppio." — Icona X rossa + "Non forzare la porta".
Scena 3 (14-28s) VO: "Friul Service Casa: fabbri a Udine e provincia, 24 ore su 24, anche di notte e nei festivi. Apriamo porte blindate e normali, sostituiamo cilindri e mettiamo in sicurezza dopo un furto." — 3 badge in sequenza: "24/7", "Apertura porte", "Cambio serratura e cilindro".
Scena 4 (28-40s) VO: "Come funziona? Ci chiami, ci descrivi il problema e ti diamo un preventivo chiaro. Arriviamo in tempi rapidi e interveniamo solo dopo il tuo ok." — 3 step numerati: 1 Chiami · 2 Preventivo chiaro · 3 Intervento.
Scena 5 (40-50s) VO: "Sei fuori casa proprio adesso? Chiama il tre sette sette, zero otto zero, zero sette sette quattro. Ti rispondiamo subito." — Chiusura con numero, CHIAMA ORA e logo.
```

## Video 2 — Elettricista

```
[STILE COMUNE] — usa lo stesso stile del video Fabbro.
Tema: PRONTO INTERVENTO ELETTRICISTA.
Scena 1 (0-5s) VO: "Salta la corrente e il salvavita non torna su? O senti odore di bruciato da una presa?" — Schermo che si spegne, poi il testo "BLACKOUT? SALVAVITA CHE SCATTA?" + icona fulmine.
Scena 2 (5-15s) VO: "Un consiglio: stacca tutti gli elettrodomestici e prova a riarmare il salvavita. Se scatta di nuovo, fermati: c'è un guasto. Se senti odore di bruciato, stacca il generale e chiamaci." — Icona di avviso + "Se riscatta: non insistere".
Scena 3 (15-29s) VO: "Friul Service Casa: elettricisti 24 ore su 24 a Udine e dintorni. Ricerca guasti, cortocircuiti, quadri elettrici, prese e impianti, sempre in sicurezza." — Badge: "24/7", "Ricerca guasti", "Quadri e impianti".
Scena 4 (29-41s) VO: "Ci chiami, ci spieghi cosa succede e ti diamo subito un'indicazione chiara sul costo. Arriviamo, troviamo il guasto e riportiamo la corrente." — Stessi 3 step del video Fabbro.
Scena 5 (41-50s) VO: "Sei al buio proprio adesso? Chiama il tre sette sette, zero otto zero, zero sette sette quattro. Ti rimettiamo in luce." — Chiusura identica.
```

## Video 3 — Idraulico

```
[STILE COMUNE] — usa lo stesso stile del video Fabbro.
Tema: PRONTO INTERVENTO IDRAULICO.
Scena 1 (0-5s) VO: "Un tubo che perde, il bagno allagato o lo scarico completamente intasato?" — Gocce che cadono, poi "PERDITA? SCARICO INTASATO?" + icona goccia.
Scena 2 (5-15s) VO: "La prima cosa da fare è chiudere il rubinetto generale dell'acqua: di solito è vicino al contatore o sotto il lavello. Così limiti i danni, anche al vicino di sotto." — Spunta + "Chiudi il rubinetto generale".
Scena 3 (15-29s) VO: "Friul Service Casa: idraulici di pronto intervento 24 ore su 24 a Udine e provincia. Perdite, tubi rotti, scarichi e WC intasati, rubinetteria e boiler." — Badge: "24/7", "Perdite e tubi", "Scarichi intasati", "Boiler e rubinetti".
Scena 4 (29-41s) VO: "Ci chiami, ci descrivi il problema, ti diamo un preventivo chiaro e arriviamo in tempi rapidi. Nessuna sorpresa a fine lavoro." — Stessi 3 step.
Scena 5 (41-50s) VO: "L'acqua sta ancora scendendo? Chiama adesso il tre sette sette, zero otto zero, zero sette sette quattro." — Chiusura identica.
```

---

## Prompt immagine — tecnico in divisa con logo (per il Photo Avatar HeyGen)

Serve a generare la foto di partenza dell'avatar se non c'è un tecnico reale da fotografare. Allega il logo come immagine di riferimento. Usa **la stessa persona** (stesso seed o stesso riferimento del volto) per le 3 varianti.

```
Fotografia realistica, mezzo busto, frontale, sguardo in camera, sorriso leggero e rassicurante.
Tecnico italiano di circa 40 anni, aspetto curato e affidabile, barba corta.
Indossa una polo da lavoro NERA con il logo "Friul Service Casa" (allegato) stampato a colori sul petto a sinistra, largo circa 8 cm, nitido e leggibile, senza distorsioni; sottile profilo rosso #E30613 sul colletto.
Luce morbida da studio, sfondo leggermente sfocato. Formato 16:9, spazio libero a destra per i testi.
Variante FABBRO: davanti al portone di un condominio, mazzo di chiavi in mano.
Variante ELETTRICISTA: davanti a un quadro elettrico domestico aperto, cacciavite isolato nel taschino.
Variante IDRAULICO: in un bagno moderno, chiave inglese in mano.
```

⚠️ Il testo del logo va sempre controllato: le AI spesso sbagliano le lettere. Se il logo esce deformato, genera la divisa **senza logo** e applica il PNG vero in post. Oppure usa la strada del Digital Twin reale.
