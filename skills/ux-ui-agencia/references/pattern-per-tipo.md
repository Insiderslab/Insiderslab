# Pattern per tipo di prodotto

Si carica dopo aver identificato il tipo di prodotto. Ogni sezione dà: task critici di
default (da confermare col brief), regole specifiche, errori che vediamo più spesso.

## Indice
1. Sito vetrina e landing page
2. E-commerce
3. SaaS, piattaforme e dashboard
4. App mobile
5. Onboarding
6. Form lunghi, preventivi e configuratori
7. Ricerca, filtri e tabelle
8. Modali, notifiche e toast

---

## 1. Sito vetrina e landing page

**Task critici di default**: capire l'offerta in 5 secondi · trovare prova che sia
affidabile · contattare / prenotare / chiedere preventivo da mobile.

- Hero: cosa è, per chi, azione. Headline concreta (beneficio o risultato), non slogan.
  Sta nel primo schermo: titolo al massimo su 2 righe, sottotitolo entro ~20 parole, una
  CTA primaria e al massimo una secondaria.
- **Una** CTA primaria ripetuta dove serve; la secondaria è visivamente subordinata.
- Prova sociale accanto al punto di decisione (recensioni con nome e fonte, loghi clienti,
  numeri verificabili), non solo in una pagina "Testimonianze".
- Landing per campagne: una sola azione, menu ridotto o assente, messaggio coerente con
  l'annuncio (stessa promessa, stessa immagine), form corto sopra la piega su mobile.
- Contatti: telefono e WhatsApp cliccabili, indirizzo con mappa, orari aggiornati.
- **Errori frequenti**: slider in hero; tre CTA equivalenti; form con 10 campi per una
  richiesta di contatto; testo grigio chiaro su foto.

## 2. E-commerce

**Task critici di default**: trovare un prodotto (ricerca o categoria) · valutarlo
(foto, prezzo, varianti, disponibilità, spedizione) · comprare da mobile come ospite.

- **Costo totale presto**: spese di spedizione, IVA e tempi visibili in scheda prodotto o
  nel carrello, non scoperti all'ultimo passo (i costi inattesi sono la prima causa di
  abbandono nelle ricerche pubbliche Baymard).
