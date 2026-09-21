"""La policy e' la parte che decide: va testata senza rete e senza modello."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from qc.policy import Decision, Thresholds, decide  # noqa: E402
from qc.schema import Answer  # noqa: E402


def noul(qid: str, p: float) -> Answer:
    return Answer(qid, "noul", p)


def score(qid: str, v: float) -> Answer:
    return Answer(qid, "score", v)


def test_caption_pulita_passa():
    risposte = {
        "claim_sanitario": noul("claim_sanitario", 0.01),
        "claim_garantito": noul("claim_garantito", 0.02),
        "tono_brand": score("tono_brand", 3.0),
    }
    assert decide(risposte).decision is Decision.PASS


def test_claim_sanitario_blocca():
    risposte = {"claim_sanitario": noul("claim_sanitario", 0.9)}
    verdetto = decide(risposte)
    assert verdetto.decision is Decision.BLOCK
    assert "claim_sanitario" in verdetto.reasons[0]


def test_zona_grigia_va_in_revisione():
    risposte = {"claim_sanitario": noul("claim_sanitario", 0.3)}
    assert decide(risposte).decision is Decision.REVIEW


def test_rischio_grave_non_si_compensa_con_tono_ottimo():
    """Il punto della policy: niente media pesata."""
    risposte = {
        "claim_sanitario": noul("claim_sanitario", 0.95),
        "tono_brand": score("tono_brand", 3.0),
        "prezzo_esplicito": noul("prezzo_esplicito", 0.0),
    }
    assert decide(risposte).decision is Decision.BLOCK


def test_segnale_morbido_non_blocca():
    risposte = {"prezzo_esplicito": noul("prezzo_esplicito", 0.99)}
    assert decide(risposte).decision is Decision.REVIEW


def test_tono_scarso_manda_in_revisione():
    risposte = {"tono_brand": score("tono_brand", 0.5)}
    assert decide(risposte).decision is Decision.REVIEW


def test_domande_mancanti_non_rompono():
    assert decide({}).decision is Decision.PASS


def test_soglie_personalizzate():
    severe = Thresholds(blocco={"prezzo_esplicito": 0.5}, revisione_rischio={}, revisione_segnale={})
    risposte = {"prezzo_esplicito": noul("prezzo_esplicito", 0.8)}
    assert decide(risposte, severe).decision is Decision.BLOCK
