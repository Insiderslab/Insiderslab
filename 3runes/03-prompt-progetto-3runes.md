# Prompt di progetto: rifacimento 3runes.it

> **Come si usa.** Nell'account Claude "Assistente Web", che ha già il prompt di sistema
> `02-prompt-assistente-web.md`, crea un Progetto "3Runes — Rifacimento sito".
> 1. Carica come Knowledge questi file:
>    - `01-brief-strategico-3runes.md`
>    - `data/landing-pages.csv`
>    - `data/piano-editoriale-blog.csv`
> 2. Incolla il blocco qui sotto come **primo messaggio**.
> 3. L'assistente lavora per fasi e si ferma a ogni checkpoint per chiedere l'OK di Ste.

---

```text
# MISSIONE

Rifai da zero il sito https://3runes.it in WordPress e rendilo il sito di riferimento in Italia per
**SEO + GEO + automazioni AI** per le PMI. Il risultato deve essere:
1. innovativo e memorabile: concept "Tre rune, un sistema", dark premium, animazioni WebGL/GSAP di
   livello internazionale, ma con PageSpeed mobile ≥ 90;
2. una macchina SEO: architettura hub & spoke, landing geolocalizzate vere, blog programmato per 6 mesi;
3. una macchina di lead: Runa Check (diagnosi gratuita), CTA chiare, form collegati al CRM via n8n.

La strategia è GIÀ decisa nel brief `01-brief-strategico-3runes.md`: leggilo tutto prima di
iniziare e seguilo. Se trovi un motivo forte per cambiare qualcosa, proponilo a Ste con dati e
motivazione. Non cambiarlo in silenzio.

# INPUT DISPONIBILI

- Brief strategico (posizionamento, offerta, prezzi, Lab, sitemap, design system, animazioni,
  struttura della home, template, keyword research, matrice città, GEO, local SEO, link building,
  competitor, KPI, roadmap).
- `landing-pages.csv`: 75 pagine con tipo, URL, H1, keyword principale e secondarie, volume, tier,
  priorità e note. È la tua **keyword map**: una keyword corrisponde a una sola URL.
- `piano-editoriale-blog.csv`: 52 articoli con data e ora di pubblicazione, titolo, slug, keyword,
  categoria, landing da linkare, lunghezza e note.
- Stack e regole: prompt di sistema (Elementor Pro, Hello child, Rank Math, ACF Pro, Imagify,
  LiteSpeed/WP Rocket, Cloudflare, Iubenda, GA4/GTM).

# FASI, DELIVERABLE E CHECKPOINT

## FASE 0: Inventario e baseline (non toccare nulla in produzione)
1. Crawl completo del sito attuale: tutte le URL con status, title, H1, meta, canonical, indicizzabilità,
   pagine con backlink. Il primo audit ha trovato più di 270 URL (crawl ancora in corso al 5/10).
2. Export da Google Search Console degli ultimi 16 mesi (query e pagine) e GA4. Se non hai accesso,
   chiedi a Ste di concederlo.
3. Inventario dei contenuti: cosa si tiene, cosa si riscrive, cosa muore.
4. Prepara `redirect-map.csv` (vecchia URL → nuova URL → motivo). Nessuna URL resta senza destinazione,
   e non si manda tutto in home.
5. Crea il **Dossier — 3Runes.md** con stato attuale, accessi, decisioni e rischi.
6. Compila la lista "⚠️ Da confermare" del brief (§13) e mandala a Ste in UN unico messaggio.
→ **CHECKPOINT 0**: Ste risponde ai punti da confermare.

## FASE 1: Architettura e approvazione
1. Conferma la sitemap del brief §4, aggiornandola con le decisioni del checkpoint 0.
2. Per ogni pagina P0/P1 del CSV: slug definitivo, title (≤ 60 caratteri), meta description (≤ 155),
   H1, keyword principale e secondarie, link interni in uscita e in entrata.
3. Lista dei template Theme Builder (naming `[TIPO] - [Ambito] - [Variante]`):
   - Header - Globale
   - Header - Landing
   - Footer - Globale
   - Single Page - Servizio
   - Single Page - Landing Città
   - Single Page - Settore
   - Single Post - Blog
   - Archive - Blog
   - Archive - Casi studio
   - Single - Caso studio
   - 404
   - Search
   - Popup - Runa Check
   - Popup - Exit intent lead magnet
→ **CHECKPOINT 1**: **approvazione esplicita della sitemap** da parte di Ste. Senza questa non scrivi copy.

## FASE 2: Design system e prototipo "wow"
1. Kit Elementor:
   - Global Colors con nomi semantici: Sfondo, Sfondo Alt, Bordo, Testo, Testo Chiaro,
     Accento Sowilo, Accento Raido, Accento Ansuz;
   - Global Fonts self-hosted;
   - scala tipografica e spacing scale (vedi brief §5.2);
   - verifica del contrasto ≥ 4,5:1 per tutto il testo.
2. Rune ᛋ ᚱ ᚨ in SVG a tratto singolo, più il monogramma del logo ⚠️ se Ste approva il rebrand.
3. Prototipo in staging di: hero WebGL (A1 + A2), scroll orizzontale "Tre rune" (A3) e "workflow vivo" (A4).
   Come implementarli:
   - codice nel child theme, in `/assets/js/` modulare;
   - enqueue condizionale per pagina;
   - Three.js e GSAP con import dinamico dopo l'LCP;
   - `prefers-reduced-motion` gestito;
   - pausa del canvas quando è fuori viewport;
   - fallback statico o video.
4. Misura il prototipo con PageSpeed mobile e WebPageTest. Riporta LCP, INP, CLS e peso del JS.
→ **CHECKPOINT 2**: Ste vede il prototipo (link staging + video registrato) e approva la direzione.

## FASE 3: Copy SEO
1. Scrivi in italiano, nell'ordine:
   1. home
   2. 3 hub
   3. servizi P0
   4. 12 landing SEO T1
   5. 5 landing "consulente AI" fase 1
   6. pagine istituzionali
   7. Runa Check
   Poi i P1.
2. Ogni pagina segue il template del brief §7. Vanno sempre inclusi:
   - "Risposta breve" di 40–60 parole all'inizio;
   - FAQ vere;
   - prezzo "a partire da";
   - CTA;
   - link interni.
3. **Landing città.**
   - Almeno il 40% di contenuto unico: intro locale, settori trainanti, 3–5 casi d'uso specifici,
     FAQ locali, città vicine.
   - Compila i campi ACF "Dati città". Vietato il trova-e-sostituisci.
   - Mai sedi finte: lo schema LocalBusiness va solo su Udine e Torino.
   - Per le altre città scrivi "lavoriamo con aziende di {Città} da remoto e on-site su appuntamento".
4. Tono: autorevole, concreto, zero buzzword vuote. Ogni affermazione è supportata da un numero,
   un esempio o un caso. Niente promesse di posizionamenti garantiti.
5. Passa tutto il copy in revisione grammaticale (grammatica italiana marketing) prima del build.
→ **CHECKPOINT 3**: Ste approva il copy di home, di un servizio e di una landing città campione.
  Poi procedi a cascata sulle altre pagine.

## FASE 4: Build in staging
1. Hello Elementor child, solo Flexbox/Grid Containers, Global Colors/Fonts, Loop Grid per gli elenchi,
   tutti i template in Theme Builder.
2. ACF Pro:
   - gruppo "Dati città" (vedi brief §7.2), assegnato alle pagine figlie di /agenzia-seo/,
     /consulente-ai/ e /formazione-ai-aziende/;
   - CPT `caso_studio` con i suoi campi;
   - CPT `progetto_lab` (stato Live/Beta/In arrivo).
3. Crea le pagine dal CSV (P0 e P1) come **bozze**. Per le landing città imposta il genitore corretto,
   così le URL diventano /agenzia-seo/milano/ e simili.
4. Rank Math, per ogni pagina:
   - title e meta;
   - focus keyword;
   - schema: Organization e ProfessionalService sul sito, Service sulle pagine servizio e città,
     LocalBusiness solo sulle sedi reali, FAQPage, BreadcrumbList, Article sul blog;
   - Redirections, con l'import di `redirect-map.csv`;
   - 404 Monitor.
5. Form (Elementor Pro Forms) collegati via webhook a n8n:
   - i dati vanno al CRM ⚠️ (Clientify o Monday);
   - notifica a Ste;
   - email di conferma;
   - per il Runa Check, il report automatico.
   Checkbox privacy non pre-spuntata.
6. File `llms.txt` nella root. Il robots.txt consente i crawler AI (se Ste conferma).
7. Esporta il Kit Elementor e salvalo nel Drive del progetto.
→ **CHECKPOINT 4**: link staging + checklist del gate build.

## FASE 5: Blog programmato in WordPress
1. Crea le categorie del brief §4 e l'autore "Stefano Finoti" con bio e foto (E-E-A-T).
   ⚠️ Altri autori se Ste li indica.
2. Per ogni riga di `piano-editoriale-blog.csv` (52 articoli):
   1. Brief: keyword, intento, struttura H2/H3, fonti ufficiali, link interni (sempre alla
      `landing_da_linkare` più 2 articoli correlati), CTA.
   2. Articolo completo nella lunghezza indicata, con box "In breve", FAQ e immagine in evidenza
      1200×630 con alt text.
   3. Revisione grammaticale. Per i temi YMYL (AI Act, leggi, bandi, Transizione 5.0, prezzi di terzi)
      ri-verifica le fonti alla data di scrittura, cita i link ufficiali e aggiungi il disclaimer.
   4. Caricamento in WordPress:
      - `status = future`, `date` = data_pubblicazione + ora 09:00 Europe/Rome;
      - slug, categoria e tag;
      - Rank Math: title, description, focus keyword e schema Article.
      I 4 articoli del 16/11/2026 escono con il go-live.
3. Ordine di lavoro: prima i 12 articoli fino a metà dicembre (pronti prima del go-live), poi lotti da 8.
   Tutti i 52 vanno caricati come **programmati** o, se non ancora revisionati, come **bozze**,
   con data impostata e il tag interno `da-revisionare`.
4. Se il go-live slitta, sposta in blocco tutte le date mantenendo l'ordine e il ritmo martedì/giovedì.
5. Metodo tecnico, in ordine di preferenza:
   1. connettore MCP WordPress del sito;
   2. REST API `/wp-json/wp/v2/posts` con Application Password;
   3. WP-CLI `wp post create --post_status=future --post_date="AAAA-MM-GG 09:00:00"`.
→ **CHECKPOINT 5**: Ste approva i primi 4 pillar. Gli altri sono autorizzati in blocco secondo il piano,
  salvo i temi YMYL, che richiedono sempre un OK.

## FASE 6: Performance, QA e compliance (gate bloccante)
Verifica le soglie del prompt di sistema. Verdetto: PUBBLICABILE, DA CORREGGERE o BLOCCATO.
Le pagine da misurare sono home, un pillar, una landing città e un articolo.
Bloccanti:
- cookie che non bloccano gli script prima del consenso;
- privacy o cookie policy mancanti;
- form non funzionanti;
- redirect mancanti;
- problemi di accessibilità AA;
- staging indicizzabile;
- sito in noindex.
Testa le animazioni su: un Android di fascia media (throttling 4x), Safari iOS, Firefox, tastiera e
`prefers-reduced-motion`.
→ **CHECKPOINT 6**: report QA a Ste e OK al go-live.

## FASE 7: Go-live (lunedì 16/11/2026, salvo slittamento approvato)
1. Backup completo.
2. Pubblicazione.
3. Verifica dei 301 uno per uno in produzione.
4. Invio della sitemap in GSC e richiesta di indicizzazione per home, hub, pillar e landing T1.
5. GA4 e Consent Mode che ricevono dati.
6. Monitor 404 attivo.
7. Staging bloccato.
8. Google Business Profile di Udine e Torino aggiornati con il nuovo sito.
9. Iscrizione alle directory (Clutch, GoodFirms, Semrush Agencies, Sortlist).

## FASE 8: Dopo il lancio
- **Settimane 1–2:** controllo errori GSC, copertura e CWV di campo.
- **Dicembre–gennaio:**
  - 13 landing SEO T2;
  - 3 landing formazione;
  - pagine settore (prima legale e commercialisti);
  - landing "consulente AI" fase 2 solo con un caso o cliente locale, o un segnale in GSC.
- **Ogni mese**, report a Ste con:
  - traffico, keyword in top 10 e lead;
  - citazioni AI sui 30 prompt di monitoraggio (ChatGPT, Gemini, Perplexity, AI Overviews);
  - CWV;
  - 3 azioni del mese successivo.
- **Ogni trimestre:**
  - refresh degli articoli che perdono posizioni;
  - aggiornamento dei contenuti normativi;
  - consolidamento con 301 delle landing a zero impression dopo 6 mesi.

# REGOLE DURE PER QUESTO PROGETTO

1. Una keyword corrisponde a una URL. Prima di creare una pagina controlla la keyword map: niente cannibalizzazione.
2. Nessuna landing città senza contenuto unico reale. Meglio 10 pagine vere che 100 doorway.
3. Nessun dato inventato: numeri, clienti, recensioni, premi e certificazioni vanno solo se confermati
   da Ste. Dove manca il dato metti un placeholder `⚠️ DA CONFERMARE`, visibile solo in bozza.
4. Le animazioni non possono mai peggiorare LCP, INP o accessibilità. Se c'è un conflitto, vince la performance.
5. Il lavoro si fa in staging. In produzione si pubblica solo dopo il checkpoint.
6. Alla fine di ogni fase aggiorna il Dossier e invia a Ste un riepilogo breve con:
   - cosa è fatto;
   - cosa manca;
   - rischi;
   - la prossima azione, con l'owner.

# PRIMO MESSAGGIO CHE MI ASPETTO DA TE

Conferma di aver letto brief e CSV. Poi dammi:
(a) il piano operativo della Fase 0, con gli accessi che ti servono;
(b) l'elenco consolidato dei punti "⚠️ Da confermare";
(c) eventuali rischi o incongruenze che vedi nella strategia, ciascuno con una proposta.
Non iniziare build o copy prima del Checkpoint 1.
```
