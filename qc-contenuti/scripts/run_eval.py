#!/usr/bin/env python3
"""Misura l'accordo fra il gate automatico e i giudizi del team.

E' lo strumento che decide il pilota. Risponde a tre domande:

1. Su ogni singola domanda, quanto spesso il modello e' d'accordo con noi?
2. Le probabilita' sono affidabili? (ECE: se dice 0.8, ha ragione l'80% delle volte?)
3. A che soglia conviene tagliare, e quanto lavoro umano resta?

Niente dipendenze esterne: solo libreria standard.

Il fornitore si sceglie nel .env (QC_PROVIDER) oppure con --provider.
Funziona identico su Windows, macOS e Linux:

    python scripts/run_eval.py data/captions.sample.jsonl --provider fake
    python scripts/run_eval.py data/captions.jsonl --provider typesafe
"""

import argparse
import json
import os
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qc.config import carica_env  # noqa: E402
from qc.policy import Decision, Thresholds, decide  # noqa: E402
from qc.providers import get_provider  # noqa: E402
from qc.questions import QUESTION_SETS  # noqa: E402
from qc.schema import Choice, Noul, Score  # noqa: E402

SOGLIE = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]


def carica(path: Path) -> list[dict]:
    righe = []
    for n, riga in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        riga = riga.strip()
        if not riga:
            continue
        try:
            righe.append(json.loads(riga))
        except json.JSONDecodeError as exc:
            sys.exit(f"riga {n} di {path}: JSON non valido ({exc})")
    if not righe:
        sys.exit(f"{path} e' vuoto")
    return righe


def stato(riga: dict) -> dict:
    """Lo stato mandato al modello. Solo cio' che serve a rispondere."""
    return {
        "caption": riga["caption"],
        "brand": riga.get("brand", {}),
    }


