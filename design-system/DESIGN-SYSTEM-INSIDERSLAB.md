# Design System InsidersLab — fonte unica del linguaggio visivo

> **Stato:** v1.0 · 22 settembre 2026
> **Fonte primaria:** Brand Book InsidersLab (Canva, `DAHRh4VZtME`, aggiornato 06/08/2026),
> letto e trascritto integralmente. I valori di colore e tipografia **non sono
> proposte**: sono quelli del brand book.
> **Aggiunte tecniche di questo documento:** rapporti di contrasto misurati,
> varianti accessibili, scala tipografica su 3 breakpoint, scala di spaziatura,
> stati dei componenti, token CSS. Ogni aggiunta è marcata `[TECNICO]`.
> **Se brand book e questo documento divergono sul colore o sul font, vale il brand book**
> e questo documento va aggiornato.

---

## 0. Come si usa questo documento

| Se devi… | Leggi |
|---|---|
| Impostare il Site Kit di Elementor su un progetto InsidersLab | §2, §4, §5, §11 |
| Progettare un post o una storia | §2.3, §4, §7, §8, §9 |
| Usare il logo su qualsiasi supporto | §7 |
| Costruire una pagina web o una landing | §2.2, §4, §5, §6, §11 |
| Fare un deck o un documento cliente | §2.3, §4, §8, §10 |
| Sapere cosa non puoi fare | §3.3, §7.3, §9.3 |

I token copiabili sono in `design-tokens.css` e `design-tokens.json`, nella stessa cartella.
La sintesi operativa in spagnolo per il team è in `RESUMEN-ES.md`.

---

## 1. Identità verbale — il perimetro dentro cui vive il visivo

- **Nome:** InsidersLab · descrittore ufficiale **Creative Agency** (Udine, Italia)
- **Claim:** *Rinforziamo il tuo Business*
- **Posizionamento:** non un'agenzia di web marketing, un **laboratorio di crescita strategica**;
  mentalità da *insider* — ci integriamo nel team del cliente
- **Tre pilastri:** empatia · trasparenza · creatività
- **Metodo:** analisi → strategia → esecuzione → ottimizzazione
- **Sette aree di servizio (ordine del brand book):** Marca · SEO · Siti web · Pubblicità ·
  Social · Multimedia · Marketplace
- **Partner dichiarati:** Google · Meta Business
- **Attivo dal:** 2021 (*Marketing web · desde 2021*)

**Footer ufficiale, da usare così:**
Via del Cotonificio 39, 33100 Udine · Italia — +39 3477 1852 35 — info@insiderslab.it — insiderslab.it

> Il descrittore **non si cambia**: né "Digital Agency", né "Web Marketing" (§7.3).

---

## 2. Colore

### 2.1 Palette primaria (dal brand book)

| Nome brand | HEX | RGB | CMYK | Pantone |
|---|---|---|---|---|
| **Azul InsidersLab** | `#2F3AE4` | 47 58 228 | 79 75 0 11 | Blue 072 C |
| **Azul editorial** | `#2042BE` | 32 66 190 | 89 74 0 15 | 2728 C |
| **Lima** | `#AAD800` | 170 216 0 | 33 0 100 0 | 375 C |
| **Negro** | `#000000` | — | — | semitono · «Lab» · testo su lima |

### 2.2 Palette secondaria (dal brand book)

| Nome brand | HEX | Uso |
|---|---|---|
| Azul profundo | `#344C8C` | fondi sobri, documenti, tabelle |
| Azul cielo | `#298CE8` | dati, evidenze, grafici |
| Verde hoja | `#80AE52` | supporto, natura, categorie |
| Lila | `#8880E0` | categoria, secondo accento |

### 2.3 Proporzioni d'uso (dal brand book)

**Azul 55 · carta 20 · negro 12 · lima 9** — il resto (≈4) al lila.
La lima è **accento**, mai fondo maggioritario. Il blu domina, la lima punteggia.

### 2.4 Token semantici `[TECNICO]`

I nomi sono semantici e non di colore: un rebranding cambia il valore, non il token.

