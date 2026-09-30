Sei l'esecutore del GIRO DI RECUPERO della mappatura media. Stesse regole fisse del giro precedente (sola lettura sui clienti, niente file sensibili, niente invenzioni, "non so" se non sei certo, CSV salvato ogni 25 righe, 14 colonne invariate).
Ragionamento alto. Non fermarti a fare domande: annota i dubbi nel LOG e vai avanti.
Puoi usare sotto-agenti (max 3 insieme, uno per compito, file di output separati; solo tu scrivi il LOG).

RADICE CLIENTI (solo lettura): G:\.shortcut-targets-by-id\1x09gZUobVR-b75FguCEbkVEr8t7pNVns\Clientes Clients
CARTELLA DI LAVORO: C:\Users\stefa\OneDrive\Documenti\ChatGPT\Social Media Manager\mappe
LOG: aggiungi una sezione "GIRO 2" in fondo a LOG_NOTTE.md.
FRAME TEMPORANEI: questa volta mettili FUORI da OneDrive, in C:\Temp\frames\<Cliente> (così non vengono sincronizzati). Non cancellarli: li elimina Ste a mano.

COMPITI, in quest'ordine di priorità

1. MARCHI DEL GRUPPO MEDEA (nessuna nuova visione)
Nel CSV MAPPA_MEDIA_Ortofrutticola_Medea.csv ci sono righe taggate "vigna - NON per Medea" e "agriturismo - NON per Medea". Quel materiale è di Terre di Trincea e Agriturismo Alle Trincee.
- Copia le righe "vigna / cantina / vendemmia / barrique / bottiglie" in MAPPA_MEDIA_Terre_di_Trincea.csv.
- Copia le righe "agriturismo / ristorazione / piatti / sala" in MAPPA_MEDIA_Agriturismo_Alle_Trincee.csv.
- Nel CSV di Medea lasciale, ma aggiungi al tag "assegnato a Terre di Trincea" o "assegnato ad Alle Trincee".
- Aggiorna i due RIEPILOGO con i nuovi conteggi.

2. LINK DRIVE (colonna 2)
Dove la colonna 2 contiene un percorso G:\ invece di un link, sostituiscilo con il link Drive del file (https://drive.google.com/file/d/<ID>/view), ricavato tramite il connettore Google Drive o l'ID del file sincronizzato. Il team lavora da remoto: i percorsi G:\ per loro non funzionano. Se per un file non trovi l'ID, lascia il percorso e contalo nel LOG.

3. GIÀ PUBBLICATA? (colonna 12) — oggi è "non so" su tutto
Per ogni cliente confronta il materiale mappato con quanto già pubblicato o preparato:
- cartelle "03 Social Media", "Post <mese>" e griglie dei mesi passati del cliente;
- confronto per hash identico (SHA-256) e, se non basta, per somiglianza visiva sui fotogrammi/miniature (stessa scena, stessa inquadratura).
Esito: "sì (mese, cartella)" se trovi corrispondenza certa; "no" solo se il cliente ha una cartella social completa e il file non compare; altrimenti resta "non so".
Ordine: Medea, Terre di Trincea, Alle Trincee, Ecosmart, Studio Fabbro, HEC, Soshi, Insiders Lab.

4. LUMII — completare
Riprendi le 160 righe provvisorie ("Inventario provvisorio: analisi visiva incompleta") e fai la visione vera, a lotti di 25, poi prosegui sugli altri file recenti (ultimi 6 mesi, circa 288). Se il contesto si esaurisce, passa il lotto successivo a un nuovo esecutore invece di fermarti. Crea il RIEPILOGO solo quando è davvero finito.

5. PARIED — archivio
Per Paried i file recenti sono 0, ma ci sono 426 file storici. Ceramiche e arredo bagno non invecchiano: mappa anche lo storico, dando priorità alle foto di prodotto e showroom di qualità buona o ottima. Nei tag indica l'anno.

VERIFICA FINALE
Per ogni CSV toccato: 14 colonne, nessuna riga duplicata, conteggi del RIEPILOGO allineati. In fondo al LOG una tabella: cliente · righe · link Drive convertiti · già pubblicati sì / no / non so · note.
