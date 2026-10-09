# Esiti dei test di rilascio — ux-ui-agencia v1.0 → v1.1

Data: 2026-10-09. Fixture: `evals/fixtures/checkout-difettoso.html`, un checkout
volutamente difettoso servito in locale (`python3 -m http.server`). I test su siti reali
non si sono potuti fare perché la rete dell'ambiente era limitata: vanno fatti sul primo
progetto vero.

## 1. Giudizio statico — `harness-audit` modalità SCHEDA (su v1.0)

Passata separata, senza modificare i file. Verdetto **NON CONFORME**.

| Rilievo principale | Correzione in v1.1 |
|---|---|
| G7 non robusto ("nessuna domanda necessaria" non ha un input che lo fa fallire) | Diviso in G7a deterministico (9 voci di `handoff.md § 1`) e G7b di giudizio |
| G1 contraddittorio (passa sempre, ma blocca l'AUDIT) | Limiti di ipotesi per modalità, tabella in §3 |
| G8 ammetteva percentuali inventate se marcate IPOTESI | Vietati numeri senza fonte anche come ipotesi |
| Confine con `web-factory-insiderslab` non chiaro: due produttori di design system per i siti WordPress | I siti WordPress restano a web-factory; questa skill fa piattaforme, app, audit, accessibilità, direzione visiva |
| Trigger generici ("onboarding", "dashboard", "app", "form") | Description con forme composte, trigger ES ed esclusioni |
| Errori fattuali: WCAG 2.4.11 (basta non *interamente* coperto), 2.4.4 (conta il contesto), presunzione EN 301 549, regime transitorio EAA, esempio di contrasto sbagliato | Corretti |
| H3 non permetteva di scrivere su `cliente.md`, che la procedura richiede | Riga di scrittura con approvazione |
| Riferimenti rotti, doppio significato di H1–H10 | Euristiche rinominate N1–N10, riferimenti per numero |

Da rifare: nuova SCHEDA sulla v1.1 prima del rilascio in organizzazione.

## 2. Test d'uso — modalità AUDIT sul checkout difettoso (su v1.0)

Un agente separato ha seguito la skill alla lettera, con Playwright, axe-core e lo script
di contrasto.

- Esito: **CRITICO, 35/100**, 22 rilievi (12 di severità 4, 5 di severità 3, 5 di
  severità 2), tutti con evidenza. Verdetto stabile anche con letture alternative.
- Rilievi principali trovati: invio che fallisce sempre e svuota i 19 campi; totale non
  definitivo ("spedizione e IVA dopo il pagamento"); nessuna etichetta, solo placeholder;
  contrasti sotto soglia su 10 coppie (bottone d'acquisto 1,64:1); focus invisibile su
  22 elementi su 22; focus coperto dall'header sticky a 375px; zoom bloccato; account
  obbligatorio; bottoni wallet finti.
- G2, G8 e "Non verificato" hanno funzionato: nessuna affermazione inventata sul perché
  dei carrelli abbandonati.
- Problemi della skill emersi e corretti in v1.1: regole di priorità diverse in tre file;
  regola "WCAG = severità 4" troppo larga; nessuna mappatura fissa WCAG → euristica (due
  revisori darebbero punteggi diversi); template senza contesto minimo e senza percorso
  dei task; script senza `rgb()`, senza gestione degli errori di file, con "BLOCCATO" anche
  nei report di audit; nessuno strumento per la traccia strumentale.

## 3. Replay della libreria fallimenti

| ID | Esito | Come |
|---|---|---|
| F-001 | ✅ superato | `contrast_check.py "#999999" "#FFFFFF"` → 2,85:1, exit 1 |
| F-002…F-006 | ⏳ da eseguire | con `harness-replay` sulla v1.1 |

## 4. `scripts/audit_probe.js` sulla fixture (v1.1)

Trova da solo, in un'esecuzione: focus non visibile su 22/22 elementi; focus interamente
coperto su "Nome" e "Cognome" a 375px (ritorno con Shift+Tab); `lang` assente; zoom
bloccato; 19/19 campi con solo placeholder e senza `autocomplete`; 2 cliccabili non
semantici (PayPal, Apple Pay); 3 bottoni sotto 44px su mobile; testo su gradiente da
verificare a mano; 9 coppie colore estratte, 6 sotto soglia; 3 regole axe violate.
Con `--submit-vuoto`: messaggio generico, nessun `aria-invalid`, nessuna regione live.

## 5. Ancora da fare

- Eseguire gli eval 1–10 su v1.1 (in particolare 8, attivazione negativa, e 9, pressione L3
  sul divieto di invio al cliente).
- Primo audit su un prodotto reale di un cliente e registrazione dei fallimenti con
  `harness-replay`.
