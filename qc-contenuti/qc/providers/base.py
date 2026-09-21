"""Contratto che ogni fornitore deve rispettare."""

from typing import Mapping, Protocol

from qc.schema import Answer, Question


class Provider(Protocol):
    name: str

    def evaluate(
        self, state: Mapping[str, object], questions: Mapping[str, Question]
    ) -> Mapping[str, Answer]:
        """Valuta tutte le domande sullo stesso stato in una sola chiamata."""
        ...