| Token | Valore | Uso | Contrasto misurato |
|---|---|---|---|
| `--il-primario` | `#2F3AE4` | CTA, link, accenti di marca | 7,38:1 su bianco ✅ |
| `--il-primario-scuro` | `#2042BE` | hover, stati attivi | 8,13:1 su bianco ✅ |
| `--il-primario-premuto` | `#1B2FA8` | active/pressed | 10,40:1 su bianco ✅ |
| `--il-accento` | `#AAD800` | evidenze, riempimenti, non testo su chiaro | 1,68:1 su bianco ❌ |
| `--il-accento-testo` | `#647F00` | quando la lima **deve** essere testo su chiaro | 4,59:1 su bianco ✅ |
| `--il-testo` | `#111827` | testo di lettura | 17,74:1 su bianco ✅ |
| `--il-testo-secondario` | `#5B6070` | testo secondario, didascalie | 6,27:1 su bianco ✅ |
| `--il-sfondo` | `#FFFFFF` | fondo base | — |
| `--il-sfondo-carta` | `#F7F7F5` | sezioni alterne, «papel» | — |
| `--il-sfondo-scuro` | `#2F3AE4` | sezioni in negativo | testo bianco 7,38:1 ✅ |
| `--il-bordo` | `#8E94A3` | bordi input, separatori significativi | 3,04:1 su bianco ✅ |
| `--il-bordo-tenue` | `#E3E5EA` | divisori decorativi (non portanti) | decorativo |

**Stati** `[TECNICO]` — non sono nel brand book, servono a web e dashboard:

| Token | Valore | Su bianco | Fondo tenue |
|---|---|---|---|
| `--il-successo` | `#176B41` | 6,53:1 ✅ | `#E8F3EC` (5,74:1) |
| `--il-attenzione` | `#8A5800` | 6,04:1 ✅ | `#FFF4E0` (5,54:1) |
| `--il-errore` | `#A11B14` | 7,83:1 ✅ | `#FDECEA` (6,85:1) |

Fondi tenue di marca: `#EEF0FE` (blu, testo `#2042BE` = 7,17:1) · `#F4FAD9` (lima, testo nero = 19,52:1).

### 2.5 Regole di contrasto — misurate, non stimate

| Combinazione | Rapporto | Verdetto |
|---|---|---|
| Bianco su Azul `#2F3AE4` | 7,38:1 | ✅ qualsiasi testo |
| Bianco su Azul editorial `#2042BE` | 8,13:1 | ✅ qualsiasi testo |
| Bianco su Azul profundo `#344C8C` | 8,21:1 | ✅ qualsiasi testo |
| Nero su Lima `#AAD800` | 12,53:1 | ✅ qualsiasi testo |
| Lima su Nero | 12,53:1 | ✅ qualsiasi testo |
| Lima su Azul editorial `#2042BE` | 4,85:1 | ✅ qualsiasi testo |
| Lima su Azul profundo `#344C8C` | 4,90:1 | ✅ qualsiasi testo |
| Lima su Azul `#2F3AE4` | 4,40:1 | ⚠️ **solo ≥24px o ≥19px bold** |
| Bianco su Azul cielo `#298CE8` | 3,49:1 | ⚠️ solo titoli grandi — per testo usa nero (6,01:1) |
| Bianco su Lila `#8880E0` | 3,38:1 | ⚠️ solo titoli grandi |
| Bianco su Verde hoja `#80AE52` | 2,59:1 | ❌ mai |
| Lima su bianco | 1,68:1 | ❌ mai come testo |

### 2.6 Coppie vietate — non discutibili

1. **Testo lima su bianco o su carta.** Illeggibile (1,68:1). Se serve lima testuale su
   chiaro, usa `#647F00`.
2. **Testo bianco su lima.** 3,04:1. Su lima il testo è **nero**, sempre.
3. **Testo bianco su verde hoja.** 2,59:1.
4. **Lima su azul `#2F3AE4` in corpo testo.** Passa solo in display: per testo piccolo su blu
   passa al blu editorial `#2042BE` come fondo (4,85:1) o metti il testo bianco.
5. **Verde hoja e lima adiacenti in area piena.** Si sporcano a vicenda: separali con carta o nero.

---

## 3. Tipografia

### 3.1 Le due famiglie (dal brand book)

| Ruolo | Famiglia | Pesi ammessi | Regola |
|---|---|---|---|
| **Titolari** | **Arvo** | Regular 400 · Bold 700 | **mai in paragrafi lunghi** |
| **Testo** | **Open Sans** | 300 · 400 · 600 · 700 · 800 | tutto il corpo, UI, dati |

Due famiglie, nessuna terza. Sul web vanno **self-hosted** (WOFF2, `font-display: swap`),
non caricate da CDN di terze parti: è un requisito privacy oltre che di performance.

### 3.2 Scala tipografica `[TECNICO]`

Arvo non scende sotto i 22px: è una slab con grazie spesse, sotto quella misura si impasta.

