Sei l'esecutore della MAPPATURA MEDIA di più clienti, uno dopo l'altro, in autonomia per tutta la notte.
Ragionamento alto. Non fermarti a fare domande: se qualcosa non è chiaro, annotalo e vai avanti.

CARTELLA CLIENTI (solo lettura): <PERCORSO DRIVE SINCRONIZZATO, es. G:\Il mio Drive\Clienti>
CARTELLA DI LAVORO (qui scrivi): <PERCORSO, es. C:\Users\Ste\Griglie-Novembre-2026\mappe>

ORDINE DEI CLIENTI
Dentro CARTELLA CLIENTI ogni cliente ha una sottocartella tipo "02. Ortofrutticola Medea". Trovala per nome (ignora numero e maiuscole).
Fase A (priorità):
 1. Ortofrutticola Medea
 2. Agriturismo Alle Trincee
 3. Terre di Trincea
 4. Lumii (Reana del Rojale)
 5. Studio Fabbro
 6. Ecosmart Building Italia
 7. Paried
Fase B (solo dopo aver finito tutta la Fase A):
 8. Hair Extension Clinic
 9. Soshi Hair
10. Insiders Lab
Se non trovi la cartella di un cliente, o ne trovi più di una possibile: scrivilo nel LOG e passa al successivo.

AGENTI IN PARALLELO
Se puoi creare sotto-agenti, fallo: tu fai da coordinatore e assegni UN CLIENTE PER AGENTE, massimo 3 agenti attivi insieme (per non saturare disco e Drive). Quando un agente finisce, lanci il cliente successivo della lista.
- Ogni agente riceve tutte le regole di questo prompt più le note del suo cliente, e scrive SOLO i file del suo cliente (MAPPA_MEDIA_<Cliente>.csv, RIEPILOGO_<Cliente>.md, _frames\<Cliente>).
- Solo tu (coordinatore) scrivi LOG_NOTTE.md.
- Prima di chiudere, controlla che ogni riepilogo esista e che i CSV abbiano le 14 colonne. Se un agente si è bloccato, rilancia quel cliente una volta; se fallisce ancora, annotalo nel LOG e vai avanti.
Se non puoi creare sotto-agenti, lavora da solo in sequenza, come descritto sotto.

RIPRESA
Prima di iniziare un cliente controlla se esiste già RIEPILOGO_<Cliente>.md nella cartella di lavoro: se c'è, quel cliente è fatto → saltalo.
Se esiste solo il CSV senza riepilogo, riprendi da dove si era fermato senza duplicare righe.

REGOLE FISSE
- Nelle cartelle dei clienti NON spostare, rinominare, modificare né cancellare nulla.
- Scrivi solo nella cartella di lavoro.
- NON aprire: Invoices, fatture, preventivi, presentazioni commerciali, file con prezzi, password, telefoni o email, "MASTER · Contactos".
- Salta file di lavoro (PSD, AI, esportazioni intermedie) e doppioni.
- Se un dato manca scrivi "non so". Non tirare a indovinare.
- Salva il CSV ogni 25 file mappati, così se si interrompe non si perde nulla.
- Se un file dà errore (corrotto, non scaricato da Drive, solo online): segnalo nel riepilogo e continua.

DOVE CERCARE (in ogni cartella cliente)
- "01 INSUMOS" / "01 MATERIALES" / "Materiali" → MATERIALE DA MAPPARE (sottocartelle comprese).
- "02 Diseño Gráfico" → mappa come tipo "grafica già fatta".
- "03 Social Media", cartelle "Post <mese>", griglie dei mesi passati → NON sono materiale disponibile: usale solo per capire cosa è già stato pubblicato.

COME GUARDARE
- Foto: guarda ogni immagine.
- Video: non guardarli per intero. Con ffprobe prendi durata e risoluzione. Con ffmpeg estrai 3-5 fotogrammi (inizio, metà, fine, cambio scena) in <CARTELLA DI LAVORO>\_frames\<Cliente> e descrivi da quelli. Mappa TUTTE le clip brevi e i girati grezzi. Finito il cliente, cancella la sua cartella _frames.
- Se una cartella ha più di 300 file: prima gli ultimi 6 mesi, poi scrivi nel riepilogo quanti ne restano.

