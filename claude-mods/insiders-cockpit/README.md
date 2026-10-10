# Insiders Cockpit: mod per Claude Code

La mod aggiunge due cose all'interfaccia di Claude Code.

## 1. Barra dati sempre visibile (sopra il prompt)

`🕒 19:42 · Contesto 12% · Costo $0.84 · Limite 5h 34% · Turni 6 · Ultimo 42s · ⎇ branch`

- Si aggiorna ogni 30 secondi e alla fine di ogni risposta.
- Il contesto diventa rosso oltre l'85%: è il momento di fare `/compact` o di aprire una chat nuova.
- Pulsanti: **Chat** apre il pannello, **Aggiorna** ricarica i dati, **Nascondi** nasconde la barra (`/cockpit` la fa ricomparire).
- La status line mostra anche `ctx 12% · $0.84`.

## 2. Pannello "Chat con Claude"

Si apre con `/chat` o con il pulsante **Chat** nella barra.

- Pulsanti rapidi che avviano subito una conversazione: *Briefing di oggi*, *Cosa faccio ora?*, *Riassumi la chat*, *Dammi un parere*.
- Campo di testo: scrivi e premi Invio. Su mobile c'è solo la riga dei pulsanti.
- Sotto compare l'ultima risposta di Claude.

## Installazione

Da un terminale con Claude Code:

```
/plugin install insiders-cockpit --marketplace Insiderslab/Insiderslab
```

Rispondi `y` per aggiungere il marketplace, poi scegli lo scope *user*.

Per lo sviluppo: `claude --plugin-dir claude-mods/insiders-cockpit`

## Verifica

```
claude plugin validate claude-mods/insiders-cockpit
claude plugin test claude-mods/insiders-cockpit
```
