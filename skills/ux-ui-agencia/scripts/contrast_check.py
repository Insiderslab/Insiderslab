#!/usr/bin/env python3
"""
Gate deterministico G3 — Contrasto WCAG 2.2 (criteri 1.4.3 e 1.4.11).

Calcola il rapporto di contrasto per ogni coppia primo piano / sfondo e restituisce una
tabella Markdown pronta da incollare nel report o nel design system.
Exit code 1 se anche una sola coppia non raggiunge la soglia AA del suo uso; 2 se i dati
in ingresso non sono validi.

Uso:
    python contrast_check.py "#1A1A1A" "#FFFFFF"                  # coppia singola, uso = testo
    python contrast_check.py "rgb(0, 87, 255)" "#FFFFFF" --uso ui
    python contrast_check.py --palette palette.json                # modo progetto (default)
    python contrast_check.py --palette palette-estratta.json --modo audit

Formato palette.json:
    {"coppie": [
        {"nome": "Testo su Sfondo", "fg": "#222222", "bg": "#FFFFFF", "uso": "testo"},
        {"nome": "Bordo input", "fg": "rgb(138, 138, 138)", "bg": "#FFFFFF", "uso": "ui"},
        {"nome": "Titolo card", "fg": "#333333", "bg": "#F7F7F7", "size_px": 19.5, "bold": true}
    ]}
Se "uso" manca e ci sono "size_px" (e "bold"), l'uso testo / testo-grande si ricava da solo.
`scripts/audit_probe.js` produce questo formato (palette-estratta.json).

Usi ammessi e soglia AA:
    testo         4,5:1  (testo normale, < 24px regular o < 18,66px bold)
    testo-grande  3,0:1  (>= 24px regular o >= 18,66px bold)
    ui            3,0:1  (bordi input, icone informative, focus ring, stati — WCAG 1.4.11)
    decorativo    nessuna soglia — SOLO per elementi senza testo e senza funzione
                  (sfondi, ornamenti). Etichettare "decorativo" un testo o un controllo
                  per far passare il gate è un errore: lo script lo segnala nel riepilogo.

Colori accettati: #RGB, #RGBA, #RRGGBB, #RRGGBBAA, rgb(r, g, b), rgba(r, g, b, a).
I colori con alpha vengono composti sopra lo sfondo prima del calcolo.
Testo su gradiente o immagine: lo script non lo calcola da solo. Si estrae il colore nel
punto peggiore sotto il testo (o entrambi gli estremi del gradiente) e si passa come bg.

Modi:
    progetto (default)  riga finale "GATE G3: ✅ SUPERATO / ❌ BLOCCATO"
    audit               riga finale neutra "Esito: N coppie sotto soglia AA", da report
Nessuna dipendenza esterna.
"""

import argparse
import json
import re
import sys

SOGLIE_AA = {"testo": 4.5, "testo-grande": 3.0, "ui": 3.0, "decorativo": 0.0}
SOGLIE_AAA = {"testo": 7.0, "testo-grande": 4.5, "ui": None, "decorativo": None}
DEC = {"virgola": ",", "punto": "."}


def parse_colore(value):
    """Restituisce (r, g, b, a) con r,g,b in 0-255 e a in 0-1."""
    v = str(value).strip()
    m = re.fullmatch(r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+%?)\s*)?\)", v, re.I)
    if m:
        r, g, b = (float(m.group(i)) for i in (1, 2, 3))
        a_raw = m.group(4)
        a = 1.0 if a_raw is None else (float(a_raw[:-1]) / 100 if a_raw.endswith("%") else float(a_raw))
        if not all(0 <= c <= 255 for c in (r, g, b)) or not 0 <= a <= 1:
            raise ValueError(f"Colore fuori intervallo: {value!r}")
        return r, g, b, a
    h = v.lstrip("#")
    if len(h) in (3, 4):
        h = "".join(c * 2 for c in h)
    if len(h) not in (6, 8) or not re.fullmatch(r"[0-9a-fA-F]+", h):
        raise ValueError(f"Colore non valido: {value!r} (usa #RRGGBB, #RRGGBBAA, rgb() o rgba())")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    a = int(h[6:8], 16) / 255 if len(h) == 8 else 1.0
    return r, g, b, a


def compose(fg, bg):
    r1, g1, b1, a = fg
    r2, g2, b2, _ = bg
    return (r1 * a + r2 * (1 - a), g1 * a + g2 * (1 - a), b1 * a + b2 * (1 - a))


