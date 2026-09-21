"""Il .env deve caricarsi uguale su Windows, macOS e Linux."""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qc.config import carica_env  # noqa: E402


def scrivi(tmp_path: Path, contenuto: str) -> Path:
    percorso = tmp_path / ".env"
    percorso.write_text(contenuto, encoding="utf-8")
    return percorso


def test_legge_le_coppie(tmp_path, monkeypatch):
    monkeypatch.delenv("QC_PROVIDER", raising=False)
    env = scrivi(tmp_path, "QC_PROVIDER=typesafe\nTYPESAFE_MODEL=jev-1.13.0\n")
    assert carica_env(env)["QC_PROVIDER"] == "typesafe"
    assert os.environ["QC_PROVIDER"] == "typesafe"


def test_ignora_commenti_e_righe_vuote(tmp_path):
    env = scrivi(tmp_path, "# commento\n\n  \nCHIAVE=valore\n")
    assert carica_env(env) == {"CHIAVE": "valore"}


def test_toglie_le_virgolette(tmp_path):
    env = scrivi(tmp_path, 'A="con virgolette"\nB=\'singole\'\n')
    caricate = carica_env(env)
    assert caricate["A"] == "con virgolette"
    assert caricate["B"] == "singole"


def test_variabile_gia_impostata_vince(tmp_path, monkeypatch):
    monkeypatch.setenv("QC_PROVIDER", "fake")
    env = scrivi(tmp_path, "QC_PROVIDER=typesafe\n")
    carica_env(env)
    assert os.environ["QC_PROVIDER"] == "fake"


def test_env_mancante_non_e_un_errore(tmp_path):
    assert carica_env(tmp_path / "non-esiste") == {}


def test_valore_con_uguale_dentro(tmp_path):
    """Una chiave API puo' contenere '='."""
    env = scrivi(tmp_path, "TYPESAFE_API_KEY=abc=def==\n")
    assert carica_env(env)["TYPESAFE_API_KEY"] == "abc=def=="
