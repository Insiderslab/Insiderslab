# Insiders Cockpit: mod per Claude Code

La mod aggiunge due cose all'interfaccia di Claude Code.

## 1. Le mie chat: chi aspetta te, chi sta lavorando

Si apre con `/chats` o con il primo pulsante della barra (`🔴 2 aspettano te · 🟢 3 al lavoro`).

Le chat cloud sono divise in gruppi, ognuna con un link per aprirla:

- 🔴 **Aspettano una tua risposta**: c'è una domanda o un permesso da approvare, e la riga dice quale.
- ⚠️ **Si sono bloccate per un errore**
- 🟢 **Stanno lavorando**: la riga dice cosa stanno facendo.
- 🟡 **Pronte da rivedere**
- ✓ **Finite di recente** (le ultime 5)

Il pallino ● indica una chat con novità non lette. L'elenco si aggiorna ogni minuto. Quando una chat inizia ad aspettarti compare una notifica a comparsa.

Funziona nelle sessioni cloud (claude.ai/code e l'app), dove è disponibile il server `claude-code-remote`.

## 2. Barra dati sempre visibile (sopra il prompt)

`🕒 19:42 · Contesto 12% · Costo $0.84 · Limite 5h 34% · Turni 6 · Ultimo 42s · ⎇ branch`

- Si aggiorna ogni 30 secondi e alla fine di ogni risposta.
- Il contesto diventa rosso oltre l'85%: è il momento di fare `/compact` o di aprire una chat nuova.
- Pulsanti: **Chat** apre il pannello, **Aggiorna** ricarica i dati, **Nascondi** nasconde la barra (`/cockpit` la fa ricomparire).
- La status line mostra anche `ctx 12% · $0.84`.

## 3. Pannello "Chat con Claude"

Si apre con `/chat` o con il pulsante **Chat** nella barra.

- Pulsanti rapidi che avviano subito una conversazione: *Briefing di oggi*, *Cosa faccio ora?*, *Riassumi la chat*, *Dammi un parere*.
- Campo di testo: scrivi e premi Invio. Su mobile c'è solo la riga dei pulsanti.
- Sotto compare l'ultima risposta di Claude.

## Installazione

Nelle sessioni cloud su questo repository si carica da sola dalla cartella `.claude/skills/insiders-cockpit/`.


Da un terminale con Claude Code:

```
/plugin install insiders-cockpit --marketplace Insiderslab/Insiderslab
```

Rispondi `y` per aggiungere il marketplace, poi scegli lo scope *user*.

Per lo sviluppo: `claude --plugin-dir .claude/skills/insiders-cockpit`

## Verifica

```
claude plugin validate .claude/skills/insiders-cockpit
claude plugin test .claude/skills/insiders-cockpit
```