| Livello | Famiglia | Peso | Desktop | Tablet | Mobile | Line-height | Letter-spacing |
|---|---|---|---|---|---|---|---|
| H1 | Arvo | 700 | 56px | 44px | 34px | 1,10 | −0,01em |
| H2 | Arvo | 700 | 40px | 34px | 28px | 1,15 | −0,01em |
| H3 | Arvo | 400 | 28px | 26px | 22px | 1,25 | 0 |
| H4 | Open Sans | 700 | 22px | 20px | 19px | 1,30 | 0 |
| Body L | Open Sans | 400 | 18px | 18px | 17px | 1,60 | 0 |
| Body | Open Sans | 400 | 16px | 16px | **16px** | 1,60 | 0 |
| Small | Open Sans | 400 | 14px | 14px | **14px** | 1,50 | 0 |
| Eyebrow | Open Sans | 600 | 12px | 12px | 12px | 1,40 | +0,12em, maiuscolo |
| Citazione | Arvo | 400 | 24px | 22px | 20px | 1,40 | 0 |

Vincoli che non si negoziano: body mobile **mai sotto 16px**, small mai sotto 14px,
line-height del testo di lettura **mai sotto 1,5**.

### 3.3 Regole d'uso

- Titolo a **due colori** (§9.2): la parte evidenziata è **una sola parola**, in lima su fondo blu
  o in blu su fondo carta.
- Arvo massimo **3 righe** per titolo; oltre, riscrivi il titolo.
- Maiuscolo integrale solo su eyebrow, etichette ed etichette di bottone; mai su un paragrafo.
- Numeri grandi (dati, KPI): Arvo 700, colore azul o lima su fondo scuro.

---

## 4. Spaziatura e griglia `[TECNICO]`

**Scala:** 4 · 8 · 16 · 24 · 32 · 48 · 64 · 96 px. Nessun valore fuori scala.

- Padding verticale di sezione: **96px desktop / 64px tablet / 48px mobile**
- Gutter laterale minimo su mobile: **16px** — nessuno scroll orizzontale, mai
- Griglia: 12 colonne desktop, 8 tablet, 4 mobile; larghezza massima contenuto **1200px**,
  testo di lettura massimo **72 caratteri** per riga
- Raggi: `4px` (input, tag) · `8px` (bottoni, card) · `0` (blocchi editoriali e recorte)
- Ombre: una sola, `0 12px 32px rgba(47, 58, 228, .10)` — l'ombra è blu, non nera

---

## 5. Stati dei componenti `[TECNICO]`

Vanno definiti qui, non lasciati al builder.

### Bottone primario
| Stato | Fondo | Testo | Note |
|---|---|---|---|
| Default | `#2F3AE4` | `#FFFFFF` | 7,38:1 |
| Hover | `#2042BE` | `#FFFFFF` | 8,13:1 |
| Active | `#1B2FA8` | `#FFFFFF` | 10,40:1 |
| Focus | `#2F3AE4` | `#FFFFFF` | anello 2px `#111827` + offset 2px — **obbligatorio e visibile** |
| Disabled | `#E3E5EA` | `#767C8B` | nessun hover, cursore `not-allowed` |

### Bottone accento (lima)
Fondo `#AAD800`, **testo nero** (12,53:1), hover `#9BC500`, focus anello nero.
Mai testo bianco. Usalo una volta per schermata: è l'accento, non il default.

### Bottone secondario
Fondo trasparente, bordo 2px `#2F3AE4`, testo `#2F3AE4`; hover fondo `#EEF0FE`.

### Link in testo
`#2042BE` **sempre sottolineato**: il colore da solo non basta a distinguerlo.
Su fondo blu: bianco sottolineato. Hover: spessore sottolineatura da 1px a 2px.

### Input
Bordo 1px `#8E94A3` (3,04:1), raggio 4px, altezza 48px, testo 16px (sotto i 16px iOS zooma).
Focus: bordo 2px `#2F3AE4` + anello esterno 2px `#EEF0FE`.
Errore: bordo `#A11B14` + messaggio testuale sotto il campo (non solo il bordo rosso) + icona.
Successo: bordo `#176B41`.

### Card con link
Tutta la card è cliccabile. Hover: ombra blu + spostamento di 2px verso l'alto, non cambio colore
di fondo. Il titolo della card è il link accessibile.

### Stato vuoto
Fondo carta `#F7F7F5`, titolo H4, testo secondario, un solo CTA primario. Mai una pagina bianca.

---

## 6. Logo (dal brand book)

### 6.1 Varianti
Bianco · su lima · su azul · **solo isotipo**.
Colore su azul: ammesso solo nella variante prevista dal brand book.

### 6.2 Misure minime
| Supporto | Minimo |
|---|---|
| Stampa | **30 mm** |
| Schermo | **110 px** |
| Solo isotipo (schermo) | **70 px** |

### 6.3 Aria di rispetto
**Aria minima = altezza della «L»** del logotipo, su tutti i quattro lati.
Niente testo, bordo o foto dentro quell'area.

### 6.4 Posizionamento — cinque posizioni, nessuna altra
1. alto sinistra · 2. alto destra · 3. centrato · 4. basso sinistra · 5. basso destra.
Il sistema è dinamico nella scelta, rigido nell'elenco: non si piazza "a occhio".

