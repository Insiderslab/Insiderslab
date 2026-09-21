"""Decisione finale: PASS / REVIEW / BLOCK.

La policy sta nel codice, non nel modello. Il modello fornisce letture semantiche
(probabilita'); qui si decide cosa farne.

Scelta importante: NON si fa una media pesata dei rischi. Una regola del tipo
"qualunque violazione grave blocca" ha bisogno di condizioni separate: un claim
sanitario non si compensa con un tono di voce ottimo. La media pesata resta
adatta solo a preferenze che si compensano davvero (qui: nessuna).

Le soglie qui sotto sono PLACEHOLDER. Vanno sostituite con quelle che
scripts/run_eval.py ricava dai giudizi reali del team. Finche' non lo si e' fatto,
questo modulo non e' tarato e non va usato in produzione.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import Mapping, Sequence

from qc.schema import Answer


class Decision(str, Enum):
    PASS = "pass"
    REVIEW = "review"
    BLOCK = "block"


@dataclass(frozen=True)
class Thresholds:
    """Soglie per domanda. DA TARARE su dati reali (vedi scripts/run_eval.py)."""

    # Rischi duri: sopra questa probabilita' si blocca.
    blocco: Mapping[str, float] = field(
        default_factory=lambda: {
            "claim_sanitario": 0.5,
            "claim_garantito": 0.5,
        }
    )
    # Rischi duri: zona grigia sotto la soglia di blocco -> revisione umana.
    revisione_rischio: Mapping[str, float] = field(
        default_factory=lambda: {
            "claim_sanitario": 0.2,
            "claim_garantito": 0.2,
        }
    )
    # Segnali morbidi: sopra questa probabilita' -> revisione umana.
    revisione_segnale: Mapping[str, float] = field(
        default_factory=lambda: {
            "dato_non_verificabile": 0.5,
            "urgenza_ingannevole": 0.5,
            "prezzo_esplicito": 0.7,
            "nomina_competitor": 0.5,
        }
    )
    # Tono: sotto questa posizione sui livelli -> revisione umana.
    tono_minimo: float = 1.5


@dataclass(frozen=True)
class Verdict:
    decision: Decision
    reasons: Sequence[str]

    def __str__(self) -> str:
        return f"{self.decision.value.upper()}: " + ("; ".join(self.reasons) or "nessun rilievo")


def decide(answers: Mapping[str, Answer], thresholds: Thresholds = Thresholds()) -> Verdict:
    """Applica la policy alle risposte. Domande assenti vengono ignorate."""
    blocchi: list[str] = []
    revisioni: list[str] = []

    for qid, soglia in thresholds.blocco.items():
        answer = answers.get(qid)
        if answer is None:
            continue
        p = float(answer.value)
        if p >= soglia:
            blocchi.append(f"{qid}={p:.2f} (blocco a {soglia:.2f})")
        elif p >= thresholds.revisione_rischio.get(qid, soglia):
            revisioni.append(
                f"{qid}={p:.2f} (zona grigia da "
                f"{thresholds.revisione_rischio[qid]:.2f})"
            )

    for qid, soglia in thresholds.revisione_segnale.items():
        answer = answers.get(qid)
        if answer is None:
            continue
        p = float(answer.value)
        if p >= soglia:
            revisioni.append(f"{qid}={p:.2f} (revisione a {soglia:.2f})")

    tono = answers.get("tono_brand")
    if tono is not None and float(tono.value) < thresholds.tono_minimo:
        revisioni.append(
            f"tono_brand={float(tono.value):.2f} (minimo {thresholds.tono_minimo:.2f})"
        )

    if blocchi:
        return Verdict(Decision.BLOCK, blocchi + revisioni)
    if revisioni:
        return Verdict(Decision.REVIEW, revisioni)
    return Verdict(Decision.PASS, [])
