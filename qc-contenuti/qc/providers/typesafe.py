"""Adapter TypeSafe (modello Jev, System One).

ATTENZIONE - contratto NON verificato sui doc ufficiali.
`docs.typesafe.ai` e `api.typesafe.ai` erano irraggiungibili dall'ambiente in cui
questo file e' stato scritto (bloccati dal proxy di rete). La forma di richiesta e
risposta qui sotto viene da materiale di terze parti, non dalla documentazione
ufficiale, e va confermata al primo run reale.

Per questo TUTTA la mappatura specifica del fornitore sta in questo unico file:
se qualcosa non torna, si corregge qui e nient'altro cambia.

Riferimento atteso:
  POST https://api.typesafe.ai/v1/systemone
  body: {"model": ..., "state": {...}, "questions": {id: {type, instructions, criteria}}}
"""

import json
import os
import urllib.error
import urllib.request
from typing import Mapping

from qc.schema import Answer, Choice, Noul, Question, Score, kind_of

# Pinnare la versione, non 'jev-latest': le soglie tarate valgono per UNA versione.
DEFAULT_MODEL = "jev-1.13.0"
DEFAULT_ENDPOINT = "https://api.typesafe.ai/v1/systemone"


class TypeSafeError(RuntimeError):
    pass


class TypeSafeProvider:
    name = "typesafe"

    def __init__(self, api_key: str = "", model: str = "", endpoint: str = "", timeout: int = 30):
        self.api_key = api_key or os.getenv("TYPESAFE_API_KEY", "")
        if not self.api_key:
            raise TypeSafeError(
                "TYPESAFE_API_KEY non impostata. Mettila nel .env locale, "
                "mai nel repository."
            )
        self.model = model or os.getenv("TYPESAFE_MODEL", DEFAULT_MODEL)
        self.endpoint = endpoint or os.getenv("TYPESAFE_ENDPOINT", DEFAULT_ENDPOINT)
        self.timeout = timeout

    # --- serializzazione: schema interno -> corpo richiesta -------------------

    @staticmethod
    def _serialize(question: Question) -> dict:
        if isinstance(question, Choice):
            return {
                "type": "choice",
                "instructions": question.instructions,
                "criteria": dict(question.criteria),
            }
        if isinstance(question, Score):
            return {
                "type": "score",
                "instructions": question.instructions,
                "criteria": list(question.criteria),
            }
        if isinstance(question, Noul):
            return {"type": "noul", "instructions": question.instructions}
        raise TypeError(f"tipo non gestito: {type(question)!r}")

    # --- deserializzazione: risposta -> schema interno -----------------------

    @staticmethod
    def _parse(qid: str, question: Question, raw: Mapping) -> Answer:
        kind = kind_of(question)
        if kind == "choice":
            # la chiave del risultato e' 'choice' nel materiale consultato,
            # con fallback difensivi finche' il contratto non e' confermato.
            value = raw.get("choice", raw.get("value", raw.get("answer")))
        elif kind == "score":
            value = raw.get("score", raw.get("value"))
        else:
            value = raw.get("noul", raw.get("probability", raw.get("value")))

        if value is None:
            raise TypeSafeError(
                f"risposta per {qid!r} senza valore riconoscibile; "
                f"chiavi ricevute: {sorted(raw)}. Correggi _parse() in questo file."
            )

        return Answer(
            question_id=qid,
            kind=kind,
            value=value if kind == "choice" else float(value),
            probabilities=raw.get("probabilities"),
            confidence=raw.get("confidence"),
        )

    # --- chiamata ------------------------------------------------------------

    def evaluate(
        self, state: Mapping[str, object], questions: Mapping[str, Question]
    ) -> Mapping[str, Answer]:
        body = {
            "model": self.model,
            "state": dict(state),
            "questions": {qid: self._serialize(q) for qid, q in questions.items()},
        }
        request = urllib.request.Request(
            self.endpoint,
            data=json.dumps(body).encode("utf-8"),
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", "replace")[:500]
            raise TypeSafeError(f"HTTP {exc.code} da TypeSafe: {detail}") from exc
        except urllib.error.URLError as exc:
            raise TypeSafeError(f"rete non raggiungibile: {exc.reason}") from exc

        answers = payload.get("answers")
        if not isinstance(answers, dict):
            raise TypeSafeError(
                f"risposta senza campo 'answers'; chiavi ricevute: {sorted(payload)}. "
                "Correggi evaluate() in questo file."
            )
        return {
            qid: self._parse(qid, question, answers[qid])
            for qid, question in questions.items()
            if qid in answers
        }
