# Installare «Sul sito» — guida semplice

Questa guida spiega come far commentare a un cliente **il suo sito vero** (la versione di prova che avete fatto voi), con Heili. Non serve essere programmatori: basta poter modificare il sito o installare un plugin.

## Come funziona, in breve

1. In Approve crei un **«Sito web»** per il cliente: indirizzo del sito di prova e pagine da guardare.
2. Approve ti dà **una riga di codice** con la **chiave del sito** (inizia con `hs_`).
3. Metti quella riga nel sito di prova (o usi il plugin WordPress).
4. Premi **«Verifica installazione»**: deve comparire «Script trovato sul sito» (se no, l'esito dice cosa fare).
5. Invii in revisione. Il cliente apre il portale, tocca **«Apri il sito»**: il sito si apre con il pulsante di Heili in basso a destra. Tocca Heili, poi **«Indica un punto»**, tocca l'elemento e scrive la nota.
6. Il cliente **decide sempre dal portale** («Chiedi modifiche» o «Approva»), mai dentro il sito.
7. Quando il sito va online: **«Segna come pubblicato»**. La chiave viene revocata da sola. **Togli la riga di codice** (o il plugin).

Per i visitatori normali la riga **non fa nulla**: non legge cookie, non legge quello che le persone scrivono nei moduli, non manda dati. Si accende solo quando il sito viene aperto dal portale di Approve.

## Dove trovo la riga di codice

Apri il «Sito web» in Approve → in alto trovi il riquadro **«Sul sito»**. In alto c'è sempre una frase che dice **cosa fare adesso** (per esempio «Passo 1: installa la riga sul sito di prova… Passo 2: premi «Verifica installazione»»). Poi, in ordine:

- **«Dove la metto?»**: cinque schede (**HTML**, **WordPress**, **Webflow**, **Shopify**, **Google Tag Manager**). Scegli come è fatto il sito di prova: ogni scheda ha **3 passi** e, dove serve incollare qualcosa, un pulsante **«Copia la riga»** o **«Copia la chiave»** (per WordPress, **«Scarica il plugin»**). La riga è anche in un riquadro selezionabile a mano;
- **«Indirizzi consentiti»**: lo script funziona solo su questi indirizzi, scritti esatti (per esempio `https://prova.cliente.it`). Niente asterischi. Se l'indirizzo del sito non è ancora consentito, in cima compare un pulsante **«Consenti …»**. Se il sito di prova non ha https, viene segnato come «sito di prova»;
- **«Verifica installazione»** con il suo esito in parole semplici (vedi sotto);
- **«Revoca la chiave»** (chiede una conferma).

La riga è fatta così (la chiave cambia per ogni sito):

```html
<script src="https://approve.heili.cloud/heili-review.js" data-site="hs_LA_TUA_CHIAVE" defer></script>
```

## I 3 passi, piattaforma per piattaforma

**HTML o Next.js**
1. Copia la riga.
2. Incollala nel codice del sito di prova, subito prima di `</body>`, in un punto che compaia in tutte le pagine (di solito il modello o il footer). Con Next.js: nel layout principale (`app/layout.tsx`).
3. Salva e pubblica il sito di prova, poi premi «Verifica installazione».

**WordPress (plugin)**
1. Scarica il plugin (`heili-approve-review.zip`).
2. In WordPress: **Plugin → Aggiungi nuovo → Carica plugin**, scegli il file, **Installa ora**, **Attiva**.
3. **Impostazioni → Heili Approve**: incolla la chiave del sito e premi **Salva**. L'indirizzo di Approve lascialo com'è.

Se usi un plugin di cache (LiteSpeed, WP Rocket, Autoptimize…): svuota la cache, poi premi «Verifica installazione». Il plugin aggiunge solo la riga in fondo alle pagine. Per spegnerlo senza disinstallarlo, svuota il campo della chiave. Il file viene dalla cartella `wordpress/` del repository (versione nel file e in `readme.txt`).

**Webflow**
1. Copia la riga.
2. **Impostazioni del sito → Codice personalizzato → Codice nel footer**: incolla e **Salva**.
3. **Pubblica** il sito (anche solo sull'indirizzo webflow.io), poi premi «Verifica installazione».

**Shopify**
1. Copia la riga.
2. **Negozio online → Temi → ⋯ → Modifica codice → `layout/theme.liquid`**: incolla subito prima di `</body>` e **Salva**.
3. Apri il sito dal portale per controllare che compaia il pulsante di Heili, poi premi «Verifica installazione».

Meglio lavorare su una copia del tema non pubblicata. «Verifica installazione» legge solo il tema **pubblicato**: se lavori su una copia, controlla tu aprendo il sito dal portale e spunta «Non riesco a verificare… invia comunque».

**Google Tag Manager**
1. Copia la riga.
2. **Tag → Nuovo → HTML personalizzato**: incolla la riga e scegli l'attivatore **All Pages** (tutte le pagine).
3. **Salva** e **Pubblica** il contenitore. Poi apri il sito dal portale e controlla che compaia il pulsante di Heili.

«Verifica installazione» legge l'HTML della pagina e non vede i tag aggiunti da Tag Manager: dopo aver controllato tu, spunta «Non riesco a verificare… invia comunque».

## «Verifica installazione»: cosa vuol dire il risultato

L'esito ha sempre un titolo (con una parola e un segno oltre al colore), una o due righe su **cosa fare** e, quando ha senso, il pulsante **«Verifica di nuovo»**.

**Trovato**
- **Script trovato sul sito** → tutto a posto: puoi inviare in revisione.

**Non trovato, o trovato ma sbagliato**
- **Script non trovato sul sito** → controlla di aver salvato e pubblicato il sito di prova; svuota la cache o il plugin di ottimizzazione; controlla che la riga sia nella pagina iniziale (la verifica legge quella). Se usi Tag Manager o un tema Shopify non pubblicato, la verifica non può vederla: controlla tu e spunta «invia comunque».
- **Lo script c'è ma con un'altra chiave** → sul sito c'è la riga di un altro sito o una chiave vecchia: copia di nuovo la riga da Approve e sostituiscila.
- **Lo script c'è ma senza chiave** → la riga sul sito è incompleta (manca `data-site="hs_…"`): copia di nuovo la riga intera.
- **Il sito chiede una password** → il sito di prova è protetto: Approve non può entrare. Apri tu il sito dal portale; se compare il pulsante di Heili, spunta «invia comunque» (resta scritto nella storia del contenuto).

**Sito non raggiungibile**
- **Il sito non si trova** → il nome del sito non esiste o non risponde: controlla di averlo scritto bene; se il sito è appena nato può servire qualche minuto.
- **Il sito non risponde in tempo** / **Il sito non risponde** → riprova tra poco; controlla che il sito sia online.
- **Il certificato del sito non è valido** → il lucchetto (https) ha un problema: va corretto sul sito.
- **Il sito reindirizza troppe volte** → controlla le regole di reindirizzamento (www, https).
- **Il sito risponde con un errore (404, 500…)** → controlla che l'indirizzo sia giusto e che la pagina si apra dal browser.
- **La pagina è troppo grande da controllare** → controlla tu e spunta «invia comunque».
- **Indirizzo non consentito** (https, porta, dominio pubblico, rete privata) → usa l'indirizzo pubblico del sito di prova.

## Il sito di prova è protetto da password

Per ora il cliente deve poter aprire il sito di prova (se c'è una password, gliela date voi come sempre). Approve non conserva password dei siti. La verifica automatica non funziona sui siti protetti: usa la conferma «invia comunque».

## Se il cliente non vede il pulsante di Heili

- Ha aperto il sito dal pulsante **«Apri il sito»** del portale? Il link dura **10 minuti** e vale **una volta sola**: se è scaduto, basta toccare di nuovo «Apri il sito».
- Se il pulsante di Heili ha un **«!» rosso**, toccalo: dice cosa non va e, se è un problema di rete, c'è **«Riprova»**. **Esc** chiude il pannello di Heili.
- Il browser aziendale blocca gli script o gli iframe: il cliente può sempre scrivere le note **nel portale**.
- Il sito ha una **Content-Security-Policy**: va permesso `approve.heili.cloud` in `script-src` e `frame-src`.
- Il microfono non va: il sito può bloccarlo (`Permissions-Policy`). Si può sempre scrivere.

## Quando il sito va online: come si toglie

1. In Approve: **«Segna come pubblicato»**. La chiave viene **revocata**: da quel momento lo script non fa più nulla.
2. **Togli la riga** dal sito (o disattiva ed elimina il plugin WordPress, o elimina il tag in Tag Manager e pubblica).
3. Svuota la cache del sito.

Se serve rivedere di nuovo lo stesso sito prima di metterlo online, nel riquadro «Sul sito» c'è **«Crea una nuova chiave»**: poi aggiorna la riga sul sito e verifica di nuovo.
