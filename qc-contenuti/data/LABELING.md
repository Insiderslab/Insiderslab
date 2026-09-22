# Come etichettare le caption

Questo non e' un foglio usa-e-getta: e' il **dataset**. Serve prima a misurare se
il gate automatico regge sui nostri contenuti, e poi — se un giorno passiamo a un
modello nostro — come materiale di addestramento. Etichettare male qui costa due
volte.

## Come si etichetta (la via facile)

**Non scrivere JSON a mano.** Si lavora su foglio:

1. Apri `template-etichettatura.csv` con Excel, o importalo in Google Sheets.
2. Il team compila una riga per caption (le due righe di esempio si cancellano).
3. Esporta in CSV e converti:

```
python scripts/csv_to_jsonl.py data\etichette.csv data\captions.jsonl
```

Il convertitore controlla tutto prima di scrivere: se una riga e' sbagliata ti
dice numero di riga e motivo, e non produce un file a meta'. Alla fine ti stampa
quanti positivi hai per ogni domanda, e ti avvisa se sono troppo pochi perche' la
soglia sia stimabile.

Accetta `si`, `SI`, `x`, `1`, `true` per il vero; `no`, `0` o cella vuota per il
falso — cosi' chi compila non deve stare attento alla forma.

## Formato prodotto

Un file `.jsonl`: **una riga per caption**, JSON valido su riga singola.
Vedi `captions.sample.jsonl` (quelle sono tre righe sintetiche, da buttare).

Campi:

| Campo | Cosa contiene |
|---|---|
| `id` | identificativo stabile (es. `HEC-2026-09-014`) |
| `cliente` | slug del cliente |
| `brand.nome` | nome del brand |
| `brand.tono_di_voce` | 2-3 righe che descrivono la voce del brand. **Serve al modello**: senza questo `tono_brand` non ha senso |
| `caption` | il testo esatto, come sarebbe pubblicato |
| `etichette` | il giudizio umano, campo per campo (sotto) |
| `verdetto_umano` | `pass`, `review` o `block` |
| `note` | libere, per i casi discutibili |

## Le etichette

Sei domande sono **vero/falso**. Rispondi al testo *cosi' com'e'*, non a cosa
intendeva chi l'ha scritto:

- `claim_garantito` — promette un risultato garantito/certo?
- `claim_sanitario` — afferma che cura, guarisce o tratta una condizione fisica?
  (estetico puro = `false`)
- `dato_non_verificabile` — cita un numero o una percentuale senza fonte?
- `urgenza_ingannevole` — urgenza/scarsita' senza scadenza o quantita' concreta?
- `prezzo_esplicito` — indica un prezzo, uno sconto o un importo?
- `nomina_competitor` — nomina un concorrente?

Una e' **a livelli** (`tono_brand`, da 0 a 3):

- `0` chiaramente fuori tono
- `1` riconoscibilmente fuori, da riscrivere
- `2` accettabile, piccoli problemi
- `3` pienamente in linea

Una e' **a categorie** (`categoria`): `promo`, `educativo`, `storytelling`,
`engagement`, `altro`.

## Regole di lavoro

1. **Almeno 100 caption**, e devono somigliare al traffico vero: tutti i clienti,
   tutti i formati, non solo i casi facili.
2. **Includere i casi limite.** Un dataset di soli casi ovvi produce una misura
   ottimista e inutile.
3. **Due persone in doppio cieco su almeno 20** delle 100. Se non siete d'accordo
   voi due, il modello non puo' fare meglio: quel disaccordo e' il tetto massimo
   di accuratezza raggiungibile, ed e' il numero piu' importante di tutto il
   pilota.
4. **Non guardare l'output del modello mentre etichetti.** Se lo fai, la misura
   e' compromessa e non te ne accorgi.
5. Se una caption non si riesce a giudicare, mettila comunque con una `note`:
   quelle sono le piu' informative.

## Poi

```bash
QC_PROVIDER=typesafe python scripts/run_eval.py data/captions.jsonl
```
