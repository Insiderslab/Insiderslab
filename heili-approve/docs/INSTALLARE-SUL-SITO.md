# Installare «Sul sito» — guida semplice

Questa guida spiega come far commentare a un cliente **il suo sito vero** (la versione di prova che avete fatto voi), con Heili. Non serve essere programmatori: basta poter modificare il sito o installare un plugin.

## Come funziona, in breve

1. In Approve crei un **«Sito web»** per il cliente: indirizzo del sito di prova e pagine da guardare.
2. Approve ti dà **una riga di codice** con la **chiave del sito** (inizia con `hs_`).
3. Metti quella riga nel sito di prova (o usi il plugin WordPress).
4. Premi **«Verifica installazione»**: deve comparire «Script trovato sul sito».
5. Invii in revisione. Il cliente apre il portale, tocca **«Apri il sito»**: il sito si apre con il pulsante di Heili in basso a destra. Tocca Heili, poi **«Indica un punto»**, tocca l'elemento e scrive la nota.
6. Il cliente **decide sempre dal portale** («Chiedi modifiche» o «Approva»), mai dentro il sito.
7. Quando il sito va online: **«Segna come pubblicato»**. La chiave viene revocata da sola. **Togli la riga di codice** (o il plugin).

Per i visitatori normali la riga **non fa nulla**: non legge cookie, non legge quello che le persone scrivono nei moduli, non manda dati. Si accende solo quando il sito viene aperto dal portale di Approve.

## Dove trovo la riga di codice

Apri il «Sito web» in Approve → in alto trovi il riquadro **«Sul sito»**:

- la riga da copiare (pulsante **«Copia la riga»**);
- la chiave da sola (**«Copia solo la chiave»**, serve per WordPress);
- gli **indirizzi consentiti**: lo script funziona solo su questi indirizzi, scritti esatti (per esempio `https://prova.cliente.it`). Niente asterischi. Se il sito di prova non ha https, devi spuntare **«È un sito di prova senza https»**;
- **«Verifica installazione»**.

La riga è fatta così (la chiave cambia per ogni sito):

```html
<script src="https://approve.heili.cloud/heili-review.js" data-site="hs_LA_TUA_CHIAVE" defer></script>
```

## Sito HTML, Next.js, Webflow, Shopify

Incolla la riga **subito prima di `</body>`**, in tutte le pagine (di solito c'è un modello comune).

- **HTML**: nel file del modello (es. `footer.html` o in fondo a ogni pagina), prima di `</body>`.
- **Next.js**: nel layout principale (`app/layout.tsx`), con il componente `Script` di Next o con un normale tag `<script ... defer>` prima della chiusura di `<body>`. Solo nell'ambiente di prova.
- **Webflow**: Impostazioni del sito → **Codice personalizzato** → **Codice nel footer** → incolla → Salva → **Pubblica** il sito di staging.
- **Shopify**: Negozio online → Temi → … → **Modifica codice** → `layout/theme.liquid` → incolla prima di `</body>` → Salva. Meglio su un tema non pubblicato (anteprima).

## WordPress, passo per passo

1. In Approve, riquadro «Sul sito» → **«scarica il plugin»** (file `heili-approve-review.zip`).
2. In WordPress: **Plugin → Aggiungi nuovo → Carica plugin** → scegli il file → **Installa ora** → **Attiva**.
3. Vai in **Impostazioni → Heili Approve**.
4. Incolla la **chiave del sito** (quella che inizia con `hs_`). L'indirizzo di Approve lascialo com'è.
5. **Salva**.
6. Se usi un plugin di cache (LiteSpeed, WP Rocket, Autoptimize…): **svuota la cache**.
7. Torna in Approve e premi **«Verifica installazione»**.

Il plugin aggiunge solo la riga in fondo alle pagine. Per spegnerlo senza disinstallarlo, svuota il campo della chiave.

## Google Tag Manager

1. Nel contenitore del sito di prova: **Tag → Nuovo → HTML personalizzato**.
2. Incolla la riga.
3. Attivatore: **All Pages** (tutte le pagine).
4. Salva e **Pubblica** il contenitore.

Attenzione: «Verifica installazione» legge l'HTML della pagina e non vede i tag aggiunti da Tag Manager. In questo caso spunta **«Non riesco a verificare… invia comunque»** dopo aver controllato tu, aprendo il sito dal portale, che compaia il pulsante di Heili.

## «Verifica installazione»: cosa vuol dire il risultato

- **Script trovato sul sito** → tutto a posto.
- **Lo script c'è ma con un'altra chiave** → hai copiato la riga di un altro sito: copiala di nuovo.
- **Non trovato** → la riga non c'è nella home: hai salvato? Hai svuotato la cache? Un plugin di ottimizzazione la sta togliendo?
- **Il sito chiede una password** → il sito di prova è protetto: Approve non può entrare a controllare. Spunta «Non riesco a verificare… invia comunque» (resta scritto nella storia del contenuto).
- **Indirizzo non consentito** → l'indirizzo punta a una rete privata o usa una porta strana: usa l'indirizzo pubblico del sito di prova.

## Il sito di prova è protetto da password

Per ora il cliente deve poter aprire il sito di prova (se c'è una password, gliela date voi come sempre). Approve non conserva password dei siti. La verifica automatica non funziona sui siti protetti: usa la conferma «invia comunque».

## Se il cliente non vede il pulsante di Heili

- Ha aperto il sito dal pulsante **«Apri il sito»** del portale? Il link dura **10 minuti** e vale **una volta sola**: se è scaduto, basta toccare di nuovo «Apri il sito».
- Il browser aziendale blocca gli script o gli iframe: il cliente può sempre scrivere le note **nel portale**.
- Il sito ha una **Content-Security-Policy**: va permesso `approve.heili.cloud` in `script-src` e `frame-src`.
- Il microfono non va: il sito può bloccarlo (`Permissions-Policy`). Si può sempre scrivere.

## Quando il sito va online: come si toglie

1. In Approve: **«Segna come pubblicato»**. La chiave viene **revocata**: da quel momento lo script non fa più nulla.
2. **Togli la riga** dal sito (o disattiva ed elimina il plugin WordPress, o elimina il tag in Tag Manager e pubblica).
3. Svuota la cache del sito.

Se serve rivedere di nuovo lo stesso sito prima di metterlo online, nel riquadro «Sul sito» c'è **«Crea una nuova chiave»**: poi aggiorna la riga sul sito e verifica di nuovo.
