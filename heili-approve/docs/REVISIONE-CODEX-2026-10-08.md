# Approve by Heili — revisione e migliorie, 8 ottobre 2026

## Perimetro e metodo

Base: repository `Insiderslab/Insiderslab`, branch `claude/bold-lovelace-xdiiw9`, commit `3339dc20c35c202ebfecb47d4d10914b96628a80`. Implementazione locale sul branch `codex/approve-review-improvements`.

Letti nell'ordine richiesto la scheda di revisione, il contratto, le varianti e tutte le 31 schermate. Esaminati i percorsi principali di autenticazione e isolamento workspace, token cliente, versioni e approvazioni, piano mensile, notifiche, programmazione Metricool, upload, export, blog, ads e assistente. Revisione mirata dei percorsi e dei rischi: non una certificazione di sicurezza o una verifica del server di produzione. Nessun dato cliente o segreto di produzione usato.

Il prodotto ha una buona base: autorizzazioni rivalidate lato server, token casuali a 256 bit salvati tramite hash, approvazione vincolata alla versione vista, HTML sanitizzato, upload in streaming con controllo del formato, export limitato ai file del workspace e protezioni contro la doppia programmazione su Metricool. L'assistente resta consultivo e non approva autonomamente.

## Migliorie implementate

| Area | Problema osservato | Risultato |
|---|---|---|
| Revisione mobile | Navigazione lunga e differenze prima del contenuto | Navigazione compatta, anteprima prima delle differenze, dettagli richiudibili e target di navigazione da 44 px |
| Didascalie | Testo lungo difficile da leggere nel Reel | Pannello separato con testo completo e primo commento, caratteri da 16 px |
| Video | Stato della clip precedente riutilizzato al cambio sorgente; Reel troppo alto | Stato del player ricreato per ogni sorgente e frame mobile adattato mantenendo le proporzioni |
| Agenzia | Condivisione occupa spazio prima dell'anteprima | Link cliente in pannello richiudibile |
| Versioni | Anteprima storica con reti/data/opzioni della versione attuale | Uso dello snapshot della versione, con fallback per le righe storiche prive di snapshot |
| Email piano completato | Marcata come inviata prima di sapere se il trasporto aveva accettato l'email | Conferma solo dopo esito positivo, lease atomica, retry persistente e recupero via cron |
| Sicurezza HTTP | Protezioni di embedding e referrer non uniformi | `nosniff`, `DENY`, CSP per frame/base/object, `no-referrer`, esclusione indicizzazione del portale e `no-store` sulle sue API |
| Dipendenze | Next e Auth con advisory applicabili | Next/ESLint 16.4.0, NextAuth beta.32, adapter 2.11.3, Nodemailer 8.0.11 e patch compatibili di tre transitive |
| Ambiente | Runtime Docker Node 20 e risultati diversi su Windows | Docker/README Node 24; normalizzazione UTC indipendente da ICU e test traversal con root assoluta |

