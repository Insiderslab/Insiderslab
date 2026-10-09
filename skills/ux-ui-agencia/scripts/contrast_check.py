#!/usr/bin/env python3
"""
Gate deterministico G3 — Contrasto WCAG 2.2 (criteri 1.4.3 e 1.4.11).

Calcola il rapporto di contrasto per ogni coppia colore-testo / colore-sfondo e
restituisce una tabella Markdown pronta da incollare nel report o nel design system.
Exit code 1 se anche una sola coppia non raggiunge la soglia AA del suo uso.

Uso:
    python contrast_check.py "#1A1A1A" "#FFFFFF"                 # coppia singola, uso = testo
    python contrast_check.py "#0057FF" "#FFFFFF" --uso ui
    python contrast_check.py --palette palette.json

Formato palette.json:
    {"coppie": [
        {"nome": "Testo su Sfondo", "fg": "#222222", "bg": "#FFFFFF", "uso": "testo"},
        {"nome": "CTA testo su Primario", "fg": "#FFFFFF", "bg": "#0057FF", "uso": "testo"},
        {"nome": "Bordo input su Sfondo", "fg": "#8A8A8A", "bg": "#FFFFFF", "uso": "ui"}
    ]}

Usi ammessi e soglia AA:
    testo         4.5:1  (testo normale, < 24px regular o < 18.66px bold)
    testo-grande  3.0:1  (>= 24px regular o >= 18.66px bold)
    ui            3.0:1  (bordi input, icone informative, focus ring, stati — WCAG 1.4.11)
    decorativo    nessuna soglia (riportato solo per informazione)

Colori con alpha (#RRGGBBAA o #RGBA) vengono composti sopra lo sfondo prima del calcolo.
Nessuna dipendenza esterna.
"""

import argparse
import json
import sys

SOGLIE_AA = {"testo": 4.5, "testo-grande": 3.0, "ui": 3.0, "decorativo": 0.0}
SOGLIE_AAA = {"testo": 7.0, "testo-grande": 4.5, "ui": None, "decorativo": None}


def parse_hex(value):
    """Restituisce (r, g, b, a) con r,g,b in 0-255 e a in 0-1."""
    h = value.strip().lstrip("#")
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    if len(h) not in (6, 8):
        raise ValueError(f"Colore non valido: {value!r} (usa #RGB, #RGBA, #RRGGBB o #RRGGBBAA)")
    try:
        r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
        a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    except ValueError as exc:
        raise ValueError(f"Colore non valido: {value!r}") from exc
    return r, g, b, a


def compose(fg, bg):
    """Compone fg (con alpha) sopra bg opaco."""
    r1, g1, b1, a = fg
    r2, g2, b2, _ = bg
    return (
        round(r1 * a + r2 * (1 - a)),
        round(g1 * a + g2 * (1 - a)),
        round(b1 * a + b2 * (1 - a)),
    )


def luminanza(rgb):
    def canale(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (canale(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def rapporto(fg_hex, bg_hex):
    bg = parse_hex(bg_hex)
    if bg[3] < 1.0:
        raise ValueError(f"Lo sfondo {bg_hex!r} deve essere opaco: componilo prima sul colore sottostante")
    fg = compose(parse_hex(fg_hex), bg)
    l1, l2 = luminanza(fg), luminanza(bg[:3])
    chiaro, scuro = max(l1, l2), min(l1, l2)
    return (chiaro + 0.05) / (scuro + 0.05)


def valuta(coppia):
    uso = coppia.get("uso", "testo")
    if uso not in SOGLIE_AA:
        raise ValueError(f"Uso non valido: {uso!r} (ammessi: {', '.join(SOGLIE_AA)})")
    r = rapporto(coppia["fg"], coppia["bg"])
    soglia = SOGLIE_AA[uso]
    aaa = SOGLIE_AAA[uso]
    if uso == "decorativo":
        esito = "— (decorativo)"
        passa = True
    else:
        passa = r >= soglia
        esito = "✅ AA" if passa else f"❌ FALLISCE AA (serve {soglia}:1)"
        if passa and aaa and r >= aaa:
            esito = "✅ AAA"
    return {
        "nome": coppia.get("nome", f"{coppia['fg']} su {coppia['bg']}"),
        "fg": coppia["fg"],
        "bg": coppia["bg"],
        "uso": uso,
        "rapporto": r,
        "esito": esito,
        "passa": passa,
    }


def main():
    parser = argparse.ArgumentParser(description="Verifica contrasto WCAG 2.2 AA (gate G3).")
    parser.add_argument("fg", nargs="?", help="Colore primo piano (testo/elemento)")
    parser.add_argument("bg", nargs="?", help="Colore di sfondo")
    parser.add_argument("--uso", default="testo", choices=list(SOGLIE_AA))
    parser.add_argument("--palette", help="File JSON con le coppie da verificare")
    args = parser.parse_args()

    if args.palette:
        with open(args.palette, encoding="utf-8") as f:
            coppie = json.load(f).get("coppie", [])
        if not coppie:
            print("❌ Nessuna coppia trovata nel file palette (chiave 'coppie').")
            sys.exit(2)
    elif args.fg and args.bg:
        coppie = [{"fg": args.fg, "bg": args.bg, "uso": args.uso}]
    else:
        parser.print_help()
        sys.exit(2)

    try:
        risultati = [valuta(c) for c in coppie]
    except (ValueError, KeyError) as exc:
        print(f"❌ Errore nei dati: {exc}")
        sys.exit(2)

    print("| Coppia | Primo piano | Sfondo | Uso | Rapporto | Esito |")
    print("|---|---|---|---|---|---|")
    for r in risultati:
        print(f"| {r['nome']} | `{r['fg']}` | `{r['bg']}` | {r['uso']} | {r['rapporto']:.2f}:1 | {r['esito']} |")

    falliti = [r for r in risultati if not r["passa"]]
    print()
    if falliti:
        print(f"GATE G3: ❌ BLOCCATO — {len(falliti)} coppie sotto soglia AA: "
              + ", ".join(r["nome"] for r in falliti))
        sys.exit(1)
    print(f"GATE G3: ✅ SUPERATO — {len(risultati)} coppie verificate.")


if __name__ == "__main__":
    main()