NOTE SPECIFICHE PER CLIENTE (usale nei TAG, colonna 14)
- Ortofrutticola Medea: il gruppo ha 3 marchi SEPARATI (Medea, Terre di Trincea, Alle Trincee). Vigna/vino/cantina → tag "vigna - NON per Medea". Ristorazione agriturismo → tag "agriturismo - NON per Medea". Inaugurazione 17/09 → tag "inaugurazione 17-09". Video con estetica scura → tag "video scuro".
- Agriturismo Alle Trincee: priorità ristorazione/agriturismo e piatti di stagione. Vigna → tag "vigna - verificare profilo". Immagini generate con IA → tag "IA - NON usare". Inaugurazione 17/09 → tag "inaugurazione 17-09".
- Terre di Trincea: marchio del vino. Qui la colonna "già pubblicata?" è CRITICA (il cliente non vuole foto ripetute): controlla con attenzione. Vendemmia 2026 e barrique nuove (clip del 10/09 e 17/09) → tag "vendemmia 2026" / "barrique". Zucche/Halloween → tag "NON per Terre di Trincea". Materiale di Medea o agriturismo → tag "altro marchio".
- Lumii: sushi, piatto protagonista. Grafiche 2025 (Halloween, take away con prezzi vecchi) → tag "grafica 2025 - NON riusare". Foto con sticker sul cibo → tag "sticker - NON usare". Eventi settimanali (Gratta e Vinci, Gira la Ruota, Pink LUMII, Giovedrink, Family Day) → tag col nome dell'evento. Nome vecchio "mercoledrink" visibile → tag "nome vecchio - NON usare".
- Studio Fabbro: studio dentistico. Se si vede il dottore → tag "dottore visibile - NON usare". Dentiere, protesi, placche → tag "soggetto vietato". Foto stock → tag "stock - NON usare".
- Ecosmart Building Italia: impresa edile. Il cliente vuole i video di cantiere ORDINATI: per ogni video/clip indica nei tag cantiere o località (se si capisce), fase dei lavori (prima / durante / dopo) e lavorazione.
- Paried: ceramiche e arredo bagno. Tag per tipo di prodotto (piastrelle, sanitari, mobili bagno, showroom) e ambiente.
- Hair Extension Clinic: salone a Torino. Marchio SEPARATO da Soshi Hair: materiale Soshi → tag "Soshi - NON per HEC". Prima/dopo → tag "prima-dopo".
- Soshi Hair: extension e distribuzione capelli (B2B). Materiale del salone HEC → tag "HEC - NON per Soshi".
- Insiders Lab: agenzia. Tag per soggetto (team, Ste, ufficio, evento, lavori per clienti). Loghi o lavori di clienti riconoscibili → tag "cliente visibile - verificare".

OUTPUT PER OGNI CLIENTE
1) MAPPA_MEDIA_<Cliente>.csv (UTF-8, separatore ;) con queste colonne, in quest'ordine:
 1 Nome file
 2 Link Drive (se non lo ricavi: percorso completo, e segnalalo nel riepilogo)
 3 Tipo: foto / video / clip / grafica già fatta
 4 Cartella
 5 Data scatto o caricamento (AAAA-MM-GG)
 6 Descrizione breve: cosa si vede, max 20 parole
 7 Soggetti: prodotto, persone, luogo, piatto, staff…
 8 Stagione / periodo adatto
 9 Orientamento e formato: verticale 9:16 / 4:5 / quadrato / orizzontale
10 Durata (solo video, in secondi)
11 Qualità: ottima / buona / solo di supporto
12 Già pubblicata?: sì (data, canale) / no / non so. Scrivi "no" solo se ne sei certo; nel dubbio "non so".
13 Persone riconoscibili: sì / no
14 Tag per la ricerca (5-8 parole chiave separate da virgola, più i tag specifici sopra)

2) RIEPILOGO_<Cliente>.md con:
- quanti file: foto / video / clip / grafiche
- quanti già pubblicati / non pubblicati / non so
- cosa manca per novembre (es. "nessun video verticale recente", "poche foto autunnali")
- file saltati o in errore, e perché
- dubbi aperti (max 5 righe)

LOG GENERALE
Tieni aggiornato LOG_NOTTE.md nella cartella di lavoro: per ogni cliente ora di inizio, ora di fine, numero di file mappati, problemi.
Alla fine aggiungi una tabella riassuntiva: cliente · file mappati · non pubblicati · "non so" · cosa manca.

Inizia subito dal primo cliente non ancora fatto e prosegui fino alla fine della lista.
