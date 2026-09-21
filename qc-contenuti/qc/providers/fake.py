"""Fornitore finto, deterministico, senza rete.

Serve a far girare test e pipeline mentre la chiave TypeSafe non c'e' o l'API non
e' raggiungibile. Le risposte sono pseudocasuali ma stabili (stesso input ->
stesso output), cosi' i test sono riproducibili.

NON usare per valutare la qualita': non giudica nulla.
"""

import hashlib
from typing import Mapping

from qc.schema import Answer, Choice, Noul, Question, Score, kind_of


def _unit(*parts: str) -> float:
    """Float stabile in [0,1) dalle stringhe passate."""
    digest = hashlib.sha256("|".join(parts).encode("utf-8")).digest()
    return int.from_bytes(digest[:8], "big") / 2**64


class FakeProvider:
    name = "fake"

    def evaluate(
        self, state: Mapping[str, object], questions: Mapping[str, Question]
    ) -> Mapping[str, Answer]:
        seed = repr(sorted(state.items()))
        out = {}
        for qid, question in questions.items():
            kind = kind_of(question)
            u = _unit(seed, qid)
            if isinstance(question, Choice):
                keys = list(question.criteria)
                winner = keys[int(u * len(keys))]
                probabilities = {k: (1 - u) / len(keys) for k in keys}
                probabilities[winner] = 1 - sum(
                    v for k, v in probabilities.items() if k != winner
                )
                out[qid] = Answer(qid, kind, winner, probabilities, confidence=u)
            elif isinstance(question, Score):
                out[qid] = Answer(
                    qid, kind, u * (len(question.criteria) - 1), confidence=u
                )
            elif isinstance(question, Noul):
                out[qid] = Answer(qid, kind, u)
        return out
