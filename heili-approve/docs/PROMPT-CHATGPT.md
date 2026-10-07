Sei un revisore senior di prodotto e di codice (UX/UI mobile, Next.js, TypeScript, sicurezza web). Ti allego lo ZIP del codice completo di **Approve by Heili**, una piattaforma con cui la nostra agenzia fa approvare ai clienti post social, articoli di blog, creatività ads e piani mensili social; i post approvati vengono programmati su Metricool.

Prima di tutto apri lo ZIP e leggi, in quest'ordine:
1. `docs/REVISIONE-CHATGPT.md` (cos'è l'app, mappa del codice, cosa ci interessa, limiti già noti);
2. `docs/CONTRATTO.md` e `docs/VARIANTI.md` (regole del progetto: sicurezza, versioni, italiano, design);
3. le schermate in `docs/screenshots/` (sono le schermate reali dell'app, desktop e telefono).

Poi fai la revisione con queste priorità:

**1. Visualizzazione del post, soprattutto da telefono (priorità massima).**
Analizza la pagina in cui il cliente rivede un post (`app/review/[token]/posts/[postId]/page.tsx`, `components/portal/post-review.tsx`, `components/post-preview/*`, `components/portal/comment-*.tsx`, `bottom-sheet.tsx`) e la scheda del post dell'agenzia (`app/(dashboard)/posts/[id]/page.tsx`, `components/posts/*`). Schermate utili: `04-cliente-post-mobile.png`, `08-cliente-reel-mobile.png`, `05-cliente-cosa-e-cambiato.png`, `piano-cliente-post-mobile.png`, `02-agenzia-editor-anteprime.png`, `09-agenzia-note-video.png`.
Dimmi cosa cambieresti per renderla più chiara, più veloce e più piacevole su uno schermo da 390 px: gerarchia, spazio dell'anteprima rispetto a testo e commenti, posizione e chiarezza dei pulsanti Approva / Chiedi modifiche, cambio di rete, caroselli, Reel con commento al secondo, lunghezza della pagina, didascalia, come il cliente capisce cosa deve fare. Proponi un layout concreto (descrizione a blocchi o wireframe testuale) e indica i componenti da modificare.

**2. UX/UI generale** di pannello agenzia e portale cliente, rispettando il design system Heili descritto nei documenti (calma, colore che significa qualcosa, stati sempre con parola, niente gradienti né emoji, mobile first, campi a 16 px, aree toccabili 44 px).

**3. Bug e casi limite** nei flussi: invio in revisione, approvazione legata alla versione, modifiche richieste, piano del mese e «Approva tutto il piano», programmazione Metricool (worker), link del cliente e referenti senza email.

**4. Sicurezza**: token del portale, isolamento tra workspace e clienti, azioni server, upload ed export, HTML degli articoli.

**5. Codice e prestazioni**: componenti troppo grandi, duplicazioni, query inefficienti, semplificazioni.

Regole per la risposta:
- Scrivi in italiano.
- Non riscrivere l'app: dammi un **elenco di interventi** ordinato per impatto, ognuno con: problema (con file e, se puoi, riga), perché conta, proposta concreta, priorità (Alta / Media / Bassa) e stima di sforzo (S / M / L).
- Separa le osservazioni **certe** (verificate leggendo il codice) da quelle **da verificare**.
- Non segnalare come nuovi i limiti già elencati in «Limiti noti» del documento di revisione, a meno che tu non abbia una soluzione precisa.
- Dove proponi codice, mostra solo il frammento necessario.
- Chiudi con i **5 interventi** che faresti per primi.
