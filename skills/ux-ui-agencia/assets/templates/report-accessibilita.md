# Verifica accessibilità WCAG 2.2 AA — [Prodotto / Cliente]

**Oggetto verificato:** ___ (prodotto vivo / staging / non vivo: ___)
**Data:** AAAA-MM-GG · **Revisore:** ___
**Pagine e flussi verificati:** ___ (i task critici, più pagine trasversali)
**Strumenti:** axe / Lighthouse · tastiera · screen reader ___ · zoom 200% e 320px ·
`scripts/contrast_check.py` · dispositivo mobile ___
**Perimetro EAA (orientamento, da verificare con il consulente legale):** ___

---

## 1. Verdetto

`CONFORME AA` · `NON CONFORME AA (n criteri ❌)` · `NON VALUTABILE` (motivo: ___)

In tre righe:
1. ___
2. ___
3. ___

## 2. Esito per criterio

| Criterio | Livello | Esito ✅ / ❌ / non verificato | Dove | Evidenza | Severità |
|---|---|---|---|---|---|
| 1.1.1 Contenuti non testuali | A | | | | |
| 1.3.1 Info e relazioni | A | | | | |
| 1.3.4 Orientamento | AA | | | | |
| 1.3.5 Scopo dell'input | AA | | | | |
| 1.4.1 Uso del colore | A | | | | |
| 1.4.3 Contrasto minimo | AA | | | tabella dello script (§3) | |
| 1.4.4 Ridimensionamento testo | AA | | | | |
| 1.4.10 Reflow | AA | | | | |
| 1.4.11 Contrasto non testuale | AA | | | | |
| 1.4.12 Spaziatura testo | AA | | | | |
| 1.4.13 Contenuto su hover/focus | AA | | | | |
| 2.1.1 Tastiera | A | | | | |
| 2.1.2 Nessuna trappola | A | | | | |
| 2.2.2 Pausa, stop, nascondi | A | | | | |
| 2.3.1 Tre lampeggiamenti | A | | | | |
| 2.4.1 Salto blocchi | A | | | | |
| 2.4.3 Ordine del focus | A | | | | |
| 2.4.4 Scopo del link (nel contesto) | A | | | | |
| 2.4.7 Focus visibile | AA | | | | |
| 2.4.11 Focus non coperto (interamente) | AA | | | | |
| 2.5.7 Movimenti di trascinamento | AA | | | | |
| 2.5.8 Dimensione target | AA | | | | |
| 3.1.1 Lingua della pagina | A | | | | |
| 3.2.2 All'input | A | | | | |
| 3.2.6 Aiuto coerente | A | | | | |
| 3.3.1 Identificazione errori | A | | | | |
| 3.3.2 Etichette o istruzioni | A | | | | |
| 3.3.7 Inserimento ridondante | A | | | | |
| 3.3.8 Autenticazione accessibile | AA | | | | |
| 4.1.2 Nome, ruolo, valore | A | | | | |
| 4.1.3 Messaggi di stato | AA | | | | |

Severità (regola unica di `audit-euristiche.md § 6`): 4 se impedisce a un gruppo di utenti un
task critico, 3 se lo rende più faticoso, altrove almeno 2.
Criteri non elencati: verificati / non verificati (dichiarare quale).

## 3. Contrasti

[incollare qui l'output di `scripts/contrast_check.py --palette`]

## 4. Piano di rimedio

| Priorità | Rilievo | Criterio | Correzione | Sistemico? (token/componente) | Sforzo | Chi |
|---|---|---|---|---|---|---|
| 1 | ___ | ___ | ___ | sì / no | S/M/L | ___ |

Ordine: prima ciò che blocca un task, poi ciò che è sistemico, poi il resto.

## 5. Pagina informativa sull'accessibilità (se nel perimetro EAA)

Bozza da far validare al consulente legale prima della pubblicazione:
- Stato di conformità: ___
- Contenuti non ancora accessibili e alternative: ___
- Contatto per segnalare barriere: ___
- Data dell'ultima verifica: ___

## 6. Non verificato

| Cosa | Perché | Come verificarlo |
|---|---|---|
| ___ | ___ | ___ |
