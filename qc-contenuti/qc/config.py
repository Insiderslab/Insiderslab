"""Lettura del .env senza dipendenze esterne.

Serve a non dover passare variabili d'ambiente a mano: su PowerShell la sintassi
`VAR=valore comando` di bash non esiste, e chiedere all'utente di ricordarsi la
differenza e' un modo per farlo sbagliare.
"""

import os
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent


def carica_env(path: Path | None = None) -> dict[str, str]:
    """Carica il .env nell'ambiente. Le variabili gia' impostate hanno precedenza.

    Formato: KEY=value per riga, righe vuote e '#' ignorate, virgolette rimosse.
    Se il file non c'e', non e' un errore: si va avanti coi default.
    """
    path = path or RADICE / ".env"
    caricate: dict[str, str] = {}
    if not path.is_file():
        return caricate

    for riga in path.read_text(encoding="utf-8").splitlines():
        riga = riga.strip()
        if not riga or riga.startswith("#") or "=" not in riga:
            continue
        chiave, _, valore = riga.partition("=")
        chiave = chiave.strip()
        valore = valore.strip().strip('"').strip("'")
        if not chiave:
            continue
        caricate[chiave] = valore
        # Una variabile passata a mano deve poter vincere sul file.
        os.environ.setdefault(chiave, valore)
    return caricate