- **Checkout come ospite** sempre disponibile; la registrazione si offre dopo l'acquisto
  (l'account obbligatorio è tra le prime cause di abbandono).
- Un checkout ben fatto sta intorno a 12–14 elementi di form in tutto (stima pubblica
  Baymard): ogni campo in più va giustificato.
- Pochi campi: nome completo in un campo dove possibile, indirizzo con autocompletamento,
  fatturazione = spedizione preselezionato, CAP → città automatica. Campi fiscali italiani
  (codice fiscale, P.IVA, SDI/PEC) solo quando si chiede fattura.
- Scheda prodotto: foto grandi con zoom, varianti con disponibilità visibile prima di
  sceglierle, taglie con guida, prezzo e IVA chiari, resi in una riga vicino al bottone.
- Listing: filtri pertinenti al catalogo (non generici), conteggio risultati, filtri attivi
  visibili e rimovibili, ordinamento, nessun reset della posizione tornando indietro.
- Carrello: modifica quantità e rimozione con annulla, codice sconto non in primo piano
  (un campo vuoto invita ad andare a cercare un codice altrove).
- Pagamenti: metodi mostrati prima del checkout; wallet (Apple/Google Pay, PayPal) in alto.
- **Errori frequenti**: account obbligatorio; errori di form che cancellano i dati della
  carta; CAP non validato; immagini prodotto piccole su mobile.

## 3. SaaS, piattaforme e dashboard

**Task critici di default**: arrivare al primo valore (attivazione) · svolgere il task
ricorrente principale · trovare e capire un dato · gestire account e fatturazione.

- **Gerarchia dei dati**: in alto le 3–5 metriche che guidano decisioni, con confronto
  (vs periodo precedente, vs obiettivo); sotto il dettaglio. Una dashboard che mostra tutto
  non dice niente.
- Ogni grafico risponde a una domanda scritta nel titolo ("Le vendite crescono?" o
  "Vendite ultimi 30 giorni vs mese precedente"). Per i grafici si usa la skill `dataviz`.
  Regole minime: andamento → linee, confronto → barre, mai torta oltre 5 categorie,
  etichette dirette o legenda sempre visibile, alternativa in tabella.
- Niente "hero metric" decorativa (numero gigante + sparkline) se il numero non guida
  una decisione.
- Numeri: cifre tabulari (`font-variant-numeric: tabular-nums`), allineati a destra nelle
  tabelle, stessa unità e precisione per colonna, formato italiano.
- Densità regolabile solo se gli utenti la chiedono; di default leggibilità.
- **Tabelle**: intestazioni fisse, ordinamento, filtri, selezione multipla con azioni di
  massa, paginazione o caricamento progressivo con conteggio totale, colonne prioritarie su
  mobile (o vista a schede).
- **Stati**: ogni vista ha primo utilizzo, vuoto, caricamento (skeleton), errore, parziale,
  permessi mancanti.
- Navigazione: sidebar con voci stabili; la posizione corrente sempre evidente; impostazioni
  separate dal lavoro quotidiano.
- Azioni lunghe (import, export, report): asincrone con notifica, mai uno spinner che blocca.
- Ruoli e permessi: ciò che l'utente non può fare si spiega ("Solo gli amministratori
  possono…"), non si nasconde senza motivo.
- **Errori frequenti**: dashboard come vetrina di grafici; filtri che si azzerano cambiando
  pagina; azioni distruttive senza annulla; nessuna vista vuota progettata.

## 4. App mobile

**Task critici di default**: completare l'azione principale con una mano · riprendere da
dove si era rimasti · capire notifiche e stati.

- Target ≥ 44×44 pt (iOS) / 48×48 dp (Android); spaziatura tra target ≥ 8 pt.
- Zona del pollice: azioni frequenti in basso; azioni distruttive lontane da quelle frequenti.
- Navigazione principale in tab bar in basso, 3–5 voci con icona **e** etichetta.
- Gesti (swipe, long press) sempre con alternativa visibile.
- Testo dinamico supportato; nessun testo sotto 11 pt (iOS) / 12 sp (Android) e corpo
  ≥ 16 pt/sp.
- Permessi chiesti nel momento in cui servono, con spiegazione prima del popup di sistema.
- Offline e reti lente: contenuti in cache, azioni in coda, stato della connessione visibile.
- Rispettare le convenzioni della piattaforma (back su Android, swipe-back su iOS).

## 5. Onboarding

- Obiettivo: **tempo al primo valore** il più basso possibile. Si misura.
- Chiedere solo ciò che serve per il primo valore; il resto dopo (profilazione progressiva).
- Niente tour di 8 schermate prima di usare il prodotto: meglio suggerimenti contestuali
  al primo incontro con una funzione, e checklist di attivazione con progresso visibile.
- Dati di esempio o template al posto di schermate vuote.
- Login: social o magic link dove sensato; password con mostra/nascondi, incolla consentito,
  gestori password funzionanti.

## 6. Form lunghi, preventivi e configuratori

- Dividere in passi solo se i gruppi sono naturali; mostrare passo corrente e totale.
- Salvataggio automatico e possibilità di riprendere.
- Riepilogo modificabile prima dell'invio.
- Prezzo o stima che si aggiorna mentre si configura, se il modello lo consente.
- Domande condizionali: mostrare solo ciò che è pertinente alle risposte precedenti.
- Conferma finale con cosa succede adesso, entro quando, e come contattare.

## 7. Ricerca, filtri e tabelle

- Ricerca tollerante (errori di battitura, sinonimi, plurali), suggerimenti mentre si
  scrive, risultati recenti.
- Filtri: applicazione immediata su desktop, "Mostra N risultati" su mobile; filtri attivi
  sempre visibili come chip rimovibili.
- Stato di ricerca e filtri nell'URL, così il tasto indietro e la condivisione funzionano.

## 8. Modali, notifiche e toast

- Modale solo per decisioni che bloccano il flusso; chiusura con X, Esc e click fuori
  (tranne quando si perdono dati), focus intrappolato dentro e restituito all'apertura.
- Mai modali all'ingresso del sito (newsletter, sconti) prima che l'utente abbia visto il
  contenuto; su mobile coprono tutto e penalizzano anche la SEO.
- Toast: brevi, con azione di annulla quando ha senso, persistenti abbastanza da leggerli
  (o fino a chiusura se contengono un'azione), annunciati con `aria-live`.
- Notifiche push/email: ognuna con un motivo per l'utente; preferenze granulari.
