# Prompt Codex · Mappatura foto e video (S1)

Da incollare in Codex, sostituendo `<CLIENTE>` e `<PERCORSO_CARTELLA_CLIENTE>`.
Ordine consigliato (Fase A): Ortofrutticola Medea → Alle Trincee → Terre di Trincea → Lumii → Studio Fabbro → Ecosmart → Paried.

---

Mappa tutto il materiale visivo del cliente **<CLIENTE>**.
Cartella del cliente: `<PERCORSO_CARTELLA_CLIENTE>`

**1. Dove cercare**
- `01 INSUMOS` / `01 MATERIALES` / Materiali → materiale da mappare, sottocartelle comprese.
- `02 Diseño Gráfico` → mappa come tipo `grafica già fatta`.
- `03 Social Media`, `Post <mese>` e le griglie dei mesi passati → **non** sono materiale disponibile: usali solo per capire cosa è già stato pubblicato (colonna 12).
- Salta: `Invoices`, fatture, preventivi, presentazioni commerciali, file di lavoro (PSD, AI, esportazioni intermedie), doppioni.

**2. Come guardare**
- Foto: guarda ogni immagine.
- Video: non guardarlo tutto. Con `ffprobe` prendi durata e risoluzione; con `ffmpeg` estrai 3–5 fotogrammi (inizio, metà, fine, eventuale cambio scena) e descrivi da quelli. Clip brevi e girati grezzi: mappali tutti.
- Cartelle con più di 300 file: mappa prima i file degli ultimi 6 mesi, poi segnala quanti ne restano.

**3. Output**
File `mappe/MAPPA_MEDIA_<CLIENTE>.csv` (UTF-8, separatore `;`) con queste colonne, in quest'ordine:

1. Nome file
2. Link Drive (se non lo trovi: percorso completo del file, e segnalalo nel riepilogo)
3. Tipo: `foto` / `video` / `clip` / `grafica già fatta`
4. Cartella
5. Data scatto o caricamento (AAAA-MM-GG)
6. Descrizione breve: cosa si vede, max 20 parole
7. Soggetti: prodotto, persone, luogo, piatto, staff…
8. Stagione / periodo adatto
9. Orientamento e formato: `verticale 9:16` / `quadrato` / `orizzontale` / `4:5`
10. Durata (solo video, in secondi)
11. Qualità: `ottima` / `buona` / `solo di supporto`
12. Già pubblicata?: `sì (data, canale)` / `no` / `non so`
13. Persone riconoscibili: `sì` / `no`
14. Tag per la ricerca (5–8 parole chiave, separate da virgola)

**4. Regola "già pubblicata?"**
Confronta con le cartelle `03 Social Media`, `Post <mese>` e le griglie passate. Se non hai prove certe → `non so`. Mai `no` per supposizione.

**5. Riepilogo finale** in `mappe/RIEPILOGO_<CLIENTE>.md`:
- quanti file: foto / video / clip / grafiche
- quanti già pubblicati / non pubblicati / non so
- cosa manca (es. "nessun video verticale recente", "niente foto di piatti autunnali")
- file saltati e perché