Le correzioni Next e Auth affrontano rispettivamente il [DoS delle Server Actions](https://github.com/advisories/GHSA-m99w-x7hq-7vfj) e il [problema di normalizzazione degli indirizzi magic link](https://github.com/advisories/GHSA-7rqj-j65f-68wh). Il controllo applicativo sull'ID utente già mitigava il diverso advisory Auth di fail-open.

### Semantica delle notifiche

La nuova migration aggiunge a `ContentPlan` due timestamp nullable e un indice. Le notifiche hanno lease e backoff di cinque minuti; il claim e la conferma sono vincolati al `sentAt` del singolo invio. Un reinvio azzera i campi. Il cron processa al massimo 100 candidati per sweep e mantiene i vecchi campi della risposta, aggiungendo `planNotifications`.

La conferma significa accettazione da parte del trasporto, non consegna nella casella. In caso di crash dopo l'accettazione ma prima della scrittura finale un retry può duplicare l'email: semantica at-least-once, non exactly-once. I normali invii sovrapposti sono protetti dal claim.

## Problemi emersi nella prima revisione

Stato aggiornato dopo il secondo intervento nella sezione finale: limiti AI e cron concorrenti sono stati implementati; le quote sono state introdotte sul nuovo canale di automazione.

| Priorità | Finding e percorso | Intervento consigliato |
|---|---|---|
| Alta | Retry e finalize dell'assistente non conteggiano ogni tentativo provider (`lib/review-assistant/service.ts`) | Contatore persistente per tutti i tentativi, inclusi fallimenti, limite giornaliero e cooldown; il lock corrente impedisce soltanto chiamate parallele |
| Alta | Promemoria vulnerabili a cron sovrapposti (`lib/scheduling.ts`, `sendReviewReminders`) | Outbox/claim persistente prima dell'invio; il nuovo retry dei piani non modifica i promemoria |
| Media | Quota storage assente e asset non raccolti dopo rimozione (`app/api/uploads/route.ts`, `lib/storage.ts`) | Quota per workspace, limite upload concorrenti, raccolta dei media senza riferimenti e revoca esplicita |
| Media | URL media pubblici con cache annuale (`app/media/[...key]/route.ts`) | Definire durata/revoca dei media; ruotare il token portale non revoca un URL media già copiato |
| Media | Ciclo di vita dei link consentito ai MEMBER e nessuna scadenza (`app/(dashboard)/clients/actions.ts`, `ClientReviewer`) | Concordare la facoltà MEMBER; introdurre scadenza/rotazione e audit. Non restringere senza confermare il modello operativo |
| Media | `ALLOWED_EMAILS` vuoto consente registrazione (`lib/env.ts`) | Configurazione produzione esplicita e rate limit magic link; verificare la configurazione effettiva prima di cambiare policy |
| Media | Approva-tutto esegue fino a 500 approvazioni in sequenza (`lib/plans.ts`) | Batch limitati e progresso recuperabile; verificare tempi con DB/Redis reali |
| Media | Decisione ads condivisa tra reviewer (`CreativeDecision`) | Definire se vale l'ultima decisione o serve consenso; l'audit eventi conserva la cronologia ma il verdetto corrente viene sostituito |
| Bassa | Guard URL immagini AI incompleto (`lib/review-assistant/prompt.ts`) | Allegare solo media di proprietà dell'app; i provider ricevono URL, non c'è fetch locale, ma la difesa attuale non copre tutti gli indirizzi speciali |
| Bassa | Container root con tooling di build incluso (`Dockerfile`) | Separare runtime/tooling e introdurre utente non privilegiato insieme alla verifica dei permessi dei volumi esistenti |

La cancellazione di un post già programmato non annulla automaticamente Metricool: la UI lo segnala. Una sincronizzazione richiede un flusso esplicito di annullamento remoto, gestione degli errori e prova con Metricool.

L'audit npm finale con `--omit=dev` passa da 17 segnalazioni (4 critiche, 9 alte, 4 moderate) a 11 (0 critiche, 8 alte, 3 moderate). Le segnalazioni residue riguardano Nodemailer e catene di tooling Prisma; non sono undici exploit applicativi dimostrati. Nodemailer 10 non soddisfa il peer range dichiarato da Auth beta.32 (7/8): mantenuto 8.0.11, senza override forzati. L'audit propone anche un downgrade Prisma: non applicato. Questo risultato non equivale a una piattaforma senza vulnerabilità.

## Verifica e rilascio

Prima delle modifiche: 539/542 test passavano; tre errori di portabilità Windows. Dopo: 552/552 test passano, inclusi guasto email, retry, crash, concorrenza, reinvio durante la consegna e recupero di piani con nuove bozze; TypeScript e build di produzione Next 16.4.0 passano. ESLint: zero errori e un warning sulla navigazione con reload nella scheda invito (regola introdotta dall'aggiornamento Next). Prisma generate/validate e controllo whitespace passano.

Verifica Playwright con componenti reali e fixture sintetica: 47/47 controlli passano a 390×844, 360×640 e 1440×1000. Nessun overflow orizzontale, navigazione compatta con link da 44 px, frame/controlli video entro la larghezza disponibile, testo completo e differenze accessibili, dialog di approvazione aperto/chiuso senza invio, stato azzerato al cambio clip e nessun errore runtime. Gli header di sicurezza e il no-store della risposta API inesistente sono verificati in HTTP. Screenshot e JSON delle prove sono nella cartella locale `verification/` accanto al checkout; fixture e media temporanei sono stati rimossi prima della build.

La suite E2E completa richiede PostgreSQL, Redis, worker e seed; questi servizi non sono disponibili nell'ambiente locale. Non verificati invii reali, login magic link, programmazione Metricool e aggiornamento del DB di produzione. La verifica browser usa dati sintetici e componenti reali.

Anche il server della build di produzione è stato avviato e fermato: gli header risultano corretti sulla pagina con link invalido, sull'endpoint assistant con token invalido (404) e su una API inesistente (404), tutti con `no-store`. Revisione indipendente del diff conclusa senza regressioni bloccanti nelle modifiche implementate; i rischi residui sopra restano aperti.

Prima del rilascio: backup DB, applicazione migration, nuova build Node 24, avvio web/worker/cron e smoke test con workspace e client di prova. La migration è additiva: un rollback del codice può lasciare colonne nullable e indice senza eliminarli. Alla conclusione di questa prima fase non erano stati eseguiti push, deploy o migration su produzione; l'esito del rilascio successivamente autorizzato è riportato in fondo.

## Secondo intervento: importazione per Codex e Claude

Richiesta accolta: tutti i membri del workspace possono gestire i link cliente; mantenuta la politica esistente e documentata nel contratto. Codex e Claude devono poter compilare i post partendo da un foglio e dai relativi media.

Implementato:

- API autenticata `/api/automation/v1` per ricerca clienti, lettura post, validazione senza scritture, upload e creazione di sole bozze social;
- chiavi personali in Impostazioni, hash nel DB, scadenza di 30 giorni dalla UI, revoca e verifica della membership a ogni chiamata;
- CLI Python senza nuove dipendenze per XLSX/CSV/JSON, output JSON e righe identificate stabilmente; rilevamento delle colonne inattese, formule, media fuori cartella e date ambigue;
- dry-run prima degli upload, manifest automatico di ripresa, riuso dei media caricati e vincolo univoco per evitare bozze duplicate anche sotto concorrenza; 409 su stesso identificativo con contenuto diverso;
- massimo 1.000 bozze importate per workspace nelle ultime 24 ore (configurabile), quota di default 5 GiB sul canale upload API, massimo tre trasferimenti contemporanei e timeout attivo;
- budget AI persistente che conta anche errori, retry e riepiloghi; default 100 tentativi per referente e 1.000 per workspace in 24 ore, cooldown 3 secondi;
- lease dei promemoria per cliente con rilettura dei candidati dopo il claim e recupero dopo interruzione;
- recupero del pulsante «Approva tutto» dopo un errore di rete;
- istruzioni condivise in `AGENTS.md` e `CLAUDE.md`, guida in `docs/AGENT-IMPORT.md`, contratto in `docs/AUTOMATION-API.md`, template CSV apribile in Excel.

La suite complessiva passa a 591 test TypeScript/Vitest; 13 test Python passano. Il test di contratto avvia realmente Python da una cartella diversa e chiama gli endpoint reali via HTTP con Prisma simulato: CSV → dry-run senza scritture → bozza → replay → conflitto. I controlli della nuova UI verificano mobile/desktop, input a 16 px, target da 44 px, nessun overflow e nessuna mutazione durante la prova. Build Next e TypeScript passano; ESLint conserva il solo warning già descritto. Il server di produzione locale rifiuta gli accessi API senza chiave con 401 e no-store.

La nuova migration `20261008170000_automation_and_reliability` è additiva e richiede applicazione prima del rilascio. Al termine della fase locale non era stata applicata a un DB reale. Le verifiche con database simulato non attestano il funzionamento end-to-end di PostgreSQL, Redis, SMTP o Metricool in produzione; i controlli reali successivi sono riportati nella sezione di rilascio.

Restano aperti: risposte dell'agenzia sul piano, batch recuperabili di approvazione, dashboard operativa, scadenze dei link cliente da concordare, quote degli upload manuali, revoca/cache dei media, raccolta degli asset orfani, rate limit HTTP all'ingresso e avvisi npm residui. Il canale v1 importa post social; non importa blog/ads e non modifica automaticamente post esistenti. Un'interruzione tra accettazione di un media e scrittura del manifest può lasciare un asset duplicato/orfano, pur senza duplicare la bozza. Il conteggio AI registra tentativi applicativi: i retry interni degli SDK possono generare più richieste HTTP per tentativo.

## Terzo intervento: desktop e guida su richiesta

Su richiesta del titolare, la revisione desktop usa ora due colonne: anteprima più grande a sinistra e titolo, data e dettagli a destra. Instagram passa da 420 a 560 px; Facebook e LinkedIn arrivano a 600 px, le anteprime verticali da 340 a 420 px. Anche editor e revisione dell'agenzia hanno più spazio. Su mobile restano titolo/stato, anteprima e poi dettagli espandibili, senza overflow. Navigazione tra post con pulsanti testuali e caroselli con indicatore «1 di 3» e controlli da 44 px.

«Guida e aiuto» apre un pannello cercabile con suggerimenti legati alla pagina e istruzioni numerate. Le guide cliente e agenzia sono separate e filtrate per servizi attivi. Sono istruzioni locali, senza chiamate AI o invii dei testi cercati. La guida si apre solo su richiesta, conserva i campi già compilati, gestisce Tab/Esc, ripristina il focus e annuncia il cambio di passaggio. Include revisione social, piani, articoli, creatività, commenti, link e importazioni Excel.

Verifica browser su componenti reali con dati sintetici: 104/104 controlli a 1440, 1024, 390 e 360 px, nessun errore runtime o richiesta di modifica dei dati. Confermati feed desktop da 560 px, assenza di overflow, carosello, conferma esplicita di approvazione, ricerca, passaggi, focus e conservazione del modulo. Suite complessiva: 595/595 test. Il test cooldown da 1 ms ora usa un orologio fermo per evitare dipendenza dal carico CPU. Revisione indipendente completata; corretti ricerca conversazionale, annunci dei passaggi e testi su email facoltativa/scadenza delle chiavi. Le fixture browser sono state rimosse prima della build.

## Rilascio verificato — 8 ottobre 2026

Pubblicazione autorizzata dal titolare e completata su `https://approve.heili.cloud`. Immagine `approve-app:547219a`, codice `547219a307186fa787c0d20f465fb9c9a03e84ae`. Conservati backup del database verificato con `pg_restore --list`, archivio degli upload, configurazione precedente e immagine di rollback. Entrambe le nuove migration applicate correttamente; nessuna migration pendente.

Controlli reali via HTTPS, PostgreSQL e storage di produzione con utente/workspace/cliente sintetici: impostazioni autenticate con guida e controlli automazione, portale cliente con guida, isolamento elenco clienti, validazione senza scritture, upload PNG e rilascio della prenotazione, creazione di sola bozza con versione/audit, replay senza duplicazione, conflitto 409, lettura e revoca della chiave con 401. Dati, sessioni, chiavi e upload di prova rimossi a fine controllo. Nessun invio email o programmazione Metricool reali eseguiti come test.

Verificati health pubblico 200, header di sicurezza, rifiuto delle API senza chiave e servizi web/worker/cron stabili senza riavvii automatici. Il controllo sul server ha intercettato CRLF nello script cron esportato da Windows: aggiunto `.gitattributes` per preservare LF negli script shell, verificato l'archivio e ricostruita l'immagine. Il cron è stato avviato dopo che il web era pronto e la chiamata promemoria ha risposto correttamente. Per i rilasci successivi attendere il health positivo di web/worker prima di avviare il cron, perché il Compose esistente usa `service_started`.

Build finale di produzione e TypeScript superati. ESLint: nessun errore e il solo warning già descritto. Le modifiche alla documentazione successive al commit dell'immagine non richiedono una nuova build.

## Precisazione del titolare: marcatore dei commenti sulle immagini

La «freccia» indicata dal titolare era il marcatore del commento su un punto della foto. Aggiornato il componente condiviso: piccolo bersaglio vuoto sul punto esatto, collegamento sottile e numero spostato verso l'interno dell'immagine, con contrasto su fondi chiari e scuri. Il nuovo commento usa un badge pieno con «+», i commenti salvati un numero su fondo bianco. Coordinate e associazione al commento restano identiche; i marcatori non intercettano i tocchi. Stessa resa sui fotogrammi video e punto provvisorio visibile anche nella revisione dell'agenzia.

Verifica browser: 29/29 controlli a 1440, 390 e 360 px, inclusi quattro bordi, precisione delle coordinate, distinzione del punto provvisorio, annullamento, assenza di overflow e nessuna richiesta di scrittura. I 27 test mirati sulle anteprime e sul portale passano; TypeScript e revisione indipendente non rilevano problemi. Le fixture sono state rimosse prima della build.

Pubblicato anche questo aggiornamento: immagine `approve-app:01f75a6`, codice `01f75a6025c9e3a1fdbf346e9d0f791dd79d5a45`. Build locale e server completate, health pubblico positivo e web/worker/cron stabili senza riavvii automatici. Verificato via HTTPS un commento salvato con il nuovo marcatore nella revisione autenticata; superati anche i controlli di importazione e revoca. Dati sintetici e upload di prova rimossi. Nessuna modifica allo schema del database; conservata la configurazione precedente per il rollback.
