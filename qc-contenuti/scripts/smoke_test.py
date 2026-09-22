#!/usr/bin/env python3
"""Una sola chiamata all'API, con la risposta grezza stampata cosi' com'e'.

Serve quando run_eval.py sembra bloccato o fallisce su tutte le righe: qui si
vede subito se il problema e' la rete, la chiave, o la forma della risposta.

    python scripts/smoke_test.py
    python scripts/smoke_test.py --timeout 10

Non stampa mai la chiave API.
"""

import argparse
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qc.config import carica_env  # noqa: E402
from qc.providers.typesafe import DEFAULT_ENDPOINT, DEFAULT_MODEL  # noqa: E402

CORPO = {
    "state": {"caption": "Risultati garantiti in 30 giorni o ti rimborsiamo."},
    "questions": {
        "claim_garantito": {
            "type": "noul",
            "instructions": (
                "Does the caption promise a guaranteed or certain outcome?"
            ),
        },
        "categoria": {
            "type": "choice",
            "instructions": "What is the main purpose of this caption?",
            "criteria": {
                "promo": "Pushes an offer or product.",
                "educativo": "Explains or informs.",
                "altro": "Neither of the above.",
            },
        },
    },
}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=int, default=20)
    args = parser.parse_args()

    carica_env()
    chiave = os.getenv("TYPESAFE_API_KEY", "")
    endpoint = os.getenv("TYPESAFE_ENDPOINT", DEFAULT_ENDPOINT)
    modello = os.getenv("TYPESAFE_MODEL", DEFAULT_MODEL)

    print("=" * 70)
    print(f"  endpoint : {endpoint}")
    print(f"  modello  : {modello}")
    print(f"  chiave   : {'presente (' + str(len(chiave)) + ' caratteri)' if chiave else 'ASSENTE'}")
    print(f"  timeout  : {args.timeout}s")
    print("=" * 70)

    if not chiave:
        print("\nTYPESAFE_API_KEY non trovata nel .env. Niente da provare.")
        return 1

    host = urllib.parse.urlparse(endpoint).hostname or ""
    print(f"\n1. Risoluzione DNS di {host} ...", end=" ", flush=True)
    try:
        indirizzo = socket.gethostbyname(host)
        print(f"ok -> {indirizzo}")
    except socket.gaierror as exc:
        print(f"FALLITA: {exc}")
        print("\n   Il nome non si risolve: rete, DNS o firewall. "
              "L'API non e' raggiungibile da questa macchina.")
        return 1

    corpo = dict(CORPO, model=modello)
    richiesta = urllib.request.Request(
        endpoint,
        data=json.dumps(corpo).encode("utf-8"),
        headers={"Authorization": f"Bearer {chiave}",
                 "Content-Type": "application/json"},
        method="POST",
    )

    print(f"2. POST in corso (max {args.timeout}s) ...", end=" ", flush=True)
    inizio = time.monotonic()
    try:
        with urllib.request.urlopen(richiesta, timeout=args.timeout) as risposta:
            grezzo = risposta.read().decode("utf-8")
            stato = risposta.status
    except urllib.error.HTTPError as exc:
        durata = time.monotonic() - inizio
        corpo_errore = exc.read().decode("utf-8", "replace")
        print(f"HTTP {exc.code} dopo {durata:.1f}s\n")
        print("--- corpo della risposta ---")
        print(corpo_errore[:2000])
        print("\n   401/403 -> chiave sbagliata o non attiva")
        print("   404     -> endpoint diverso da quello atteso")
        print("   400/422 -> il corpo della richiesta ha una forma diversa")
        return 1
    except urllib.error.URLError as exc:
        durata = time.monotonic() - inizio
        print(f"FALLITA dopo {durata:.1f}s: {exc.reason}")
        print("\n   Connessione impossibile: proxy aziendale, firewall o TLS.")
        return 1
    except TimeoutError:
        print(f"TIMEOUT dopo {args.timeout}s")
        print("\n   Il server non ha risposto. Riprova con --timeout 60.")
        return 1

    durata = time.monotonic() - inizio
    print(f"HTTP {stato} in {durata:.2f}s\n")
    print("--- RISPOSTA GREZZA (incollala nella chat) ---")
    try:
        print(json.dumps(json.loads(grezzo), indent=2, ensure_ascii=False)[:4000])
    except json.JSONDecodeError:
        print(grezzo[:4000])
    print("--- fine risposta ---")
    print("\nSe l'adapter va corretto, serve esattamente questo blocco.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
