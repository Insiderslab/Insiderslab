# Approve Studio — direzione approvata

Stefano ha scelto la proposta «Studio» il 9 ottobre 2026 e ha autorizzato l'estensione del design alla piattaforma. Richiesta esplicita: il microfono di dettatura è accanto alla freccia che invia il commento; «Parla con Heili» resta una funzione distinta nello stesso spazio.

## Principi

- Il contenuto è il protagonista. Su desktop anteprima e feedback sono affiancati; su mobile si dispongono in una colonna leggibile.
- Una richiesta può essere scritta, dettata o chiarita conversando con Heili. La conversazione non approva e non invia automaticamente una richiesta ufficiale.
- I progressi contano le revisioni concluse: approvazioni e richieste di modifica. Non si premia soltanto l'approvazione e non si inventano conteggi.
- Le bozze sul dispositivo e i commenti salvati non sono la stessa cosa: questi ultimi sono già visibili all'agenzia. «Chiedi modifiche» formalizza la richiesta senza chiedere un secondo testo.
- Superfici chiare, navy, accenti menta e meno cornici. Stati accompagnati da testo, focus da tastiera e controlli touch leggibili.

## Pannello agenzia

L'editor social raggruppa configurazione e contenuto in due sezioni: «Dove e quando» e «Il contenuto». Media e testo convivono, i campi facoltativi si possono espandere e la preview resta accanto. Salvare una bozza e inviare in revisione sono azioni distinte; reti, formati, controlli, versioni e note di reinvio mantengono le regole esistenti.

Il piano ha tre viste degli stessi contenuti: Elenco, Calendario, Anteprima Instagram. La griglia contiene solo Instagram e non rappresenta l'intero profilo già pubblicato. Nel portale cliente sono disponibili Elenco e Anteprima Instagram, con il percorso di revisione individuale in evidenza.

«Copia link cliente» è separato da «Apri». La risoluzione dei link verifica ogni volta sessione, workspace, visibilità del contenuto, cliente attivo e referenti attivi. Con un solo referente copia direttamente, quando il browser lo permette; con più persone richiede la scelta. Se la clipboard è bloccata il link resta selezionabile.

«Rendi disponibile il piano» risolve il caso di un piano non condiviso i cui post sono già dal cliente: espone la raccolta senza reinviare i post o inviare email di invito. Richiede almeno un post già visibile, mantiene private le bozze e conserva il normale ciclo di notifica al completamento.

## Portale cliente

Lo spazio «Il tuo feedback» raccoglie commenti, dettatura e accesso a Heili. I riferimenti a immagine, momento del video, frase o variante devono rimanere associati alla bozza originale. La revisione non può concludersi mentre rimangono testo non inviato, dettatura o operazioni pendenti.

Le regole di approvazione legata alla versione, isolamento tra clienti, decisioni Ads per variante e preparazione del contesto visivo della voce rimangono vincolanti. L'analisi dei media non certifica l'aderenza a un brief non fornito.

La guida contestuale spiega le differenze fra scrivere, dettare, conversare, salvare un commento e inviare la richiesta. La guida è richiamabile, senza imporre un tutorial a ogni visita.

## Prototipi e dati

I prototipi mostrati in chat usano Studio Forma e Officina Nord come esempi fittizi, operazioni simulate e conteggi illustrativi. Il codice applicativo usa i dati autorizzati del workspace e del cliente. Il prototipo non costituisce una pubblicazione o un invio ai clienti.

## Verifica

Verifiche sul codice finale: 704 test automatici superati (46 file), TypeScript, ESLint sui file modificati e build Next.js di produzione completati. Nel browser: 24 controlli per editor e viste del piano, 36 per il feedback Studio e 21 per il ciclo della conversazione vocale, tutti superati. I controlli coprono desktop e mobile, bozze, cambio riferimento/variante, microfono vicino all'invio, blocco del passaggio a Heili durante la dettatura, cancellazione della preparazione vocale e decisioni.

Il browser con dispositivi simulati non certifica la resa di un microfono fisico. Le integrazioni vocali e l'analisi Qwen conservano il funzionamento verificato nel rilascio precedente; questo aggiornamento modifica la loro presentazione, non il modello o la voce.
