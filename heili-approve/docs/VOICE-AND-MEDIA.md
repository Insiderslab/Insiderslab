# Voce, revisione e contesto dei media

Implementazione dell'8 ottobre 2026, aggiornata il 9 ottobre 2026 su richiesta di Stefano.

## Percorso cliente

Il microfono nel commento detta una bozza modificabile; non invia il commento. «Chiedi modifiche» invia direttamente i commenti già salvati dal revisore sulla versione corrente, senza chiedere un secondo testo e senza duplicarli. Se non ci sono commenti validi, mostra un avviso; se c’è una bozza non salvata, invita prima a inviarla o annullarla. Commenti dell’agenzia, di un altro revisore, risolti o appartenenti a versioni precedenti non vengono usati per questa azione. Le conferme di richiesta modifiche e approvazione restano visibili dopo il refresh. Per le creatività Ads rimane il percorso «Invia le mie decisioni» con le regole delle varianti.

«Parla con Heili» usa GPT-Live (`gpt-live-1`, voce `marin`) tramite WebRTC: microfono e voce dell’assistente funzionano contemporaneamente, così il cliente può intervenire mentre Heili parla. L’utente avvia esplicitamente la chiamata, può disattivare il microfono, riattivarlo e terminare. Il browser deve consentire microfono e riproduzione audio; un eventuale blocco dell’audio mostra «Attiva audio». La chat scritta resta disponibile. Non viene usata la sintesi vocale del sistema per la conversazione; la sola dettatura del testo mantiene SpeechRecognition del browser.

La trascrizione in diretta aiuta a seguire il dialogo. Il server riceve gli eventi autentici del provider, li conserva nella sessione di revisione e li rende disponibili al normale riepilogo. «Prepara il riepilogo» termina prima la chiamata e attende il salvataggio. Approvazioni e invio delle modifiche restano azioni esplicite del cliente. L’app non conserva registrazioni audio; GPT-Live è configurato con `store: false`. Questa impostazione non costituisce una promessa di Zero Data Retention del provider. Le prove browser con dispositivi simulati non certificano la resa del microfono e degli altoparlanti fisici.

Il punto selezionato mantiene coordinate, media, variante e momento del video insieme, anche nel riepilogo strutturato e nel commento finale. Le sessioni sono vincolate alla versione: un aggiornamento del post durante una risposta impedisce di salvare un feedback sulla versione superata.

## Limiti e gestione delle chiamate

Una chiamata dura al massimo 180 secondi per default; sono consentiti 6 avvii ogni 24 ore per revisore e 100 per workspace, con almeno 10 secondi tra due avvii. I tentativi falliti contano. Le variabili `REVIEW_ASSISTANT_VOICE_*` sono documentate in `.env.example`; la durata configurabile è limitata a 600 secondi. I limiti vocali sono indipendenti da quelli della chat. Durante la chiamata il server impedisce invii testuali e finalizzazioni concorrenti della stessa sessione.

La nuova migrazione `20261009133000_review_voice_calls` conserva chiamate, frammenti di trascrizione e collegamenti idempotenti ai messaggi della revisione. Il canale di controllo autenticato riceve la trascrizione direttamente da OpenAI; il browser non può caricare trascrizioni attribuite all’assistente né cambiare modello, istruzioni o strumenti. Il browser non riceve gli eventi di avvio/chiusura che contengono copie del prompt interno.

Il timer del server chiude la chiamata alla scadenza. `/api/cron/voice`, protetto dal segreto cron, recupera le chiamate rimaste aperte dopo riavvii e ricontrolla link revocati, clienti archiviati e versioni superate. La chiusura confermata dal provider precede il riepilogo. Un esito incerto resta da recuperare e non viene presentato come salvataggio concluso. Applicare la migrazione e aggiornare anche il container cron con il nuovo script.

## Condivisione e piano

Il link cliente è visibile nella pagina del post, anche cambiando scheda. Dall'elenco «Apri e copia link» porta direttamente al pannello. Con più referenti si sceglie esplicitamente la persona; il link conserva i suoi permessi e apre quel post. Le bozze non diventano visibili per effetto della copia.

Calendario, elenco e griglia sono viste degli stessi contenuti. Il piano distingue post inclusi, esterni e nuovi invii. Salvare non significa inviare. I post esterni già revisionati si aggiungono con «Aggiungi al piano» senza notificare nuovamente.

## Analisi privata per l'assistente

L'analisi parte dopo il salvataggio di un post con media locali, oppure alla prima conversazione su media esistenti. I caricamenti abbandonati non vengono inviati ai provider. Qwen3-VL-Flash descrive immagini e al massimo otto fotogrammi; Whisper trascrive il parlato con tempi. I fotogrammi non garantiscono copertura di ogni scena, né riconoscimento della musica. Risultati mancanti sono dichiarati tali all'assistente, non inventati.

Il server conserva il risultato per asset e revisione dell'analizzatore, senza ripeterlo a ogni conversazione. L'assistente riceve soltanto gli asset presenti nella versione autorizzata del post, filtrati per workspace. I risultati grezzi non sono esportati nel portale, ma l'assistente può usarli nelle risposte. Eliminare l'asset elimina la sua analisi; il registro dei tentativi conserva metadati di consumo fino alla cancellazione del workspace. Le normali immagini possono ancora essere allegate al modello conversazionale.

Limiti iniziali per workspace: 100 tentativi / 24 ore, 3600 secondi di audio / 24 ore; singolo video massimo 600 secondi, file massimo 300 MiB, dimensioni positive fino a 50 milioni di pixel. Anche file non decodificabili consumano un tentativo. Esiti incerti/interrotti non vengono ritentati automaticamente per evitare addebiti duplicati. Una nuova revisione dell'analizzatore può accodare nuovamente gli asset.

