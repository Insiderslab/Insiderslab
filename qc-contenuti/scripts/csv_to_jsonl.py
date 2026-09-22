#!/usr/bin/env python3
"""Converte il foglio di etichettatura (CSV) nel JSONL che legge run_eval.py.

Il team etichetta su Google Sheets o Excel, esporta in CSV, e questo script
produce il dataset. Nessuno deve scrivere JSON a mano.

    python scripts/csv_to_jsonl.py data/etichette.csv data/captions.jsonl

Controlla tutto prima di scrivere: se una riga e' sbagliata lo dice con il numero
di riga e non produce un file a meta'.
"""

import argparse
import csv
import json
import sys
from pathlib import Path

BOOLEANE = [
    "claim_garantito",
    "claim_sanitario",
    "dato_non_verificabile",
    "urgenza_ingannevole",
    "prezzo_esplicito",
    "nomina_competitor",
]
CATEGORIE = {"promo", "educativo", "storytelling", "engagement", "altro"}
VERDETTI = {"pass", "review", "block"}

VERO = {"si", "sì", "s", "yes", "y", "true", "vero", "1", "x"}
FALSO = {"no", "n", "false", "falso", "0", ""}


def leggi_bool(valore: str, riga: int, colonna: str) -> bool:
    v = (valore or "").strip().lower()
    if v in VERO:
        return True
    if v in FALSO:
        return False
    raise ValueError(
        f"riga {riga}, colonna '{colonna}': {valore!r} non e' si'/no "
        f"(accettati: si, no, 1, 0, x, vuoto)"
    )


def converti(sorgente: Path, destinazione: Path) -> int:
    with sorgente.open(encoding="utf-8-sig", newline="") as f:
        lettore = csv.DictReader(f)
        if lettore.fieldnames is None:
            sys.exit(f"{sorgente} sembra vuoto")
        mancanti = ({"id", "caption", "tono_brand", "categoria", "verdetto_umano"}
                    | set(BOOLEANE)) - set(lettore.fieldnames)
        if mancanti:
            sys.exit(
                "colonne mancanti nel CSV: " + ", ".join(sorted(mancanti)) +
                "\nUsa data/template-etichettatura.csv come base."
            )

        righe, errori, visti = [], [], set()
        for numero, riga in enumerate(lettore, start=2):
            try:
                identificativo = (riga.get("id") or "").strip()
                caption = (riga.get("caption") or "").strip()
                if not identificativo or not caption:
                    raise ValueError(f"riga {numero}: 'id' o 'caption' vuoti")
                if identificativo in visti:
                    raise ValueError(f"riga {numero}: id duplicato {identificativo!r}")
                visti.add(identificativo)

                etichette = {c: leggi_bool(riga.get(c, ""), numero, c) for c in BOOLEANE}

                tono = (riga.get("tono_brand") or "").strip()
                if tono not in {"0", "1", "2", "3"}:
                    raise ValueError(
                        f"riga {numero}: tono_brand={tono!r}, atteso 0, 1, 2 o 3"
                    )
                etichette["tono_brand"] = int(tono)

                categoria = (riga.get("categoria") or "").strip().lower()
                if categoria not in CATEGORIE:
                    raise ValueError(
                        f"riga {numero}: categoria={categoria!r}, "
                        f"attesa una di {sorted(CATEGORIE)}"
                    )
                etichette["categoria"] = categoria

                verdetto = (riga.get("verdetto_umano") or "").strip().lower()
                if verdetto not in VERDETTI:
                    raise ValueError(
                        f"riga {numero}: verdetto_umano={verdetto!r}, "
                        f"atteso uno di {sorted(VERDETTI)}"
                    )

                voce = {
                    "id": identificativo,
                    "cliente": (riga.get("cliente") or "").strip(),
                    "brand": {
                        "nome": (riga.get("brand_nome") or "").strip(),
                        "tono_di_voce": (riga.get("brand_tono_di_voce") or "").strip(),
                    },
                    "caption": caption,
                    "etichette": etichette,
                    "verdetto_umano": verdetto,
                }
                note = (riga.get("note") or "").strip()
                if note:
                    voce["note"] = note
                righe.append(voce)
            except ValueError as exc:
                errori.append(str(exc))

    if errori:
        print(f"{len(errori)} righe da sistemare, nessun file scritto:\n", file=sys.stderr)
        for e in errori:
            print(f"  - {e}", file=sys.stderr)
        return 1

    destinazione.write_text(
        "\n".join(json.dumps(v, ensure_ascii=False) for v in righe) + "\n",
        encoding="utf-8",
    )

    positivi = {c: sum(1 for v in righe if v["etichette"][c]) for c in BOOLEANE}
    verdetti = {v: sum(1 for r in righe if r["verdetto_umano"] == v) for v in VERDETTI}
    print(f"Scritte {len(righe)} caption in {destinazione}\n")
    print("  verdetti:  " + "  ".join(f"{k}={v}" for k, v in verdetti.items()))
    print("  positivi:  " + "  ".join(f"{k}={v}" for k, v in positivi.items()))
    scarsi = [k for k, v in positivi.items() if v < 5]
    if scarsi:
        print(
            "\n  Attenzione: meno di 5 casi positivi per " + ", ".join(scarsi) +
            ".\n  Su questi la soglia non e' stimabile in modo affidabile: "
            "servono piu' esempi\n  che li contengano davvero."
        )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("csv", type=Path)
    parser.add_argument("jsonl", type=Path, nargs="?", default=Path("data/captions.jsonl"))
    args = parser.parse_args()
    if not args.csv.is_file():
        sys.exit(f"file non trovato: {args.csv}\ncartella corrente: {Path.cwd()}")
    return converti(args.csv, args.jsonl)


if __name__ == "__main__":
    raise SystemExit(main())
