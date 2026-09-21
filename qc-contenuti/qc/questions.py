"""Domande di QC per caption social in italiano.

Due scelte deliberate:

1. Le `instructions` e i `criteria` sono in INGLESE, lo stato resta in ITALIANO.
   Jev e' addestrato in prevalenza su inglese e non esiste una valutazione
   multilingue pubblicata: tenere la domanda in inglese riduce una variabile.
   E' un'ipotesi da verificare, non un dato: scripts/run_eval.py sa girare anche
   con le domande tradotte (--questions it) per misurare la differenza.

2. Una domanda = un giudizio stretto. Niente domande composte tipo
   "e' rischiosa o fuori tono": sono due decisioni diverse, con due soglie diverse.

Tutte le domande vengono poste sullo stesso stato in UNA chiamata (fan-out).
"""

from qc.schema import Choice, Noul, Score

QUESTIONS_EN = {
    # --- rischi duri: da soli possono bloccare la pubblicazione --------------
    "claim_garantito": Noul(
        instructions=(
            "Does the caption promise a guaranteed, certain or assured outcome "
            "to the reader, rather than describing a possible or typical result?"
        ),
    ),
    "claim_sanitario": Noul(
        instructions=(
            "Does the caption make a health, medical or therapeutic claim, for "
            "example that a product or treatment cures, heals, repairs or treats "
            "a physical condition? Purely aesthetic or cosmetic descriptions do "
            "not count."
        ),
    ),
    "dato_non_verificabile": Noul(
        instructions=(
            "Does the caption state a specific statistic, percentage or numeric "
            "result without naming a source for it?"
        ),
    ),
    # --- segnali morbidi: da soli mandano in revisione, non bloccano ---------
    "urgenza_ingannevole": Noul(
        instructions=(
            "Does the caption create urgency or scarcity without a concrete, "
            "verifiable deadline or quantity, for example 'last places' or "
            "'only for today' with nothing specific behind it?"
        ),
    ),
    "prezzo_esplicito": Noul(
        instructions=(
            "Does the caption state a specific price, discount percentage or "
            "monetary amount?"
        ),
    ),
    "nomina_competitor": Noul(
        instructions=(
            "Does the caption name or unmistakably identify a competing brand "
            "or company?"
        ),
    ),
    # --- qualita' editoriale -------------------------------------------------
    "tono_brand": Score(
        instructions=(
            "How well does the caption match the brand voice described in "
            "`brand.tono_di_voce`?"
        ),
        criteria=[
            "Clearly off-brand: wrong register, or contradicts the described voice",
            "Recognisably off: understandable but would need rewriting",
            "Acceptable: on-brand with minor wording issues",
            "Fully on-brand: could be published as written",
        ],
    ),
    "categoria": Choice(
        instructions="What is the main communicative purpose of this caption?",
        criteria={
            "promo": "Pushes a specific offer, product, price or booking.",
            "educativo": "Explains, teaches or informs about a topic.",
            "storytelling": "Tells a story about the brand, its people or values.",
            "engagement": "Mainly asks for a reaction: question, poll, invitation.",
            "altro": "None of the above clearly fits.",
        },
    ),
}

# Le stesse domande in italiano, per misurare se la lingua della domanda conta.
QUESTIONS_IT = {
    "claim_garantito": Noul(
        instructions=(
            "La caption promette al lettore un risultato garantito, certo o "
            "assicurato, invece di descrivere un risultato possibile o tipico?"
        ),
    ),
    "claim_sanitario": Noul(
        instructions=(
            "La caption fa un'affermazione sanitaria, medica o terapeutica, per "
            "esempio che un prodotto o trattamento cura, guarisce, ripara o tratta "
            "una condizione fisica? Le descrizioni puramente estetiche non contano."
        ),
    ),
    "dato_non_verificabile": Noul(
        instructions=(
            "La caption riporta una statistica, una percentuale o un risultato "
            "numerico specifico senza indicarne la fonte?"
        ),
    ),
    "urgenza_ingannevole": Noul(
        instructions=(
            "La caption crea urgenza o scarsita' senza una scadenza o una quantita' "
            "concreta e verificabile, per esempio 'ultimi posti' o 'solo per oggi' "
            "senza nulla di specifico dietro?"
        ),
    ),
    "prezzo_esplicito": Noul(
        instructions=(
            "La caption indica un prezzo specifico, una percentuale di sconto o "
            "un importo in denaro?"
        ),
    ),
    "nomina_competitor": Noul(
        instructions=(
            "La caption nomina o identifica in modo inequivocabile un marchio o "
            "un'azienda concorrente?"
        ),
    ),
    "tono_brand": Score(
        instructions=(
            "Quanto la caption corrisponde alla voce del brand descritta in "
            "`brand.tono_di_voce`?"
        ),
        criteria=[
            "Chiaramente fuori tono: registro sbagliato, o contraddice la voce descritta",
            "Riconoscibilmente fuori: comprensibile ma andrebbe riscritta",
            "Accettabile: in linea, con piccoli problemi di formulazione",
            "Pienamente in linea: pubblicabile cosi' com'e'",
        ],
    ),
    "categoria": Choice(
        instructions="Qual e' lo scopo comunicativo principale di questa caption?",
        criteria={
            "promo": "Spinge un'offerta, un prodotto, un prezzo o una prenotazione.",
            "educativo": "Spiega, insegna o informa su un argomento.",
            "storytelling": "Racconta una storia sul brand, le sue persone o i valori.",
            "engagement": "Chiede soprattutto una reazione: domanda, sondaggio, invito.",
            "altro": "Nessuna delle precedenti calza chiaramente.",
        },
    ),
}

QUESTION_SETS = {"en": QUESTIONS_EN, "it": QUESTIONS_IT}