def luminanza(rgb):
    def canale(c):
        c = c / 255
        return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (canale(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def rapporto(fg_val, bg_val):
    bg = parse_colore(bg_val)
    if bg[3] < 1.0:
        raise ValueError(f"Lo sfondo {bg_val!r} deve essere opaco: componilo prima sul colore sottostante")
    fg = compose(parse_colore(fg_val), bg)
    l1, l2 = luminanza(fg), luminanza(bg[:3])
    chiaro, scuro = max(l1, l2), min(l1, l2)
    return (chiaro + 0.05) / (scuro + 0.05)


def ricava_uso(coppia):
    if "uso" in coppia:
        return coppia["uso"]
    if "size_px" in coppia:
        size = float(coppia["size_px"])
        bold = bool(coppia.get("bold", False))
        return "testo-grande" if size >= 24 or (bold and size >= 18.66) else "testo"
    return "testo"


def valuta(coppia):
    uso = ricava_uso(coppia)
    if uso not in SOGLIE_AA:
        raise ValueError(f"Uso non valido: {uso!r} (ammessi: {', '.join(SOGLIE_AA)})")
    r = rapporto(coppia["fg"], coppia["bg"])
    soglia, aaa = SOGLIE_AA[uso], SOGLIE_AAA[uso]
    if uso == "decorativo":
        esito, passa = "— (decorativo)", True
    else:
        passa = r >= soglia
        esito = "✅ AA" if passa else "❌ FALLISCE AA (serve {s}:1)"
        if passa and aaa and r >= aaa:
            esito = "✅ AAA"
    return {"nome": coppia.get("nome", f"{coppia['fg']} su {coppia['bg']}"), "fg": coppia["fg"],
            "bg": coppia["bg"], "uso": uso, "rapporto": r, "soglia": soglia, "esito": esito, "passa": passa}


def fmt(n, sep):
    return f"{n:.2f}".replace(".", sep)


def main():
    parser = argparse.ArgumentParser(description="Verifica contrasto WCAG 2.2 AA (gate G3).")
    parser.add_argument("fg", nargs="?", help="Colore primo piano (testo/elemento)")
    parser.add_argument("bg", nargs="?", help="Colore di sfondo")
    parser.add_argument("--uso", choices=list(SOGLIE_AA), help="Uso della coppia singola (default: testo)")
    parser.add_argument("--palette", help="File JSON con le coppie da verificare")
    parser.add_argument("--modo", choices=["progetto", "audit"], default="progetto")
    parser.add_argument("--decimali", choices=list(DEC), default="virgola")
    args = parser.parse_args()
    sep = DEC[args.decimali]

    if args.palette:
        try:
            with open(args.palette, encoding="utf-8") as f:
                dati = json.load(f)
        except FileNotFoundError:
            print(f"❌ File non trovato: {args.palette}")
            sys.exit(2)
        except json.JSONDecodeError as exc:
            print(f"❌ JSON non valido in {args.palette}: {exc}")
            sys.exit(2)
        coppie = dati.get("coppie") if isinstance(dati, dict) else None
        if not isinstance(coppie, list) or not coppie:
            print("❌ Il file deve essere un oggetto con la chiave 'coppie' e almeno una coppia.")
            sys.exit(2)
    elif args.fg and args.bg:
        coppie = [{"fg": args.fg, "bg": args.bg, "uso": args.uso or "testo"}]
    else:
        parser.print_help()
        sys.exit(2)

    try:
        risultati = [valuta(c) for c in coppie]
    except (ValueError, KeyError, TypeError) as exc:
        print(f"❌ Errore nei dati: {exc}")
        sys.exit(2)

    print("| Coppia | Primo piano | Sfondo | Uso | Rapporto | Esito |")
    print("|---|---|---|---|---|---|")
    for r in risultati:
        esito = r["esito"].format(s=fmt(r["soglia"], sep)[:-1] if r["soglia"] else "")
        print(f"| {r['nome']} | `{r['fg']}` | `{r['bg']}` | {r['uso']} | {fmt(r['rapporto'], sep)}:1 | {esito} |")

    falliti = [r for r in risultati if not r["passa"]]
    decorativi = [r for r in risultati if r["uso"] == "decorativo"]
    print()
    if decorativi:
        print(f"⚠️ {len(decorativi)} coppie escluse come 'decorativo' ("
              + ", ".join(r["nome"] for r in decorativi)
              + "): ammesso solo per elementi senza testo né funzione.")
    if args.modo == "audit":
        print(f"Esito: {len(falliti)} coppie su {len(risultati)} sotto soglia AA"
              + (": " + ", ".join(r["nome"] for r in falliti) if falliti else "."))
    elif falliti:
        print(f"GATE G3: ❌ BLOCCATO — {len(falliti)} coppie sotto soglia AA: "
              + ", ".join(r["nome"] for r in falliti))
    else:
        print(f"GATE G3: ✅ SUPERATO — {len(risultati)} coppie verificate.")
    sys.exit(1 if falliti else 0)


if __name__ == "__main__":
    main()
