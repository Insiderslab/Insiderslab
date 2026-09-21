# QC contenuti — pilota

Gate automatico di controllo sulle caption **prima** della pubblicazione.
Il modello dà letture semantiche (probabilità); **il codice decide**.

Obiettivo del pilota: rispondere a **una** domanda misurabile —
*questo approccio funziona sui nostri contenuti in italiano, sì o no?*

Finché quella risposta non c'è, questa cartella non è un prodotto.

## Stato

| | |
|---|---|
| Schema interno neutro | fatto |
| Adapter TypeSafe | scritto, **mai eseguito contro l'API reale** |
| Domande di QC (IT + EN) | scritte su esempi sintetici, **da rivedere su caption vere** |
| Policy PASS/REVIEW/BLOCK | fatta, **soglie non tarate** |
| Script di valutazione | funzionante |
| Test | 14, verdi, offline |
| Dataset etichettato | **manca** — è il prossimo passo |

## Avvertenza sull'adapter

`qc/providers/typesafe.py` è scritto contro un contratto **non verificato**:
`docs.typesafe.ai` e `api.typesafe.ai` erano bloccati dal proxy dell'ambiente in
cui è stato sviluppato, quindi la forma di richiesta/risposta viene da materiale
di terze parti, non dalla documentazione ufficiale.

Per questo tutta la mappatura specifica sta in **quell'unico file**. Al primo run
reale è normale dover correggere `_parse()` o `evaluate()`; nient'altro cambia.
Gli errori sono scritti per dire esattamente cosa non torna e dove metterci mano.

## Avvio

```bash
pip install -r requirements.txt     # solo pytest
cp .env.example .env                # poi metti la chiave nel .env
pytest -q                           # 14 test, nessuna rete

# giro a vuoto, senza chiave e senza rete
QC_PROVIDER=fake python scripts/run_eval.py data/captions.sample.jsonl

# giro reale, quando hai chiave e dataset
QC_PROVIDER=typesafe python scripts/run_eval.py data/captions.jsonl
```

La chiave sta nel `.env` locale. Non nel repository, non in chat, non in un ticket.
`.env` e `data/captions.jsonl` sono in `.gitignore`: **le caption reali dei clienti
non vanno committate** — questo repository è il profilo GitHub pubblico.

## Struttura

```
qc/schema.py            contratto interno: Choice, Score, Noul, Answer
qc/questions.py         le domande di QC, in inglese e in italiano
qc/policy.py            PASS / REVIEW / BLOCK — soglie e regole, nel codice
qc/providers/
  base.py               il contratto che ogni fornitore rispetta
  typesafe.py           adapter TypeSafe — l'unico file legato al fornitore
  fake.py               finto deterministico, per lavorare offline
scripts/run_eval.py     accordo con i giudizi umani, ECE, sweep delle soglie
data/LABELING.md        come etichettare (leggilo prima di iniziare)
```

## Tre scelte di progetto

**Lo schema è neutro.** Niente sopra `qc/providers/` sa cosa c'è sotto. Cambiare
fornitore — Laya self-hosted, un modello nostro, un altro gateway — è scrivere un
file e cambiare `QC_PROVIDER`. Non è teoria: se il GDPR domani vieta di mandare i
contenuti di un cliente fuori, quella è la via d'uscita già pronta.

**Le domande sono in inglese, lo stato in italiano.** Jev è addestrato in
prevalenza su inglese e non esiste una valutazione multilingue pubblicata: tenere
la domanda in inglese toglie una variabile. È un'ipotesi, non un dato — infatti
c'è anche il set italiano, e `--questions it` misura la differenza sui dati veri.

**Nessuna media pesata dei rischi.** Un claim sanitario non si compensa con un
tono di voce ottimo. I rischi gravi hanno condizioni separate che bloccano da
sole; i segnali morbidi mandano in revisione. Le medie pesate servono a preferenze
che si compensano davvero — qui non ce ne sono.

## Prossimo passo

Etichettare **100 caption reali** seguendo `data/LABELING.md`, poi lanciare
`run_eval.py`. I numeri che contano, in ordine:

1. **Errori gravi** (umano dice `block`, gate dice `pass`). Se non sono zero, il
   gate non può bloccare da solo — al massimo segnala.
2. **ECE**. Sopra ~0.1 le probabilità non reggono una soglia, e conviene tenere
   la revisione umana larga.
3. **Quota automatizzabile**. È il risparmio vero. Se è bassa, il pilota non paga
   e va chiuso — che è un risultato, non un fallimento.

L'accordo fra due persone del team sulle stesse 20 caption è il **tetto massimo**:
il modello non può superare chi lo giudica.

> Nota: questa cartella sta nel repository del profilo GitHub perché è lì che il
> lavoro è iniziato. Prima di andare in produzione va spostata in un repository
> suo, privato.
