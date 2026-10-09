# Microcopy e UX writing — italiano (e note ES/EN)

Le parole di un'interfaccia sono design: segnaletica per chi la attraversa. Si scrivono
insieme ai wireframe, non dopo. Il testo definitivo passa poi da
`grammatica-italiana-marketing`; il copy di marketing lungo non è compito di questa skill.

## 1. Regole base

| Regola | ✅ Sì | ❌ No |
|---|---|---|
| Parole dell'utente, non del sistema | "Le tue notifiche" | "Configurazione webhook" |
| Bottone = verbo + oggetto, dice cosa succede | "Salva modifiche", "Richiedi preventivo" | "Invia", "Ok", "Submit", "Clicca qui" |
| Stessa azione, stesso nome per tutto il flusso | "Pubblica" → toast "Pubblicato" | "Pubblica" → "Contenuto inviato con successo" |
| Maiuscola solo a inizio frase (anche in titoli e bottoni) | "Crea un nuovo progetto" | "Crea Un Nuovo Progetto" |
| Frasi brevi, una informazione per elemento | "Password di almeno 8 caratteri" | Paragrafo di regole sopra il campo |
| Voce attiva | "Abbiamo inviato il codice a m***@gmail.com" | "Il codice è stato inviato" |
| Concreto, non vendita, dentro il prodotto | "Esporta in Excel" | "Sblocca il potere dei tuoi dati" |
| Un'etichetta per intenzione, sempre la stessa | "Contattaci" ovunque | "Contattaci", "Parliamone", "Scrivici" per la stessa azione |
| Niente verbi vuoti | "Riduci i tempi di consegna" | "Eleva", "rivoluziona", "senza soluzione di continuità" |
| Stato in corso con i puntini di sospensione (carattere unico) | "Salvataggio…" | "Salvataggio..." o "Attendere prego" |
| Niente anglicismi superflui se esiste la parola italiana usata dall'utente | "Accedi", "Carrello", "Impostazioni" | "Login", "Cart", "Settings" (salvo pubblico che li usa davvero) |

**Tu o Lei**: si decide una volta per prodotto e si scrive nella scheda cliente. B2C e
prodotti digitali di solito "tu"; professioni regolate, banche, sanità, pubblico senior
spesso "Lei". Mai misti nella stessa interfaccia.

**Genere**: preferire forme neutre quando è facile ("Ti diamo il benvenuto" invece di
"Benvenuto/a"; "Chi si iscrive riceve…").

## 2. Messaggi di errore — formula

**Cosa è successo + perché (se utile) + come risolvere.** Accanto al campo, in testo
(non solo colore), senza colpa, senza scuse vaghe, senza codici tecnici in primo piano.

| Situazione | ✅ | ❌ |
|---|---|---|
| Formato email | "Manca la @ nell'indirizzo email" | "Email non valida" |
| Campo obbligatorio | "Inserisci il CAP per calcolare la spedizione" | "Campo obbligatorio" |
| Pagamento rifiutato | "La carta è stata rifiutata dalla banca. Prova un'altra carta o PayPal" | "Errore 402" |
| Rete | "Connessione persa. Le modifiche sono salvate sul dispositivo: riproviamo appena torni online" | "Ops! Qualcosa è andato storto 😕" |
| Server | "Non riusciamo a caricare gli ordini. Riprova tra qualche minuto; se continua, scrivici a ___" | "Errore imprevisto" |

## 3. Stati vuoti

Uno stato vuoto è un invito ad agire: **cosa comparirà qui + perché è utile + azione per
iniziare**. Per i risultati di ricerca vuoti: ripetere cosa si è cercato, suggerire
correzioni o filtri da togliere, offrire un'alternativa.

> "Qui vedrai le fatture dei tuoi clienti. Crea la prima per tenere traccia dei pagamenti.
> [Crea fattura]"

## 4. Conferme e azioni distruttive

- Preferire **Annulla** dopo l'azione a una finestra "Sei sicuro?" prima.
- Se serve conferma, il bottone ripete l'azione e l'oggetto: "Elimina 3 progetti", non "Sì".
- Il bottone distruttivo non è mai quello predefinito né il più evidente.

## 5. Lunghezze ed espansione

- Il testo tradotto si allunga: IT→DE fino a +30%, EN→IT/ES +15–25%. Bottoni e menu si
  progettano con margine o con la lingua più lunga.
- Titoli ≤ 60 caratteri, bottoni ≤ 25, voci di menu 1–2 parole.
- Numeri, date e valute nel formato del mercato: 1.234,56 € · 09/10/2026 o 9 ottobre 2026
  per l'Italia; mai il formato USA per utenti italiani.

## 6. Dati realistici nei mockup

Nomi, indirizzi, prezzi e numeri plausibili per il mercato (nomi italiani vari, CAP veri,
prezzi con decimali credibili). Niente "Acme", niente 99,99%, niente lorem ipsum: un dato
finto troppo perfetto nasconde i problemi di layout che il dato vero farà emergere.

## 7. Spagnolo e inglese (quando il mercato lo chiede)

- ES: "tú" per prodotti consumer, "usted" in contesti formali o per alcuni mercati LATAM;
  attenzione alle varianti (ordenador/computadora, móvil/celular): si sceglie in base al
  mercato principale.
- EN: sentence case, verbi semplici, niente gergo interno.
