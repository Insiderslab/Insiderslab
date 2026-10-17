=== Heili Approve – revisione «Sul sito» ===
Tags: review, approval, feedback, staging, agency
Requires at least: 5.8
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Fa commentare ai clienti il sito di prova vero, con Approve by Heili. Per i visitatori normali non fa nulla.

== Description ==

Questo plugin serve alle agenzie che usano **Approve by Heili** per far rivedere un sito al cliente.

Aggiunge in fondo alle pagine una sola riga di codice (un tag `script`) con la **chiave del sito** che trovi in Approve. Quando il cliente apre il sito dal suo portale di revisione, compare il pulsante di Heili: il cliente indica un elemento della pagina, scrive o detta la nota, e l'agenzia la ritrova in Approve nel punto esatto.

Per i visitatori normali la riga **non fa nulla**: non legge cookie, non legge quello che le persone scrivono nei moduli, non manda dati. Si accende solo quando la pagina viene aperta dal portale di Approve.

**Da usare sul sito di prova.** Quando il sito va online, in Approve premi «Segna come pubblicato» (la chiave viene revocata) e disattiva ed elimina il plugin.

Il plugin non fa chiamate di rete dal server WordPress e non salva dati dei visitatori: conserva solo la chiave del sito e l'indirizzo di Approve.

= Come si usa =

1. In Approve crea il «Sito web» del cliente e copia la **chiave del sito** (inizia con `hs_`).
2. Installa e attiva questo plugin.
3. Vai in **Impostazioni → Heili Approve**, incolla la chiave e premi **Salva**.
4. Se usi un plugin di cache, svuotala.
5. Torna in Approve e premi **Verifica installazione**.

== Installation ==

1. In Approve, nel riquadro «Sul sito», premi **Scarica il plugin** (file `heili-approve-review.zip`).
2. In WordPress vai in **Plugin → Aggiungi nuovo → Carica plugin**, scegli il file, premi **Installa ora** e poi **Attiva**.
3. Vai in **Impostazioni → Heili Approve**, incolla la chiave del sito e premi **Salva**.

Per spegnere la revisione senza disattivare il plugin, svuota il campo della chiave.

== Frequently Asked Questions ==

= Il pulsante di Heili non compare sul sito =

Hai aperto il sito dal pulsante «Apri il sito» del portale? Il link dura 10 minuti e vale una volta sola: se è scaduto, tocca di nuovo «Apri il sito». Controlla anche di aver salvato la chiave e di aver svuotato la cache.

= «Verifica installazione» dice che non trova lo script =

Svuota la cache (LiteSpeed, WP Rocket, Autoptimize…) e controlla che la chiave sia quella del sito giusto. Il plugin aggiunge `data-no-optimize` e `data-cfasync="false"` al tag perché i plugin di ottimizzazione non lo uniscano né lo ritardino.

= Rallenta il sito? =

No: è un file piccolo (circa 4 KB compresso) caricato con `defer`, e per i visitatori normali esegue poche righe e si ferma.

= Posso lasciarlo sul sito online? =

No, è pensato per il sito di prova. Quando il sito va online, disattiva ed elimina il plugin.

== External services ==

Il plugin carica dal server di **Approve by Heili** (https://approve.heili.cloud, o l'indirizzo scritto nelle impostazioni) il file `heili-review.js`. Il file non fa nulla per i visitatori normali. Quando la pagina viene aperta dal portale di revisione di Approve (indirizzo con `#heili-review=…`), il file mostra il pulsante di Heili e carica da Approve il pannello dei commenti; in quel caso Approve riceve l'indirizzo della pagina, l'elemento indicato dal cliente e le note che il cliente scrive. Nessun cookie e nessun valore dei campi dei moduli viene letto.

Il file è servito da https://approve.heili.cloud/heili-review.js, a nome di Approve by Heili.

== Changelog ==

= 1.1.0 =
* Pagina Impostazioni: stato della riga (attiva / spenta) e messaggio su cosa fare dopo il salvataggio.
* Sicurezza: controllo della capability anche nel salvataggio, validazione più stretta dell'indirizzo, escape su ogni valore stampato, `uninstall.php`.
* `readme.txt` standard e sezione «External services».
* Il tag chiede anche ai plugin di ottimizzazione di non spostarlo (`data-no-defer`).

= 1.0.0 =
* Prima versione.

== Upgrade Notice ==

= 1.1.0 =
Aggiornamento di sicurezza e di chiarezza della pagina Impostazioni. La chiave già salvata resta valida.
