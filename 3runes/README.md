# 3Runes: kit di progetto (rifacimento sito, SEO, landing, blog)

| File | A cosa serve |
|---|---|
| [`00-PROMPT-PER-JUAN.md`](00-PROMPT-PER-JUAN.md) | **Da passare a Juan**: istruzioni di setup + prompt da incollare in Claude (in spagnolo) |
| [`01-brief-strategico-3runes.md`](01-brief-strategico-3runes.md) | Brief completo: baseline, posizionamento, servizi e prezzi, Lab, sitemap, concept "Tre rune", design system e animazioni, struttura della home, template, keyword research, matrice città, GEO, local SEO, link building, competitor, piano editoriale, KPI, roadmap, punti da confermare |
| [`02-prompt-assistente-web.md`](02-prompt-assistente-web.md) | Prompt di sistema per l'account Claude "Assistente Web" che gestisce tutti i siti WordPress del gruppo |
| [`03-prompt-progetto-3runes.md`](03-prompt-progetto-3runes.md) | Prompt operativo del progetto 3Runes: fasi, deliverable, checkpoint, regole |
| [`data/landing-pages.csv`](data/landing-pages.csv) | 75 pagine: URL, H1, keyword, volumi, tier, priorità. È la keyword map |
| [`data/piano-editoriale-blog.csv`](data/piano-editoriale-blog.csv) | 52 articoli con data e ora di pubblicazione (16/11/2026 → 18/05/2027), keyword, categoria, landing da linkare |

**Ordine d'uso:**
1. Ste legge il brief e risponde ai punti del §13.
2. Si incolla il prompt 02 come istruzioni dell'account Assistente Web.
3. Si crea il progetto con brief e CSV come knowledge.
4. Si incolla il prompt 03 come primo messaggio.

Dati keyword: Ubersuggest (Italia, ottobre 2026). Alcune celle sono `n.d.` perché è finita la quota giornaliera: vedi brief §13.
