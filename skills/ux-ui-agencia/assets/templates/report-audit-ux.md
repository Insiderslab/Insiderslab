# Audit UX/UI — [Prodotto / Cliente]

**URL o build verificata:** ___ (ambiente: produzione / staging / prototipo)
**Data del controllo:** AAAA-MM-GG
**Dispositivi e viewport testati:** mobile 375/390 · tablet 768 · desktop 1440 (adatta) —
emulati / dispositivo reale: ___
**Dati di performance:** campo (CrUX) / laboratorio (Lighthouse) — dichiarare quale
**Profili usati nel percorso dei task:** ___
**Utente di riferimento:** ___ (chi è, cosa vuole ottenere, contesto d'uso)
**Task critici verificati:** 1. ___ 2. ___ 3. ___
**Fonti:** ___ (brief, analytics, call, ticket assistenza, recensioni)
**Revisore:** ___

---

## 1. Verdetto

**Punteggio complessivo:** __ / 100 (calcolato dai rilievi: `references/audit-euristiche.md § 6`; verdetto = prima riga vera della tabella)
**Verdetto:** `SOLIDO` · `DA MIGLIORARE` · `CRITICO`

In tre righe, per chi non legge oltre:
1. ___
2. ___
3. ___

## 2. Le 5 correzioni da fare per prime

| # | Rilievo | Perché conta per il business | Severità | Sforzo | Chi |
|---|---|---|---|---|---|
| 1 | ___ | ___ | 4 | S | ___ |

Ordine: prima i quick win (severità ≥ 3, sforzo S), poi severità decrescente, a parità
di severità lo sforzo minore.

## 3. Punteggio per euristica

| Euristica | Voto 0-4 (o n/a) | Rilievi che lo determinano |
|---|---|---|
| N1 Visibilità dello stato del sistema | | |
| N2 Corrispondenza col mondo reale | | |
| N3 Controllo e libertà | | |
| N4 Coerenza e standard | | |
| N5 Prevenzione degli errori | | |
| N6 Riconoscere invece di ricordare | | |
| N7 Flessibilità ed efficienza | | |
| N8 Design estetico e minimalista | | |
| N9 Riconoscere, diagnosticare e recuperare dagli errori | | |
| N10 Aiuto e documentazione | | |
| **Totale** | __ / __ → __ / 100 | |

Problemi sistemici (una causa, tanti sintomi): ___

## 3bis. Copertura per area

| Area | Rilievi (n, severità max) | Nota |
|---|---|---|
| Chiarezza e proposta di valore | | |
| Navigazione e architettura | | |
| Flussi e task critici | | |
| Form e input | | |
| Feedback, stati ed errori | | |
| Gerarchia visiva e design system | | |
| Mobile e touch | | |
| Accessibilità (WCAG 2.2 AA) | | |
| Performance percepita | | |
| Contenuti e microcopy | | |
| Fiducia e conversione | | |

## 4. Tutti i rilievi

| Cod. | Dove (pagina · componente · viewport) | Cosa succede | Principio violato | Evidenza | Severità 0-4 | Correzione proposta | Sforzo S/M/L |
|---|---|---|---|---|---|---|---|
| UX-01 | ___ | ___ | N_ / WCAG _._._ / legge | screenshot / selettore / misura | _ | ___ | _ |

Severità: 0 non è un problema · 1 cosmetico · 2 minore · 3 maggiore · 4 bloccante.

## 5. Accessibilità — esito dei controlli principali

Per un controllo completo usare `report-accessibilita.md` (modalità ACCESSIBILITÀ).

| Criterio WCAG 2.2 | Esito | Dove | Nota |
|---|---|---|---|
| 1.4.3 Contrasto testo | ✅ / ❌ | | output di `scripts/contrast_check.py` |
| 2.1.1 Tastiera | | | |
| 2.4.7 / 2.4.11 Focus visibile e non interamente coperto | | | |
| 2.5.8 Dimensione target ≥ 24px (con eccezioni) | | | |
| 1.1.1 Testo alternativo | | | |
| 3.3.1 / 3.3.2 Errori ed etichette dei form | | | |
| 1.4.10 Reflow a 320px | | | |

## 6. Cosa funziona già (da non rompere)

- ___

## 7. Non verificato

| Cosa | Perché | Come verificarlo |
|---|---|---|
| ___ | ___ | ___ |

## 8. Domande aperte al cliente

1. ___ (rispondibile con una frase)
