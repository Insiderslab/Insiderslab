# Approve — revisione dei percorsi del 9 ottobre 2026

## Obiettivo e metodo

La revisione parte dalle difficoltà osservate dal titolare durante l'uso: capire dove caricare, cosa il cliente vede, dove trovare il link, come commentare e quando una richiesta è davvero inviata. Un controllo dei singoli componenti non basta: bisogna seguire il percorso completo e le sue interruzioni.

Letti i contratti di prodotto, confrontate le schermate disponibili e ispezionati i percorsi correnti di agenzia, cliente, assistente e piano. Le schermate in `docs/screenshots` documentano anche versioni precedenti: le conclusioni sul comportamento attuale derivano dal codice e dai controlli della revisione, non soltanto da quelle immagini. Le verifiche automatiche usano dati sintetici e non approvano contenuti reali.

## Diagnosi

Il problema principale è la distinzione poco visibile fra **preparare**, **salvare**, **condividere** e **concludere la revisione**. La stessa richiesta poteva passare da commenti o assistente, con pulsanti finali che consideravano dati diversi. Anche un piano poteva essere scambiato per una modalità di visualizzazione dei post, quando ha una propria appartenenza e un proprio invio.

### Correzioni in questa revisione

| Percorso | Problema osservato nel codice | Comportamento corretto |
|---|---|---|
| Commento → approvazione | Una bozza aperta poteva essere abbandonata da Approva/Invia decisioni | Le decisioni chiedono di inviare o annullare il commento prima di proseguire; vale per social, blog, ads e commento generale del piano |
| Chat → riepilogo/invio | Un testo ancora nel campo non entrava nel riepilogo o nella richiesta | Blocco con spiegazione e focus sul messaggio, anche durante la dettatura |
| Assistente → pulsanti della pagina | «Chiedi modifiche» considerava solo i commenti manuali | I pulsanti passano dallo stesso controllo dell'assistente; una conversazione prima produce un riepilogo da leggere, poi il cliente lo invia |
| Chiudi → riapri Heili | Smontare il pannello perdeva testo e modifiche locali al riepilogo | Il pannello recupera lo stato anche se chiuso; chiuderlo termina la voce e conserva il lavoro nella pagina |
| Conversazione successiva | Poteva restare un vecchio riepilogo locale; limite vocale invisibile | Stato del riepilogo aggiornato e tempo residuo della chiamata visibile |
| Conferme | «Commento inviato» sembrava già una richiesta di modifica conclusa | Si distingue commento salvato/visibile dalla richiesta inviata; riepilogo marcato «Non ancora inviato» |
| Home cliente | Piano e singoli post inclusi apparivano due volte | I piani visibili raggruppano i propri post; gli altri contenuti restano separati; conteggio complessivo conservato |
| Anteprima mensile | La griglia Instagram comprendeva anche post solo Facebook/LinkedIn e prometteva il profilo completo | Solo contenuti destinati a Instagram; etichetta esplicita che si tratta dei contenuti del piano, senza il profilo esistente |
| Agenzia → piano | Calendario, elenco e griglia venivano descritti come identici; salvataggio ambiguo | Quantità e appartenenza esplicite; salvare un piano condiviso aggiorna i suoi dati ma non invia nuove bozze/email |
| Approva tutto | L'esclusione del feedback non comprendeva conversazioni e poteva diventare obsoleta durante il ciclo | Controllo del feedback della versione corrente anche nella transazione di ogni approvazione; commenti e conversazioni richiedono decisione individuale |

Questa revisione conserva le regole esistenti: l'AI propone, il cliente decide; l'approvazione resta legata alla versione; blog e ads non passano a Metricool.

## Interventi successivi, in ordine

1. **Condivisione del piano senza nuovo invio di post.** Oggi un piano mai condiviso composto soltanto da post già inviati singolarmente può restare senza azione utile: `PlanEditor` disabilita l'invio quando non ci sono bozze/modifiche da inviare, `sendPlan` rifiuta il caso e `PlanSharePanel` nasconde il link finché manca `sentAt`. Introdurre un'azione esplicita «Rendi disponibile il piano» separata da notifiche e cambi di stato. Accettazione: crea piano con due post già in revisione, condividi una volta, apri il link, ritrova entrambi e nessuna email duplicata.
2. **Accordo fra più referenti.** L'approvazione individuale può ancora prevalere sulle note di un altro referente; Questa revisione mostra nella conferma i commenti aperti di tutti i referenti e i loro nomi, ma non introduce un blocco server sulla decisione individuale. Definire e applicare una politica esplicita: avviso con conferma consapevole oppure blocco fino alla risoluzione. Non introdurre silenziosamente un nuovo requisito di unanimità. Accettazione: due referenti, nota di A, decisione di B, esito comprensibile e tracciato.
3. **Note generali del piano e richieste bloccanti.** La nota sul piano resta una nota, senza stato di risoluzione. Questa revisione aggiunge un avviso nella conferma; serve poi distinguere strutturalmente una nota informativa da una richiesta che riguarda tutto il mese, con risposta dell'agenzia.
4. **Bozze lungo la navigazione.** Conservare il testo quando si cambia punto dell'immagine, post o pagina, con recupero per post/versione e messaggio in caso di versione superata. La conservazione del testo locale aggiunta qui copre la chiusura del pannello nella stessa pagina, non refresh o navigazione. Le conversazioni già salvate sono invece recuperate anche al rientro.
5. **Link cliente nelle viste compatte.** Portare la stessa azione «Copia link cliente» anche in calendario e righe del piano, mantenendo la scelta esplicita del referente quando ce n'è più di uno.
6. **Semplificazione visiva dell'assistente.** Dopo aver unificato il comportamento, ridurre le ripetizioni fra riepilogo, messaggio modificabile e pulsanti; distinguere chiaramente dettatura e conversazione. Verificare in una breve sessione con un cliente reale che riesca a completare il primo feedback senza istruzioni verbali. Non usare il numero dei test automatici come sostituto di questa prova.

## Scenari da mantenere nella regressione

- Commenti già salvati → Chiedi modifiche: invio diretto, nessuna seconda textarea.
- Nessun feedback → Chiedi modifiche: avviso e nessun cambio di stato.
- Testo non inviato → Approva/riepilogo/invio: testo conservato e azione fermata.
- Voce → riepilogo → conferma: nessuna richiesta mandata dall'AI autonomamente.
- Chiudi/riapri assistente: bozza conservata, microfono chiuso.
- Due schede aperte: un feedback arrivato durante Approva tutto esclude quel post.
- Nuova versione: feedback della vecchia versione non blocca automaticamente quella nuova.
- Piano con post Instagram e LinkedIn: tutti nell'elenco, solo Instagram nell'anteprima Instagram.
- Home con piano, post singolo e articolo: nessuna duplicazione né contenuto irraggiungibile.

## Limiti della revisione

Le prove browser sintetiche verificano il comportamento dell'interfaccia, non il gradimento soggettivo della voce o una conversazione con microfono fisico. La connessione reale GPT-Live è stata verificata nella release precedente; qui si verifica la regressione del client. Questa è una revisione approfondita dei percorsi selezionati, non una nuova certificazione completa della sicurezza di ogni endpoint.
