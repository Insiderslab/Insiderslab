"""Il convertitore deve rifiutare i fogli sbagliati PRIMA di scrivere."""

import json
import subprocess
import sys
from pathlib import Path

RADICE = Path(__file__).resolve().parent.parent
SCRIPT = RADICE / "scripts" / "csv_to_jsonl.py"

INTESTAZIONE = (
    "id,cliente,brand_nome,brand_tono_di_voce,caption,claim_garantito,"
    "claim_sanitario,dato_non_verificabile,urgenza_ingannevole,prezzo_esplicito,"
    "nomina_competitor,tono_brand,categoria,verdetto_umano,note\n"
)
RIGA_OK = "A1,cli,Brand,Voce,Testo,no,no,no,no,no,no,3,promo,pass,\n"


def esegui(tmp_path: Path, csv: str):
    sorgente = tmp_path / "e.csv"
    sorgente.write_text(csv, encoding="utf-8")
    uscita = tmp_path / "out.jsonl"
    p = subprocess.run(
        [sys.executable, str(SCRIPT), str(sorgente), str(uscita)],
        capture_output=True, text=True,
    )
    return p, uscita


def test_riga_valida_produce_jsonl(tmp_path):
    p, uscita = esegui(tmp_path, INTESTAZIONE + RIGA_OK)
    assert p.returncode == 0, p.stderr
    voce = json.loads(uscita.read_text(encoding="utf-8").strip())
    assert voce["id"] == "A1"
    assert voce["etichette"]["tono_brand"] == 3
    assert voce["etichette"]["claim_sanitario"] is False


def test_accetta_le_varianti_di_si_e_no(tmp_path):
    riga = "A1,cli,B,V,Testo,SI,x,1,true,,no,0,promo,block,\n"
    p, uscita = esegui(tmp_path, INTESTAZIONE + riga)
    assert p.returncode == 0, p.stderr
    et = json.loads(uscita.read_text(encoding="utf-8").strip())["etichette"]
    assert [et["claim_garantito"], et["claim_sanitario"],
            et["dato_non_verificabile"], et["urgenza_ingannevole"],
            et["prezzo_esplicito"]] == [True, True, True, True, False]


def test_tono_fuori_scala_blocca_tutto(tmp_path):
    p, uscita = esegui(tmp_path, INTESTAZIONE + RIGA_OK.replace(",3,promo", ",7,promo"))
    assert p.returncode == 1
    assert "tono_brand" in p.stderr
    assert not uscita.exists(), "non deve scrivere un file a meta'"


def test_categoria_inventata_viene_rifiutata(tmp_path):
    p, _ = esegui(tmp_path, INTESTAZIONE + RIGA_OK.replace(",promo,", ",marketing,"))
    assert p.returncode == 1
    assert "categoria" in p.stderr


def test_id_duplicato_viene_segnalato(tmp_path):
    p, _ = esegui(tmp_path, INTESTAZIONE + RIGA_OK + RIGA_OK)
    assert p.returncode == 1
    assert "duplicato" in p.stderr


def test_colonne_mancanti_dicono_quali(tmp_path):
    p, _ = esegui(tmp_path, "id,caption\nA1,Testo\n")
    assert p.returncode != 0
    assert "claim_sanitario" in (p.stderr + p.stdout)


def test_segnala_tutte_le_righe_sbagliate_non_solo_la_prima(tmp_path):
    cattive = (RIGA_OK.replace("A1", "A1").replace(",3,promo", ",9,promo")
               + RIGA_OK.replace("A1", "A2").replace(",promo,", ",inventata,"))
    p, _ = esegui(tmp_path, INTESTAZIONE + cattive)
    assert p.returncode == 1
    assert "tono_brand" in p.stderr and "categoria" in p.stderr


def test_il_dataset_sintetico_e_valido_e_completo():
    """Il dataset sintetico deve restare convertibile e coprire ogni domanda."""
    import json as _json

    percorso = RADICE / "data" / "captions.sintetiche.jsonl"
    righe = [_json.loads(r) for r in
             percorso.read_text(encoding="utf-8").splitlines() if r.strip()]
    assert len(righe) >= 50

    booleane = ["claim_garantito", "claim_sanitario", "dato_non_verificabile",
                "urgenza_ingannevole", "prezzo_esplicito", "nomina_competitor"]
    for colonna in booleane:
        positivi = sum(1 for r in righe if r["etichette"][colonna])
        assert positivi >= 5, f"{colonna}: solo {positivi} positivi, soglia non stimabile"

    for verdetto in ("pass", "review", "block"):
        assert any(r["verdetto_umano"] == verdetto for r in righe)

    assert all(r["brand"]["tono_di_voce"] for r in righe), "tono_di_voce sempre presente"
