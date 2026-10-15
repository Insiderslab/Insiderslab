# Approve by Heili — piano di prodotto (15/10/2026)

Scritto da Claude come product manager. Da rivedere con Stefano; le decisioni aperte sono in fondo.

## Dove siamo

Il prodotto è **ricco di funzioni e stabile tecnicamente**: post social con programmazione Metricool, articoli,
creatività ads (anche Google Ads), piano del mese con Griglia e Sfoglia, Heili (testo e voce, ora pulsante
galleggiante su tutte le pagine del portale), importazione da Excel, collegamento AI via MCP, link cliente via
WhatsApp/QR. Oltre 1000 test automatici e 58 test end-to-end.

Il rischio principale **non è tecnico ma di adozione**: abbiamo costruito molto e provato poco con clienti veri.
Le prossime due settimane devono servire a mettere il prodotto davanti a 3–5 clienti reali e a misurare.

## Priorità

### P0 — subito (questa settimana)
1. **Ruotare la chiave `TYPESAFE_API_KEY`** (finita in un ramo pubblico) e cancellare il ramo `kimi/notte-2026-10-12`.
2. **Rendere privato il repository GitHub** `Insiderslab/Insiderslab`. È pubblico: contiene il codice del prodotto,
   documenti interni, nomi di clienti nelle schermate e la storia di un segreto. Va fatto dalle impostazioni del
   repository (Settings → General → Danger Zone → Change visibility). Le sessioni Claude continuano a funzionare.
3. **Controlli automatici su GitHub (CI)** a ogni push: tipi, lint, test, e blocco di file `.env` e simili.
   Con quattro AI che scrivono codice (Claude, Codex, Kimi, DeepSeek) è la rete di sicurezza indispensabile.
4. **Pilota con 3 clienti veri** (consiglio: uno con piano mensile social, uno con articoli, uno con ads).
   Obiettivo: un mese di contenuti approvati interamente dal portale.

### P1 — prossime 2 settimane
5. **Misure del pilota** in una pagina «Andamento» della dashboard (i dati ci sono già negli eventi):
   - tempo medio dall'invio all'approvazione;
   - numero di giri di modifiche per contenuto;
   - percentuale di clienti che usano Heili, e quanti usano la voce;
   - contenuti approvati in Sfoglia rispetto a quelli approvati dalla pagina del post;
   - errori di programmazione Metricool.
6. **Un'unica email riepilogativa** quando il cliente approva un mese, invece di una per post. Stesso
   trattamento per «Programmato»: un'email per piano.
7. **Login Auth0 per l'MCP**: lo configura Stefano, seguendo la guida. Così Claude e ChatGPT si collegano
   ad Approve con il proprio account.
8. **Revisione dei siti web, Fase 1**: istantanee e revisione cliente (progetto in `docs/SITO-WEB.md`, circa 2
   settimane). Da avviare solo dopo il pilota, a meno che un cliente lo chieda subito.

### P2 — dopo il pilota
9. Revisione dei siti, Fase 2 (la riga di codice «Sul sito»).
10. Heili guida a voce, che porta il cliente alle pagine (`docs/HEILI-GUIDA-VOCALE.md`).
11. «Togli dal piano» e risposta dell'agenzia al commento sul piano.
12. Se si pensa di vendere Approve ad altre agenzie: prezzi, workspace separati, fatturazione.
    Oggi è pensato per un'agenzia sola.

## Decisioni aperte (servono a Stefano)

| # | Decisione | Consiglio |
|---|---|---|
| D1 | Pulsante principale nella pagina del post (QA-09): oggi «Chiedi modifiche», in Sfoglia «Approva» | **Dipende dal contesto**: «Approva» principale finché il cliente non ha scritto commenti; appena ce n'è uno, il principale diventa «Invia le modifiche». Coerente con Sfoglia e guida il cliente. |
| D2 | «Annulla» dopo l'approvazione a un tocco in Sfoglia (QA-29) | **Sì, 10 secondi**: l'approvazione viene registrata subito, ma la programmazione su Metricool parte dopo 15 secondi. Così «Annulla» è sicuro. |
| D3 | Repository pubblico o privato | **Privato**, subito. |
| D4 | Clienti del pilota | Sceglierne 3 che rispondono bene e hanno un volume regolare. |
| D5 | Revisione siti: quando | Dopo il pilota, salvo richieste concrete. |
| D6 | Server: le istantanee dei siti richiedono circa 1,5 GB di RAM in più | Da verificare con Hostinger prima della Fase 1 dei siti. |