def ece(coppie: list[tuple[float, bool]], bucket: int = 10) -> float:
    """Expected Calibration Error: scarto medio fra probabilita' dichiarata e realta'.

    0 = perfetto. Sopra ~0.1 le soglie iniziano a non voler dire granche'.
    """
    if not coppie:
        return float("nan")
    bins: dict[int, list[tuple[float, bool]]] = defaultdict(list)
    for p, vero in coppie:
        bins[min(int(p * bucket), bucket - 1)].append((p, vero))
    totale = 0.0
    for gruppo in bins.values():
        media_p = sum(p for p, _ in gruppo) / len(gruppo)
        frazione = sum(1 for _, v in gruppo if v) / len(gruppo)
        totale += len(gruppo) * abs(media_p - frazione)
    return totale / len(coppie)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--questions", choices=["en", "it"], default="en",
                        help="lingua delle domande (lo stato resta sempre in italiano)")
    parser.add_argument("--dump", type=Path, help="salva le risposte grezze in JSONL")
    parser.add_argument("--provider", choices=["typesafe", "fake"], default=None,
                        help="sovrascrive QC_PROVIDER del .env")
    args = parser.parse_args()

    carica_env()

    if not args.dataset.is_file():
        sys.exit(
            f"file non trovato: {args.dataset}\n"
            f"cartella corrente: {Path.cwd()}\n"
            "Lancia il comando dalla cartella qc-contenuti del progetto."
        )

    righe = carica(args.dataset)
    domande = QUESTION_SETS[args.questions]
    try:
        provider = get_provider(args.provider or "")
    except Exception as exc:  # noqa: BLE001
        sys.exit(f"fornitore non utilizzabile: {exc}")

    if provider.name == "fake":
        print("!! fornitore 'fake': risposte finte, i numeri qui sotto non "
              "significano nulla.\n   Per un giro reale: --provider typesafe "
              "(serve TYPESAFE_API_KEY nel .env).\n", file=sys.stderr)

    noul_coppie: dict[str, list[tuple[float, bool]]] = defaultdict(list)
    score_err: list[float] = []
    choice_ok: list[bool] = []
    verdetti: list[tuple[str, str]] = []
    grezzi = []
    errori = 0

    for riga in righe:
        try:
            risposte = provider.evaluate(stato(riga), domande)
        except Exception as exc:  # noqa: BLE001
            print(f"  {riga.get('id','?')}: errore -> {exc}", file=sys.stderr)
            errori += 1
            continue

        etichette = riga.get("etichette", {})
        for qid, domanda in domande.items():
            risposta = risposte.get(qid)
            if risposta is None or qid not in etichette:
                continue
            atteso = etichette[qid]
            if isinstance(domanda, Noul):
                noul_coppie[qid].append((float(risposta.value), bool(atteso)))
            elif isinstance(domanda, Score):
                score_err.append(abs(float(risposta.value) - float(atteso)))
            elif isinstance(domanda, Choice):
                choice_ok.append(risposta.value == atteso)

        if "verdetto_umano" in riga:
            verdetti.append((decide(risposte).decision.value, riga["verdetto_umano"]))
        if args.dump:
            grezzi.append({
                "id": riga.get("id"),
                "risposte": {k: {"value": v.value, "confidence": v.confidence}
                             for k, v in risposte.items()},
            })

    if args.dump and grezzi:
        args.dump.write_text(
            "\n".join(json.dumps(g, ensure_ascii=False) for g in grezzi) + "\n",
            encoding="utf-8",
        )

    valutate = len(righe) - errori
    print(f"\nDataset: {args.dataset}  ({valutate}/{len(righe)} valutate, "
          f"domande in {args.questions}, fornitore {provider.name})")
    if errori:
        print(f"  {errori} righe fallite")

    print("\n== Domande si'/no: accuratezza per soglia ==")
    print("  (P = precision sui positivi, R = recall, ECE = qualita' delle probabilita')")
    for qid, coppie in sorted(noul_coppie.items()):
        positivi = sum(1 for _, v in coppie if v)
        print(f"\n  {qid}  [{positivi}/{len(coppie)} positivi reali]  "
              f"ECE={ece(coppie):.3f}")
        if positivi == 0:
            print("    nessun positivo nel dataset: soglia non stimabile")
            continue
        migliore, miglior_f1 = None, -1.0
        for s in SOGLIE:
            tp = sum(1 for p, v in coppie if p >= s and v)
            fp = sum(1 for p, v in coppie if p >= s and not v)
            fn = sum(1 for p, v in coppie if p < s and v)
            prec = tp / (tp + fp) if tp + fp else 0.0
            rec = tp / (tp + fn) if tp + fn else 0.0
            f1 = 2 * prec * rec / (prec + rec) if prec + rec else 0.0
            if f1 > miglior_f1:
                migliore, miglior_f1 = s, f1
            print(f"    soglia {s:.1f}  P={prec:.2f}  R={rec:.2f}  F1={f1:.2f}")
        print(f"    -> miglior F1 a soglia {migliore:.1f} ({miglior_f1:.2f})")

    if score_err:
        print(f"\n== tono_brand ==\n  errore medio assoluto: "
              f"{sum(score_err)/len(score_err):.2f} livelli")
    if choice_ok:
        print(f"\n== categoria ==\n  accuratezza: "
              f"{sum(choice_ok)/len(choice_ok):.1%}")

    if verdetti:
        print("\n== Verdetto finale vs giudizio umano ==")
        accordo = sum(1 for a, u in verdetti if a == u) / len(verdetti)
        print(f"  accordo esatto: {accordo:.1%}")
        gravi = sum(1 for a, u in verdetti
                    if u == "block" and a == Decision.PASS.value)
        print(f"  ERRORI GRAVI (umano=block, gate=pass): {gravi}")
        n = len(verdetti)
        quote = {d: sum(1 for a, _ in verdetti if a == d) / n
                 for d in ("pass", "review", "block")}
        print(f"  il gate fa passare da solo:  {quote['pass']:.1%}")
        print(f"  il gate blocca da solo:      {quote['block']:.1%}")
        print(f"  RESTA DA GUARDARE A MANO:    {quote['review']:.1%}"
              "   <- il carico di lavoro residuo")
        matrice: dict[tuple[str, str], int] = defaultdict(int)
        for a, u in verdetti:
            matrice[(u, a)] += 1
        print("\n  umano \\ gate :  pass  review  block")
        for u in ("pass", "review", "block"):
            riga_m = "  ".join(f"{matrice[(u,a)]:5d}"
                               for a in ("pass", "review", "block"))
            print(f"  {u:<13}  {riga_m}")

    print("""
Come si legge, in ordine di importanza:

  1. ERRORI GRAVI. Sono le caption che una persona avrebbe bloccato e il gate fa
     passare. Se non sono ZERO, il gate puo' solo segnalare, non bloccare.
  2. RESTA DA GUARDARE A MANO. E' il risparmio vero: se resta alto, il pilota non
     paga. Confrontalo con il 100% di oggi, non con zero.
  3. ECE. Sopra ~0.1 le probabilita' non reggono una soglia: tieni la revisione
     larga e non fidarti dei numeri di confidenza.

Il tetto massimo non e' il 100%: e' l'accordo fra due persone del team sulle
stesse caption. Se voi due siete d'accordo al 70%, il modello non fara' meglio.
""")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
