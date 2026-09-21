"""Selezione del fornitore: una variabile d'ambiente, nessun cambio di codice."""

import os

from qc.providers.base import Provider


def get_provider(name: str = "") -> Provider:
    name = (name or os.getenv("QC_PROVIDER", "fake")).lower()
    if name == "typesafe":
        from qc.providers.typesafe import TypeSafeProvider

        return TypeSafeProvider()
    if name == "fake":
        from qc.providers.fake import FakeProvider

        return FakeProvider()
    raise ValueError(
        f"fornitore sconosciuto: {name!r} (attesi: 'typesafe', 'fake')"
    )
