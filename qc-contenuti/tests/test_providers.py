"""Il fornitore finto deve essere deterministico, o i test non valgono nulla."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest  # noqa: E402

from qc.providers import get_provider  # noqa: E402
from qc.providers.fake import FakeProvider  # noqa: E402
from qc.questions import QUESTION_SETS  # noqa: E402
from qc.schema import Choice, Noul, Score  # noqa: E402

STATO = {"caption": "Testo di prova", "brand": {"nome": "X"}}


def test_fake_e_deterministico():
    a = FakeProvider().evaluate(STATO, QUESTION_SETS["en"])
    b = FakeProvider().evaluate(STATO, QUESTION_SETS["en"])
    assert {k: v.value for k, v in a.items()} == {k: v.value for k, v in b.items()}


def test_fake_risponde_a_tutte_le_domande():
    domande = QUESTION_SETS["en"]
    risposte = FakeProvider().evaluate(STATO, domande)
    assert set(risposte) == set(domande)


def test_tipi_e_intervalli_coerenti():
    domande = QUESTION_SETS["en"]
    for qid, risposta in FakeProvider().evaluate(STATO, domande).items():
        domanda = domande[qid]
        if isinstance(domanda, Noul):
            assert 0.0 <= risposta.value <= 1.0
        elif isinstance(domanda, Score):
            assert 0.0 <= risposta.value <= len(domanda.criteria) - 1
        elif isinstance(domanda, Choice):
            assert risposta.value in domanda.criteria


def test_i_due_set_di_domande_hanno_le_stesse_chiavi():
    assert set(QUESTION_SETS["en"]) == set(QUESTION_SETS["it"])


def test_fornitore_sconosciuto_fallisce_subito():
    with pytest.raises(ValueError):
        get_provider("inesistente")


def test_typesafe_senza_chiave_fallisce_con_messaggio_chiaro(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    from qc.providers.typesafe import TypeSafeError, TypeSafeProvider

    with pytest.raises(TypeSafeError, match="TYPESAFE_API_KEY"):
        TypeSafeProvider()
