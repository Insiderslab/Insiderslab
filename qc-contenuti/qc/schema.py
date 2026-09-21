"""Schema neutro per decisioni tipizzate.

Questo modulo non sa nulla di TypeSafe, Laya o altri backend: e' il contratto
interno di InsidersLab. Cambiare fornitore deve toccare solo qc/providers/,
mai le domande (qc/questions.py) ne' la policy (qc/policy.py).
"""

from dataclasses import dataclass
from typing import Literal, Mapping, Sequence, Union


@dataclass(frozen=True)
class Choice:
    """Una tra N opzioni dichiarate. `criteria`: chiave -> cosa significa."""

    instructions: str
    criteria: Mapping[str, str]


@dataclass(frozen=True)
class Score:
    """Posizione su livelli ordinati. Ogni livello descrive una situazione concreta."""

    instructions: str
    criteria: Sequence[str]


@dataclass(frozen=True)
class Noul:
    """Affermazione si'/no. La risposta e' P(vero): non c'e' confidence separata."""

    instructions: str


Question = Union[Choice, Score, Noul]


@dataclass(frozen=True)
class Answer:
    """Risposta a una domanda.

    value:
      - Choice -> la chiave vincente (str)
      - Score  -> posizione attesa sui livelli, 0-based (float)
      - Noul   -> P(vero), 0.0-1.0 (float)
    """

    question_id: str
    kind: Literal["choice", "score", "noul"]
    value: Union[str, float]
    probabilities: Union[Mapping[str, float], None] = None
    confidence: Union[float, None] = None


def kind_of(question: Question) -> str:
    if isinstance(question, Choice):
        return "choice"
    if isinstance(question, Score):
        return "score"
    if isinstance(question, Noul):
        return "noul"
    raise TypeError(f"tipo di domanda non gestito: {type(question)!r}")