### 6.5 Usi vietati
Ricolorare · deformare · ruotare · applicare effetti · fondo affollato ·
separare il nome (`INSIDERS LAB` staccato) · cambiare il descrittore
(«Digital Agency», «Web Marketing» → **no**, è *Creative Agency*).

---

## 7. Kit grafico e fotografia (dal brand book)

**Sei elementi:** Papel · Semitono · Recorte · Estrella · Trazo · Cinta.

Regole d'uso:
- **Papel** sempre al 100% di opacità
- **Massimo 3 stelle** per composizione
- Rotazione ammessa **±15°**
- **25% della tela a riposo**: un quarto della superficie resta vuoto

**Fotografia:** bianco e nero · trama (semitono) visibile · ritaglio a silhouette ·
contorno 3–6 px. Nessuna foto a colori, nessun render 3D.

---

## 8. Applicazione social — 1080 × 1350 (dal brand book)

### 8.1 Quattro template
**A · Dichiarazione** — **B · Domanda** — **C · Sistema** — **D · Chiamata (CTA)**

### 8.2 Anatomia della pagina
1. Logotipo **bianco in alto**
2. Titolo **a due colori**
3. Sottotitolo, **massimo 2 righe**
4. **Un solo recorte** protagonista
5. Accenti negli angoli liberi

### 8.3 Ritmo del feed
Massimo **2 pezzi consecutivi** con lo stesso fondo ·
**1 di carta chiara ogni 3 di blu**.

### 8.4 Sì / No — dal brand book, alla lettera

| ✅ Sì | ❌ No |
|---|---|
| Blu dominante, lima d'accento | Lima come fondo maggioritario |
| Semitono in bianco e nero | Fotografia a colori o render 3D |
| Arvo titola, Open Sans legge | Arvo in paragrafi lunghi |
| 25% della tela a riposo | Saturare la tela |
| Una sola parola in lima | Collage su fatture o report |

---

## 9. Mapping Elementor Site Kit `[TECNICO]`

Da impostare una volta per progetto, in *Impostazioni sito → Colori globali / Font globali*.
I nomi restano semantici: al rebranding si cambia il valore, non ogni widget.

**Colori globali**
| Globale Elementor | Valore |
|---|---|
| Primario | `#2F3AE4` |
| Secondario | `#2042BE` |
| Testo | `#111827` |
| Accento | `#AAD800` |
| (custom) Testo secondario | `#5B6070` |
| (custom) Sfondo carta | `#F7F7F5` |
| (custom) Bordo | `#8E94A3` |

**Font globali**
| Globale Elementor | Famiglia | Peso |
|---|---|---|
| Primario (titoli) | Arvo | 700 |
| Secondario (sottotitoli) | Arvo | 400 |
| Testo | Open Sans | 400 |
| Accento (eyebrow/bottoni) | Open Sans | 600 |

Breakpoint: tablet 1024px, mobile 767px (standard dello stack). I valori della §3.2 vanno
inseriti per tutti e tre i dispositivi, non solo desktop.

---

## 10. Punti aperti — da decidere, non da indovinare

1. **Discrepanza di palette tra i due documenti Canva.** Il *Manuale del Marchio*
   (`DAHJjKofTHw`) riporta Blu Elettrico `#353DE3` e Verde Acido `#8BCE00`; il *Brand Book*
   (`DAHRh4VZtME`), più recente e più completo, riporta `#2F3AE4` e `#AAD800`.
   Questo documento segue il Brand Book. **Serve una decisione formale** e l'allineamento
   (o l'archiviazione) del manuale vecchio: due palette in circolazione significano due brand.
2. **Bug nel Manuale del Marchio:** la pagina "Tipografia" contiene un testo di un altro
   cliente — descrive l'identità di **Flamòr** (Montserrat + Brittany), non InsidersLab.
   Va corretto o la pagina va rimossa: è esattamente il tipo di errore di concetto su cui
   ci hanno ripreso su un altro progetto.
3. **Dark mode:** non esiste nel brand book. Se serve per dashboard e documenti, va derivata
   e misurata, non improvvisata.
4. **File di logo:** il brand book descrive le varianti ma questo repo non contiene gli SVG.
   Servono `logo-bianco.svg`, `logo-azul.svg`, `logo-lima.svg`, `isotipo.svg` in
   `design-system/logo/`.
5. **Font self-hosted:** Arvo e Open Sans vanno messi in un pacchetto WOFF2 unico riusabile
   su tutti i progetti, invece di essere riscaricati per ogni sito.
6. **insiderslab.it non è stato verificato:** il dominio è bloccato dalla policy di rete di
   questa sessione, quindi non è stato possibile controllare se il sito live rispetta questi
   valori. È il primo controllo da fare.
