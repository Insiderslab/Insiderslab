# Spec — [Prodotto] · [Schermata / Sezione / Componente]

**Flusso:** ___ · **Passo:** _ di _ · **Task servito:** T_
**Obiettivo della schermata (una frase):** ___
**Azione primaria (una sola):** ___ → porta a ___
**Azioni secondarie:** ___

## Layout
```
[wireframe ASCII o link al frame Figma]
```
- Griglia: ___ colonne, gutter ___px, larghezza massima contenuto ___px
- Allineamento: ___
- Ordine di lettura e di focus da tastiera: 1. ___ 2. ___ 3. ___

## Contenuto
| Elemento | Tipo | Testo o regola | Lunghezza max | Nota |
|---|---|---|---|---|
| Titolo | H1 | ___ | 60 caratteri | |
| CTA primaria | Button | verbo + oggetto: "___" | 25 caratteri | |
| Media | Immagine | proporzione __:__, min ____×____ px, punto focale ___ | | alt: ___ |

## Comportamento responsive
| Viewport | Cosa cambia |
|---|---|
| Mobile (< 768) | ___ |
| Tablet (768–1279) | ___ |
| Desktop (≥ 1280) | ___ |

## Stati (i 10 di `design-system.md § 6`, obbligatori per ogni elemento interattivo)
| Elemento | Default | Hover | Focus visibile | Attivo/premuto | Disabilitato | Caricamento | Errore | Successo | Vuoto | Selezionato/corrente |
|---|---|---|---|---|---|---|---|---|---|---|
| ___ | | | | | | | | | | |

"N/A" va motivato, non lasciato vuoto.

## Casi limite (tutti e 4 obbligatori)
- Testo molto lungo / nome di 40 caratteri: ___
- Zero risultati / primo utilizzo: ___
- Errore di rete o server: ___
- Permessi mancanti: ___

## Token usati
Colori: `color.___` · Tipografia: `type.___` · Spaziature: `space.___` · Raggi: `radius.___`
Nessun valore esadecimale o in px fuori dai token.

## Accessibilità
- Contrasti verificati con `scripts/contrast_check.py`: ✅ / ❌
- Target: ≥ 24×24 CSS px per ogni target non in linea (WCAG 2.5.8, con eccezioni); ≥ 44×44
  per la CTA primaria e i controlli principali su mobile; app native 44 pt / 48 dp
- Etichette accessibili per icone senza testo: ___
- Annunci per screen reader (aria-live) su: ___

## Criteri di accettazione
- [ ] Dato ___, quando ___, allora ___
- [ ] ___

## Note per la grafica (asset)
- ___ (formato, misure esatte, proporzione, punto focale, peso massimo)