Provider: l'endpoint Qwen predefinito riusa il servizio già adottato nella mappatura Heili (`maas.qwencloudapi.com`). Sono ammessi anche gli endpoint Alibaba DashScope indicati nel codice. Audio estratto inviato all'API OpenAI Whisper; conversazioni al provider già configurato nell'istanza. Non promettere residenza UE o assenza di retention dei provider senza verificare il contratto dell'account. Configurazione disabilitata per default; attivazione esplicita tramite variabili server.

## Isolamento e configurazione

Applicare la migrazione `20261008190000_media_analysis` prima di avviare il worker. Creare un ruolo PostgreSQL dedicato `approve_media_analysis`, con password diversa da quella applicativa, senza superuser, creazione ruoli/database o ereditarietà. Dopo la creazione del ruolo:

```sql
GRANT CONNECT ON DATABASE approve TO approve_media_analysis;
GRANT USAGE ON SCHEMA public TO approve_media_analysis;
GRANT SELECT ON "MediaAsset" TO approve_media_analysis;
GRANT SELECT, INSERT, UPDATE ON "MediaAnalysis", "MediaAnalysisAttempt" TO approve_media_analysis;
```

Creare `.env.media` (permessi 600, escluso da Git) con `DATABASE_URL` di quel ruolo, `QWEN_API_KEY` e `OPENAI_API_KEY` per la trascrizione. Questo file è passato solo al media-worker: la chiave Qwen e la password del ruolo dedicato non entrano nel web o nel worker di pubblicazione. Nel normale `.env` configurare il flag e le opzioni documentate in `.env.example`. Il servizio media non riceve segreti login, cifratura token o Metricool. Il decoder non eredita neppure le credenziali del worker. La rete `media` collega solo PostgreSQL, media-worker e media-redis; la coda di pubblicazione rimane separata. Verificare i privilegi effettivi e che non esistano concessioni ereditate da PUBLIC.

I rifiuti per quota giornaliera vengono riaccodati dopo 24 ore, poiché non hanno ancora chiamato i provider. Gli altri fallimenti restano terminali. La quota audio viene riservata soltanto quando esiste una chiave di trascrizione; un rifiuto per quota audio rimanda l'intera analisi.

Container non-root, filesystem di sola lettura, upload read-only, tmpfs, capability rimosse, limiti memoria/CPU/processi. Il job persistente nel database consente di ricostruire la coda dopo un guasto Redis. La salute del servizio media è indipendente dall'endpoint principale dell'app.

## Identità dell'icona

`components/heili-assistant-icon.tsx` riprende il nucleo con tre satelliti del materiale Heili interno: `sbp-consenso-team/docs/IDENTITA_HEILI.md` (25 luglio 2026), `DESIGN-SYSTEM-HEILI.md` e `design-tokens.css` (21 agosto 2026), con geometrie dal componente Business Brain. Navy #001F2F, menta #00E1CD, nucleo chiaro. Il materiale indica Heili come prodotto del gruppo 3Runes; non è stato trovato un manuale 3Runes autonomo più recente. L'icona è un adattamento per l'assistente, non un nuovo marchio ufficiale.

Fonti tecniche: [Whisper e timestamp](https://developers.openai.com/api/docs/guides/speech-to-text), [Qwen3-VL-Flash](https://docs.modelstudio.console.alibabacloud.com/en/model-studio/qwen3-vl-flash).

Documentazione vocale: [GPT-Live](https://developers.openai.com/api/docs/guides/live), [WebRTC](https://developers.openai.com/api/docs/guides/voice-webrtc), [controlli server e trascrizione](https://developers.openai.com/api/docs/guides/voice-server-controls).

## Verifica del rilascio del 9 ottobre 2026

Rilasciato su `approve.heili.cloud` con immagine `approve-app:a03a5f9` (commit `a03a5f9d31807dcbd6aeabbed257de4f05cbebdd`). Entrambi i branch `claude/bold-lovelace-xdiiw9` e `codex/approve-review-improvements` contengono le modifiche.

- Suite completa prima della rifinitura della trascrizione: 643/643 test; rifinitura verificata con 9/9 test vocali, compreso il caso di frammenti intercalati nel mezzo di una parola. Build, TypeScript e lint superati; resta un warning preesistente in `invitation-accept-card.tsx`.
- Browser con dispositivi simulati: 16/16 verifiche sul collegamento, annullamento, microfono, trascrizione e chiusura.
- Sul rilascio finale: 11/11 verifiche con WebRTC e GPT-Live reali, usando esclusivamente un cliente temporaneo e audio sintetico. La richiesta di cambiare il titolo in «Primavera in città» è presente nel riepilogo strutturato. Chiamata chiusa dal provider; trascrizione salvata in tre messaggi leggibili. Confermato che un altro revisore non può chiudere la chiamata.
- Riepilogo persistente dopo refresh; visualizzazione controllata a 1440 e 390 px senza overflow orizzontale. Nessuna prova del microfono fisico dell’utente.
- Nessuna approvazione, pubblicazione, email o notifica inviata dal test. Cliente, utente e workspace sintetici eliminati dopo aver verificato la chiusura delle chiamate.
- Migrazione applicata; salute pubblica OK, servizi senza riavvii. Backup verificati prima dei rilasci in `/docker/approve/backups/pre-143f487` e `/docker/approve/backups/pre-a03a5f9`. Il rollback dell’immagine può mantenere le nuove tabelle additive.
