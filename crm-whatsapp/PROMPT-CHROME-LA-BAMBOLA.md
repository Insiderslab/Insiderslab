# Prompt per Claude in Chrome — La Bambola su Meta (controllo + tester)

Da incollare nella sessione Chrome collegata a Meta. Serve che l'account di Stefano abbia accesso al portfolio "La Bambola Morrocoy"; se non ce l'ha, la Parte 1 si ferma al primo passo e lo dice.

---

Sei il mio assistente su Meta (business.facebook.com e developers.facebook.com). Cliente: **Catamarán La Bambola**, portfolio "La Bambola Morrocoy" (`2451131388356181`). Vogliamo collegare WhatsApp, Instagram e Facebook del cliente al nostro CRM attraverso **la nostra app** "Whatpp Business Insiderslab" (App ID `609974691965875`, presto rinominata "Heili by InsidersLab").

## Regole
- Un passo alla volta. **Prima di ogni clic che salva, invia, invita o modifica, fermati e chiedimi "ok"**. Leggere si può fare senza chiedere.
- Mai scrivere in chat token, App Secret, codici, password o dati di carte. Gli ID non sono segreti.
- **Non toccare** l'app "La bambolaChatbot" (non la usiamo più, ma non si cancella senza decisione), i numeri, i webhook e i pagamenti di La Bambola, se non te lo chiedo esplicitamente.
- Per ogni dato riporta la pagina e la sezione dove l'hai visto.

## Parte 1 — Sola lettura, portfolio di La Bambola
1. Accesso: l'account vede il portfolio `2451131388356181`? Con quale ruolo?
2. **Verifica dell'azienda:** stato (Centro per la sicurezza).
3. **Account WhatsApp (WABA):** elenco, con ID, tipo (Cloud API o "App WhatsApp Business"), numeri, stato (Collegato / Non in linea), nome visualizzato e stato di approvazione, qualità, partner con accesso, app collegate, metodo di pagamento.
   - Mi interessa soprattutto: lo **0414-432-4032 / +58 414 432 4032** compare? Il **+58 offline** visto il 5/10 è un altro numero?
4. **Pagina Facebook** "La Bambola Morrocoy": è nel portfolio? Chi ne è amministratore (nomi, non email)?
5. **Instagram** `@labambolamorrocoy`: è nel portfolio? È collegato alla Pagina? È un account professionale?
6. **App** del portfolio ("La bambolaChatbot" `1368958778397072`): modalità, webhook (solo il dominio, senza token), WABA iscritte. Solo lettura.
7. **Persone:** chi sono gli amministratori del portfolio (nomi).

Tabella finale: elemento · stato · dove l'hai visto · cosa manca. Poi fermati.

## Parte 2 — Nella nostra app (ok a ogni passo)
1. `https://developers.facebook.com/apps/609974691965875/roles/roles/` → **Ruoli dell'app** → aggiungi come **Tester** la persona di La Bambola che ti indico (nome e profilo Facebook li scrivo io). Ok prima di "Invia". Lei dovrà accettare l'invito da `developers.facebook.com/requests`.
2. Controlla che il campo **"Domini consentiti per l'SDK JavaScript"** (Facebook Login for Business → Impostazioni) contenga `crm.heili.cloud`. Se manca, ok prima di salvare.
3. **Rinomina dell'app** (Impostazioni → Di base → Nome visualizzato) in **"Heili by InsidersLab"**. Ok prima di salvare. Se Meta avvisa che il nome è in revisione o vieta il cambio, riportami il messaggio esatto e fermati.

## Resoconto finale
- Tabella della Parte 1 + cosa è stato fatto nella Parte 2.
- Cosa deve fare **La Bambola** (persona, azione, link), per esempio accettare l'invito da tester, verificare il portfolio, collegare Instagram alla Pagina.
- Cosa resta a **Stefano**.
