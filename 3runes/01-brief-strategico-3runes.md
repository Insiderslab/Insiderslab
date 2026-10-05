# 3Runes — Brief strategico completo
### Rifacimento di 3runes.it · Strategia SEO e GEO · Landing geolocalizzate · Piano editoriale

| | |
|---|---|
| **Cliente / brand** | 3Runes (gruppo Finoti / InsidersLab) |
| **Dominio** | https://3runes.it |
| **Owner** | Stefano Finoti |
| **Esecuzione** | Account Claude "Assistente Web" + team web InsidersLab (Mandeep / Juan) |
| **Data brief** | 5 ottobre 2026 |
| **Go-live target** | lunedì 16 novembre 2026 ⚠️ DA CONFERMARE |
| **File collegati** | `data/landing-pages.csv` (75 pagine) · `data/piano-editoriale-blog.csv` (52 articoli) · `02-prompt-assistente-web.md` · `03-prompt-progetto-3runes.md` |

> **Fonte dei dati.** I volumi sono quelli di ricerca mensili in Italia (Ubersuggest, lingua IT, ottobre 2026).
> KD è la difficoltà SEO (0–100). `n.d.` = dato non disponibile. Il limite giornaliero
> di Ubersuggest si è esaurito durante la ricerca, quindi alcune celle vanno completate (vedi §13).
> Il sito attuale **non era raggiungibile** dal nostro ambiente di analisi (blocco di rete), quindi
> l'inventario dei contenuti esistenti è il **primo compito** dell'assistente (§12, fase 0).

---

## 0. Sintesi esecutiva

1. **Situazione attuale.** 3runes.it ha un'autorità di dominio di 9, 75 domini referenti e circa 106 backlink,
   ma **praticamente zero traffico organico**: nessuna keyword in top 100 stabile, circa 1 visita stimata
   al mese. Il crawler trova più di 270 URL (crawl ancora in corso al 5/10). C'è quindi un sito da migrare con attenzione (redirect 301),
   anche se non ha traffico da proteggere.
2. **Dove sta la domanda.** Ce n'è più di quanto si pensi, ma non dove ci si aspetta:
   - **"agenzia AI" non è una keyword di mercato.** "agenzia ai" ha volume 0 (è inquinata da un'agenzia immobiliare),
     "agenzia intelligenza artificiale" ha 30 ricerche al mese.
   - Le keyword commerciali AI reali sono altre:
     - **consulente/consulenza AI**: 210 + 210 al mese, più 140 + 140 per la variante "intelligenza artificiale";
     - **automazioni AI**: 140 + 110;
     - **chatbot WhatsApp**: 390 + 260;
     - **agenti AI**: 1.600, in forte crescita;
     - **intelligenza artificiale per aziende**: 140, con CPC di €16.
   - **La domanda SEO è enorme e facile.** "consulente seo" ha 2.900 ricerche al mese con KD 10. "agenzia seo" ne ha 1.300.
     A livello di città la domanda è reale (Milano 390 + 720, Roma 390 + 390, Torino 110 + 260, Trieste 140…).
   - **Nella GEO (AI search) siamo in anticipo sul mercato.** "geo seo" ha 480 ricerche, "ai seo" 480,
     "ai overview" 14.800, "ai mode google" 27.100, quest'ultima cresciuta di 50 volte in un anno.
   - **Sul blog vince la compliance.** "ai act" ha 12.100 ricerche e i long tail hanno KD tra 12 e 21.
3. **Le landing per città vanno fatte con criterio.**
   - **Per la SEO:** 25 città, con domanda verificata.
   - **Per la consulenza AI:** 14 città, in due fasi. I tool danno volume circa zero. Le pagine servono per
     le query conversazionali su ChatGPT e Maps e come landing per le campagne Ads.
   - **Per la formazione AI aziendale:** 3 città.
   - **Mai pagine "trova e sostituisci":** i competitor lo fanno e sono pagine deboli. Noi vinciamo con poche pagine vere.
4. **Il concept: "Tre rune, un sistema".** Le tre rune sono i tre pilastri:
   - ᛋ **Visibilità** (SEO + GEO);
   - ᚱ **Automazione** (workflow, agenti, chatbot);
   - ᚨ **Intelligenza** (consulenza, Dipartimento AI su Claude, formazione AI Act).

   Il sito è dark e premium, con un hero in WebGL dove le particelle formano le rune, scroll storytelling in
   GSAP e un "workflow vivo" animato. Le soglie di performance restano rispettate.
5. **Il piano editoriale.** 52 articoli in 6 mesi, il martedì e il giovedì alle 09:00, già pronti per essere
   programmati in WordPress. 4 pillar escono al go-live.

---

## 1. Stato attuale del sito (baseline)

| Metrica | Valore (ott 2026) | Obiettivo a 6 mesi | Obiettivo a 12 mesi |
|---|---|---|---|
| Domain Authority (Ubersuggest) | 9 | 15 | 20+ |
| Domini referenti / backlink | 75 / 106 | 110 | 160 |
| Keyword organiche posizionate (IT) | ~0 | 300 | 1.000+ |
| Keyword in top 10 | 0 | 25 | 80 |
| Traffico organico stimato/mese | ~1 | 1.500 | 5.000 |
| Lead organici/mese (form + call) | ⚠️ n.d. | 10 | 30 |
| Citazioni in risposte AI (ChatGPT/Perplexity/AI Overviews) su 30 prompt monitorati | ⚠️ da misurare | 5/30 | 12/30 |

**Prima di toccare qualsiasi cosa** l'assistente deve:
- fare un crawl completo del sito attuale (Screaming Frog o Ubersuggest Site Audit, che ha già trovato più di 270 URL (crawl ancora in corso al 5/10));
- esportare la lista delle URL, con title, H1 e status;
- verificare in Search Console impression e click degli ultimi 16 mesi;
- verificare quali URL ricevono i backlink, per conservarli con un 301.

Va poi prodotto il file `redirect-map.csv`, con una riga per ogni URL vecchia → URL nuova.

---

## 2. Posizionamento e offerta

### 2.1 Chi è 3Runes
3Runes è il brand di **AI automation, SEO e GEO** del gruppo InsidersLab (Udine / Torino). InsidersLab
resta l'agenzia "full service" (social, ads, siti, produzione). 3Runes è la **boutique specializzata**
che rende le aziende **trovabili** (Google + AI) e **automatiche** (agenti e workflow).

**Posizionamento in una frase:**
> *3Runes rende le PMI italiane visibili su Google e sulle AI generative e automatizza i loro processi
> con agenti AI su misura, misurando il risultato in ore risparmiate e lead generati.*

### 2.2 Target
| Segmento | Dolore | Porta d'ingresso |
|---|---|---|
| PMI 10–250 dipendenti (Nord Italia, focus FVG/Veneto/Piemonte/Lombardia) | "Facciamo tutto a mano, l'AI la usiamo a caso" | Diagnosi AI 360° → automazioni |
| Studi professionali (avvocati, commercialisti, consulenti) | Tempo perso su documenti e richieste ripetitive | AI per studi + Dipartimento AI su Claude |
| E-commerce e servizi locali | Poco traffico, dipendenza dalle ads | SEO + GEO + chatbot WhatsApp |
| Aziende obbligate dall'AI Act | Devono formare il personale (art. 4) | Formazione AI aziendale |
| Agenzie e web agency (white label) ⚠️ da validare | Non sanno vendere/erogare AI | Partner program |

### 2.3 Differenziatori (da dimostrare in pagina, non solo dichiarare)
1. **Tre competenze sotto lo stesso tetto.** I competitor fanno o SEO (Eskimoz, Studio Samo, Avantgrade) o AI
   (DNG Consulting, Undici, Aroundigital). Nessuno unisce SEO, GEO e automazioni operative.
2. **Prezzi trasparenti "a partire da".** Nessun competitor li pubblica, e sono citabili dalle AI.
3. **Metodo proprietario:** Diagnosi AI 360° (sito → lead → visibilità AI), Dipartimento AI su Claude, flussi agentici in loop.
4. **Casi reali del gruppo**, da usare solo dopo l'OK dei clienti: Ginial (consulenza energetica),
   Hair Extension Clinic (salone a Torino), InsidersLab (agenzia di circa 10 persone che lavora con 60+ skill AI).
5. **Presenza reale nel Nord-Est e a Torino.** I competitor locali usano pagine template e nessuno presidia Udine e il Friuli.

### 2.4 Catalogo servizi e prezzi "a partire da"
Prezzi dal listino InsidersLab. ⚠️ Ste deve confermare il posizionamento prezzo di 3Runes: standard o premium.

| Runa | Servizio | Prezzo pubblicato ("a partire da") |
|---|---|---|
| ᛋ Visibilità | SEO Base (on-page, 2 articoli/mese, report) | da €600/mese |
| ᛋ Visibilità | SEO Full + GEO (on/off-page, 4 articoli, GBP, link building, monitoraggio AI) | da €1.200/mese |
| ᛋ Visibilità | Audit SEO + GEO una tantum | ⚠️ da definire (proposta €490) |
| ᚱ Automazione | Setup automazioni AI / agente AI | da €1.200 una tantum |
| ᚱ Automazione | Gestione e ottimizzazione automazioni | da €250/mese |
| ᚱ Automazione | Chatbot WhatsApp / sito con AI | ⚠️ da definire (proposta da €1.500 + canone) |
| ᚨ Intelligenza | Consulenza AI strategica | €150/h · pacchetti giornata ⚠️ |
| ᚨ Intelligenza | Dipartimento AI su Claude (setup + skill su misura + formazione) | ⚠️ da definire |
| ᚨ Intelligenza | Formazione AI aziendale (AI literacy, art. 4 AI Act) | ⚠️ da definire (a sessione/azienda) |
| — | Diagnosi AI 360° "Runa Check" | **gratuita** (lead magnet) |

---

## 3. "3Runes Lab": quello che stiamo sviluppando
È la sezione `/lab/`, che mostra innovazione vera. Ogni progetto ha una card animata, uno stato
(Live / Beta / In arrivo) e una CTA "Voglio provarlo". ⚠️ Ste conferma nomi e stato di ciascuno.

| Progetto | Cosa fa | Stato proposto |
|---|---|---|
| **Runa Check: Diagnosi AI 360°** | Inserisci il dominio e ottieni un punteggio su Visibilità (SEO + presenza nelle risposte AI), Lead/funnel e Automazione, con un report via email | Live (lead magnet) |
| **Dipartimento AI su Claude** | Catalogo di skill aziendali installabili su Claude (contabilità, legale, SEO, social, ads, PM, HR, preventivi…). L'azienda ottiene un "team AI" con le sue procedure | Live |
| **Flussi agentici in loop** | Agenti che eseguono processi multi-step (diagnosi → report → proposta → task) e migliorano ciclo dopo ciclo, con checkpoint umani | Beta |
| **AI Visibility Monitor** | Monitoraggio mensile di come ChatGPT, Gemini, Perplexity e AI Overviews citano il brand rispetto ai competitor | Beta |
| **Agenti WhatsApp e CRM** | Agente che qualifica i lead, risponde H24, prenota appuntamenti e aggiorna il CRM (Clientify / Monday) | Live |
| **Call → Task** | Le call registrate (Fireflies) diventano automaticamente brief, action item e task su Monday | Live (uso interno) |
| **Content Engine** | Dalla keyword alla bozza SEO, alla revisione umana e alla programmazione su WordPress | Beta |

---

## 4. Architettura del sito (sitemap)

Struttura **hub & spoke**: 3 hub (le rune), le pagine servizio come pillar commerciali, le landing città
come figlie dei pillar e il blog che alimenta tutto con i link interni.

```
/                                   Home (agenzia intelligenza artificiale)
├── /visibilita/                    Hub ᛋ
│   ├── /agenzia-seo/               Pillar  → /agenzia-seo/{città}/   ×25
│   ├── /consulente-seo/
│   ├── /geo-seo/
│   ├── /seo-ecommerce/
│   └── /local-seo/
├── /automazione/                   Hub ᚱ
│   ├── /automazione-processi-aziendali/
│   ├── /agenti-ai/
│   ├── /chatbot-whatsapp/
│   ├── /chatbot-ai-aziende/
│   ├── /n8n/
│   └── /integrazione-crm-ai/
├── /intelligenza/                  Hub ᚨ (intelligenza artificiale per aziende)
│   ├── /consulente-ai/             Pillar  → /consulente-ai/{città}/  ×14 (2 fasi)
│   ├── /dipartimento-ai/
│   ├── /formazione-ai-aziende/     Pillar  → /formazione-ai-aziende/{città}/ ×3
│   └── /ai-per-pmi/
├── /settori/                       Hub settori
│   ├── /ai-per-studi-legali/   /ai-per-commercialisti/   /ai-per-immobiliari/
│   └── /ai-per-ecommerce/  /ai-per-manifattura/  /ai-per-saloni-e-centri-estetici/  /ai-per-energia-e-utility/
├── /diagnosi-ai/                   Runa Check (lead magnet)
├── /lab/                           Prodotti in sviluppo
├── /casi-studio/                   Archivio CPT "case study"
├── /prezzi/
├── /chi-siamo/
├── /contatti/
├── /blog/                          "Il Grimorio": categorie sotto
└── legali: /privacy-policy/ /cookie-policy/ /note-legali/
```

**Categorie del blog:** AI Act & Compliance · Agenti AI & Automazioni · ChatGPT, Claude & Prompt ·
SEO & GEO · AI per le aziende · AI per settori · Finanziamenti & Costi · Casi studio.

**Elenco completo con slug, H1, keyword, volumi e priorità:** `data/landing-pages.csv` (75 righe).

| Tipo | N. | Priorità |
|---|---|---|
| Home + hub + servizi + tool | 20 | P0/P1 |
| Istituzionali | 6 | P0 |
| Settori | 7 | P1 (legale, commercialisti) / P2 |
| Landing città SEO | 25 | 12 T1 (P0) + 13 T2 (P1) |
| Landing città consulente AI | 14 | 5 in fase 1 + 9 in fase 2 |
| Landing città formazione AI | 3 | P1 |

---

## 5. Concept creativo, design system e animazioni
### 5.1 Big idea — "Tre rune, un sistema"
Il nome 3Runes diventa il sistema di prodotto. Le rune erano un alfabeto: segni semplici che
racchiudevano un potere. Oggi l'alfabeto è l'AI. Ogni runa = un pilastro di servizio, con un
glifo dell'alfabeto Futhark antico, un colore e un'animazione propria.

| Runa | Glifo | Significato originale | Pilastro 3Runes | Promessa |
|---|---|---|---|---|
| **Sowilō** | ᛋ | Sole, luce, vittoria | **Visibilità** — SEO, Local SEO, GEO (AI search) | "Farvi trovare: su Google e dentro le risposte di ChatGPT." |
| **Raidō** | ᚱ | Viaggio, ruota, ritmo | **Automazione** — workflow n8n/Make, integrazioni CRM, agenti AI operativi | "Processi che girano da soli, 24/7." |
| **Ansuz** | ᚨ | Voce, sapere, ispirazione | **Intelligenza** — consulenza AI, Dipartimento AI su Claude, formazione e AI Act | "Il sapere della vostra azienda, trasformato in un team AI." |

Claim proposti (A/B test):
1. **"Tre rune. Un'azienda che lavora da sola."**
2. "Visibilità, automazione, intelligenza. Incise nel vostro business."
3. "L'AI che si vede nei numeri, non nelle slide."

Gioco di parole interno (da usare nel tech): **Three.js** per **Three Runes** → l'hero è letteralmente
costruito in Three.js.

### 5.2 Design system
- **Mood**: dark, premium, "laboratorio di alchimia digitale" — nero profondo, luce che incide
  la pietra, griglie tecniche sottili, tipografia monumentale. Riferimenti di livello:
  linear.app, vercel.com, resend.com, lusion.co, activetheory.net (come qualità del motion, non da copiare).
- **Colori (Global Colors Elementor, nomi semantici)**:
  - `Sfondo` #07080B (quasi nero) · `Sfondo Alt` #0E1016 · `Bordo` #1E2230
  - `Testo` #E9ECF2 · `Testo Chiaro` #9AA3B5
  - `Accento Sowilo` #F5B544 (oro-sole) · `Accento Raido` #4CE0C2 (verde-acqua elettrico) ·
    `Accento Ansuz` #8B7CFF (viola-lavanda)
  - `Primario` = gradiente dei tre accenti solo su elementi chiave (CTA, rune).
  - Verificare contrasto ≥ 4,5:1 di ogni accento su `Sfondo` per testo (gli accenti sono pensati
    per superarlo; se un tono non passa, usarlo solo per elementi grafici, non per testo).
- **Tipografia** (self-hosted, `font-display: swap`): Titoli **"Space Grotesk"** o **"Clash Display"**
  (verificare licenza) · Testo **"Inter"** · Dettagli tecnici/codice **"JetBrains Mono"**.
  Scala: 72/56/40/32/24/20/17/14 desktop; 44/36/30/24/20/18/16/14 mobile.
- **Elementi grafici**: rune disegnate come SVG a tratto singolo (stroke) per poterle "incidere"
  in animazione; texture pietra/rumore leggerissima (≤ 20 KB); griglia a punti; linee di
  connessione stile workflow.
- **Light mode**: non necessaria al lancio (brand dark). Rispettare comunque il contrasto.

### 5.3 Animazioni "wow" (con budget di performance)
| # | Dove | Effetto | Tecnologia | Fallback |
|---|---|---|---|---|
| A1 | Hero home | Campo di ~15k particelle che, allo scroll/mouse, si aggregano formando in sequenza ᛋ → ᚱ → ᚨ, poi il logo 3Runes. Il cursore "magnetizza" le particelle. | Three.js (InstancedMesh/Points + shader), caricato con `import()` dopo il primo paint | Video loop WebM 6–8 s, poi immagine statica se `prefers-reduced-motion` |
| A2 | Hero titoli | Testo che si "incide": SplitText per lettere con mask reveal + glow che scorre | GSAP SplitText | Testo statico |
| A3 | Sezione "Tre rune" | Scroll orizzontale pinnato: ogni runa si disegna (stroke-dashoffset), cambia il colore d'ambiente, compaiono servizi e KPI | GSAP ScrollTrigger + SVG | Tre card verticali |
| A4 | Automazioni | **Workflow vivo**: diagramma a nodi tipo n8n (Lead → CRM → Agente AI → WhatsApp → Calendario) con impulsi luminosi che viaggiano sui connettori; hover sul nodo = spiegazione | SVG + GSAP MotionPath | Diagramma statico |
| A5 | Intelligenza | **Terminale agente**: finta chat/terminal che "digita" un caso reale (es. "Prepara il preventivo per Rossi Srl" → l'agente esegue step) | JS leggero, testo reale | Screenshot |
| A6 | Numeri | Counter animati (ore risparmiate, lead generati, keyword in top 10) | GSAP | Numeri statici |
| A7 | Globale | Smooth scroll, cursore custom con alone, bottoni magnetici, transizioni di pagina con "rune wipe" | Lenis + GSAP (no su touch) | Comportamento nativo |
| A8 | Landing città | Mappa stilizzata dell'Italia a punti con la città che si accende e linee verso Udine/Torino | SVG + GSAP | Immagine |
| A9 | Lead magnet | **"Runa Check"**: tool gratuito che analizza dominio → punteggio Visibilità (SEO+AI), Automazione, Intelligenza | Form Elementor + webhook n8n + email report | — |

**Regole di performance per le animazioni**
- Three.js e GSAP caricati **solo** dove servono (enqueue condizionale nel child theme),
  in `defer`, dopo l'LCP. L'LCP della home deve essere il titolo H1 (testo), non il canvas.
- Canvas: `devicePixelRatio` max 1.5, pausa quando fuori viewport (`IntersectionObserver`)
  e quando la tab non è visibile; numero particelle ridotto su mobile (≤ 4k) o video fallback.
- `prefers-reduced-motion: reduce` → tutte le animazioni disattivate o ridotte a fade.
- Nessuna animazione blocca lo scroll o il click; INP < 200 ms verificato.
- Peso JS animazioni totale ≤ 250 KB gzip in home, ≤ 60 KB nelle landing città.

---

## 6. Homepage: struttura sezione per sezione

| # | Sezione | Contenuto | Animazione | CTA |
|---|---|---|---|---|
| 1 | **Header** sticky trasparente → blur on scroll | Logo · Visibilità · Automazione · Intelligenza · Lab · Casi · Prezzi · Blog · **[Runa Check gratuito]** | Hide on scroll down, show on scroll up | Prenota una call |
| 2 | **Hero** | H1: *"Agenzia di intelligenza artificiale per le aziende che vogliono farsi trovare e lavorare da sole"* (H1 SEO, il claim creativo va in sovra-titolo: "Tre rune. Un'azienda che lavora da sola.") · sottotitolo 1 riga · 2 CTA · 3 micro-proof (es. "60+ skill AI in produzione", "ore risparmiate", "aziende servite" ⚠️ dati reali) | A1 + A2 (particelle → rune) | **Fai il Runa Check gratuito** · Prenota 30 min |
| 3 | **Risposta breve (GEO)** | Blocco 50 parole "Cosa fa 3Runes": testo semplice, citabile dalle AI | Fade | — |
| 4 | **Le tre rune** | Scroll orizzontale pinnato: ᛋ Visibilità / ᚱ Automazione / ᚨ Intelligenza. Per ognuna: problema → cosa facciamo → 3 servizi → KPI tipico → link all'hub | A3 | "Scopri [runa]" |
| 5 | **Workflow vivo** | Esempio reale: "Un lead arriva alle 23:40. Ecco cosa succede." (form → agente qualifica → WhatsApp → CRM → appuntamento in calendario → report) | A4 | Voglio questo flusso |
| 6 | **Terminale agente** | Demo testuale di un agente che prepara un preventivo / un report SEO | A5 | Vedi il Dipartimento AI |
| 7 | **Numeri** | 4 counter con dati veri ⚠️ | A6 | — |
| 8 | **Casi studio** | Loop Grid 3 casi (problema → soluzione → risultato numerico) | Card tilt leggero | Tutti i casi |
| 9 | **3Runes Lab** | 4 card progetti (Live/Beta/In arrivo) | Glow on hover | Entra nel Lab |
| 10 | **Metodo in 4 passi** | Diagnosi → Progetto → Build → Ottimizzazione continua (con durate) | Linea che si disegna | — |
| 11 | **Prezzi "a partire da"** | 3 card (una per runa) + "su misura" | — | Vedi prezzi |
| 12 | **Dove lavoriamo** | Mappa Italia a punti: sedi Udine e Torino + città servite (link alle landing) | A8 | — |
| 13 | **FAQ** (schema FAQPage) | 6–8 domande vere (costi, tempi, sicurezza dati, AI Act, differenza vs freelance…) | Accordion | — |
| 14 | **Blog** | Ultimi 3 articoli (Loop Grid) | — | Vai al Grimorio |
| 15 | **CTA finale** | "Iniziamo dalla diagnosi. È gratuita." + form breve (nome, email, sito, esigenza) | Rune che si accendono | Invia |
| 16 | **Footer** | Dati societari reali (ragione sociale, P.IVA ⚠️), sedi, link legali, social, newsletter | — | — |

---

## 7. Template delle pagine (Theme Builder + ACF)

### 7.1 Pagina servizio (pillar)
1. Hero con H1 = keyword + promessa + CTA
2. **Risposta breve** di 40–60 parole (GEO)
3. Problemi che risolve (3–4)
4. Cosa include (deliverable concreti)
5. Come lavoriamo (step + tempi)
6. Casi d'uso / esempi per settore
7. Prezzo "a partire da" + cosa influisce sul prezzo
8. Caso studio collegato
9. FAQ (5–8) con schema FAQPage
10. Link alle città (solo nei pillar con landing città: sezione "Dove lavoriamo")
11. Articoli correlati (Loop Grid dalla categoria collegata)
12. CTA finale + form

### 7.2 Landing città: regole e contenuto minimo
**Implementazione:** pagine WordPress **figlie** del pillar (es. `/agenzia-seo/milano/` con genitore
`/agenzia-seo/`), un **unico template Elementor** "Single Page - Landing Città" con condizione
"figlia di" sui 3 pillar, e i contenuti locali in un gruppo di **campi ACF "Dati città"**:

| Campo ACF | Esempio (Milano) | Obbligatorio |
|---|---|---|
| `citta_nome`, `citta_regione`, `citta_provincia` | Milano, Lombardia, MI | ✅ |
| `intro_locale` (120–200 parole **uniche**) | Tessuto economico, distretti, settori trainanti, concorrenza digitale locale | ✅ |
| `settori_chiave` (3–5 voci con caso d'uso specifico) | Moda, design, fintech, servizi B2B… | ✅ |
| `faq_locali` (3–5 Q/A uniche) | "Lavorate on-site a Milano?" "Quanto costa la SEO per un'azienda milanese?" | ✅ |
| `modalita` | Remoto + incontri on-site su appuntamento / sede | ✅ |
| `caso_locale` (relazione con CPT case study) | se esiste | consigliato |
| `dati_ricerca` (es. "390 ricerche/mese per agenzia seo milano") | per la sezione "il mercato locale" | facoltativo |
| `citta_vicine` (link ad altre landing) | Monza, Bergamo, Brescia | ✅ |
| `geo_lat`, `geo_lng` | per mappa SVG | ✅ |

**Regole:** almeno il 40% di contenuto unico per pagina. Niente sedi finte: lo schema `LocalBusiness`
va **solo** su Udine e Torino ⚠️ indirizzi, sulle altre città si usa `Service` con `areaServed`.
Ogni landing linka il proprio pillar, 2–3 città vicine e 2 articoli del blog. Il pillar linka tutte le sue città.
Se dopo 6 mesi una landing T2 ha zero impression in GSC, va consolidata con un 301 al pillar.

**Title e meta (modello da personalizzare, non da copiare identico):**
- SEO: `Agenzia SEO a {Città} | SEO e GEO per PMI – 3Runes` · meta: "Agenzia e consulente SEO a {Città}: posizionamento su Google e nelle risposte AI. Audit gratuito, prezzi chiari da €600/mese."
- AI: `Consulente AI a {Città} | Automazioni e agenti AI – 3Runes`
- Formazione: `Corso intelligenza artificiale per aziende a {Città} | 3Runes`

### 7.3 Pagina settore
Hero di settore → i 5 processi più automatizzabili del settore → agenti / skill consigliati → ROI stimato
(ore/mese) → note di compliance di settore (deontologia, GDPR) → caso → FAQ → CTA.

### 7.4 Articolo blog ("Il Grimorio")
Indice sticky · tempo di lettura · autore con bio e foto (E-E-A-T) · data di aggiornamento ·
box "In breve" in testa · CTA contestuale a metà articolo (verso la landing collegata) · FAQ · articoli correlati.

### 7.5 Case study (CPT `caso_studio` + ACF)
Cliente · settore · città · problema · soluzione (runa) · stack · risultati numerici · citazione · durata.

---

## 8. Strategia SEO

### 8.1 Keyword research: head term per cluster (Italia, mensile)

| Cluster | Keyword | Vol | KD | CPC € | Pagina target |
|---|---|---|---|---|---|
| SEO | consulente seo | 2.900 | 10 | ~8,9 | /consulente-seo/ |
| SEO | agenzia seo | 1.300 | 30 | 13,9 | /agenzia-seo/ |
| SEO | consulente seo freelance | 590 | 10 | ~1,6 | /consulente-seo/ (sezione "freelance vs team") |
| SEO | miglior / migliore agenzia seo | 320 / 210 | 15 / 12 | 4,7 / 6,5 | /agenzia-seo/ |
| SEO | agenzia seo ecommerce | 210 | 11 | 11,3 | /seo-ecommerce/ |
| GEO | geo seo · ai seo | 480 · 480 | 21 · 26 | ~4,9 · ~15,5 | /geo-seo/ |
| GEO | generative engine optimization | 390 | 52 | ~8,6 | /geo-seo/ |
| AI | consulente ai · consulenza ai | 210 · 210 | 21 | 4,2 · 5,7 | /consulente-ai/ |
| AI | consulente / consulenza intelligenza artificiale | 140 · 140 | 27 · 22 | 7,1 · 12,3 | /consulente-ai/ |
| AI | intelligenza artificiale per aziende | 140 | 20 | ~16 | /intelligenza/ |
| AI | agenzia intelligenza artificiale | 30 | 28 | 3,6 | Home |
| Automazione | automazioni ai · automazione ai | 140 · 110 | 23 · 34 | 3,6 · 4,7 | /automazione/ |
| Automazione | automazione processi aziendali | 70 | 10 | ~4 | /automazione-processi-aziendali/ |
| Agenti | agenti ai · agente ai | 1.600 · 1.900 | 32 · 33 | ~3,7 | /agenti-ai/ + blog pillar |
| Agenti | creare agenti ai · n8n ai agent | 260 · 170 | 26 · 18 | 5,5 · 4,7 | /agenti-ai/ · /n8n/ |
| Chatbot | whatsapp chatbot · chatbot whatsapp | 390 · 260 | 18 · 25 | ~5,9 · 7,5 | /chatbot-whatsapp/ |
| Chatbot | chatbot per aziende | 30 | 21 | 14,4 | /chatbot-ai-aziende/ |
| Formazione | corso intelligenza artificiale per aziende | 40 | 13 | ~4,3 | /formazione-ai-aziende/ |
| Settori | intelligenza artificiale per avvocati | 590 | 21 | n.d. | /settori/ai-per-studi-legali/ |
| Settori | intelligenza artificiale per commercialisti | 170 | 42 | n.d. | /settori/ai-per-commercialisti/ |

**Trend:**
- "agenti ai" è passato da circa 800 a 3.600 ricerche al mese (picco a maggio 2026) e ora è stabile intorno a 1.600.
- "geo seo" è passato da 140 a 480–720.
- "ai mode google" è passato da 480 a 27.000–60.000.
- "n8n" è in calo del 70% sui volumi generici, ma resta interessante per i long tail in italiano.

### 8.2 Matrice città (volumi mensili verificati)

| Città | agenzia seo | consulente seo | corso IA | web agency* | Landing previste |
|---|---|---|---|---|---|
| Milano | 390 | 720 | 110 | 720 | SEO T1 · AI F1 · Formazione |
| Roma | 390 | 390 | 110 | 2.900 | SEO T1 · AI F1 · Formazione |
| Torino 🏢 | 110 | 260 | 90 | 590 | SEO T1 · AI F1 · Formazione |
| Udine 🏢 | n.d. | n.d. | 0 | 90 | SEO T1 · AI F1 (sede) |
| Trieste | n.d. | 140 | 0 | 40 | SEO T1 · AI F1 |
| Bologna | 140 | 170 | 0 | 260 | SEO T1 · AI F2 |
| Firenze | 110 | 210 | 20 | 210 | SEO T1 · AI F2 |
| Bari | 110 | 210 | 0 | 90 | SEO T1 |
| Padova | 110 | 70 | 10 | 260 | SEO T1 · AI F2 |
| Verona | 110 | 110 | 0 | 210 | SEO T1 · AI F2 |
| Bergamo | 110 | 110 | 0 | 210 | SEO T1 · AI F2 |
| Napoli | 90 | 140 | 0 | 480 | SEO T1 |
| Brescia | 70 | 140 | 10 | 260 | SEO T2 · AI F2 |
| Vicenza | 50 | 110 | 0 | 320 | SEO T2 · AI F2 |
| Treviso | n.d. | 110 | 0 | 170 | SEO T2 · AI F2 |
| Venezia | 30 | 110 | 0 | 110 | SEO T2 |
| Monza | 40 | 110 | 0 | 110 | SEO T2 |
| Lecco | 140 | n.d. | n.d. | n.d. | SEO T2 |
| Genova | 50 | 50 | 0 | 110 | SEO T2 |
| Catania · Cagliari · Palermo | 70 · 90 · 50 | 40 · 40 · 50 | 0 | 110 · 90 · 170 | SEO T2 |
| Modena · Parma | 30 · 20 | 70 · 50 | 0 | 210 · 90 | SEO T2 |
| Pordenone | n.d. | n.d. | n.d. | n.d. | SEO T2 · AI F2 (vicinanza alla sede) |

🏢 = sede reale. *"web agency" e "realizzazione siti web" per città hanno volumi alti (Roma 2.900, Milano 720,
Torino 590, Genova 590 per "realizzazione siti web"). **Non** le mettiamo su 3runes.it per non diluire il brand:
⚠️ **decisione di Ste**: farle su insiderslab.it in un progetto separato.

**Perché facciamo comunque le landing "consulente AI + città" anche se i tool danno 0:**
- le query AI sono sempre più conversazionali e locali ("consulente AI a Torino per PMI", fatte su ChatGPT e Google Maps)
  e non compaiono nei tool di keyword;
- servono come landing ad alto Quality Score per le campagne Google Ads locali, dove il CPC è alto (€7–16);
- presidiano il Nord-Est, dove non c'è nessun competitor.

Per questo sono **solo 5 in fase 1**, con contenuto vero. Le altre 9 si aprono quando c'è un caso o un cliente locale,
o un segnale in GSC.

### 8.3 Keyword map (regola: una keyword → una URL)
Il mapping completo è in `data/landing-pages.csv`. Regole contro la cannibalizzazione:
- `/agenzia-seo/` (agenzia, migliore agenzia) e `/consulente-seo/` (consulente, freelance, esperto) sono due intenti diversi.
  Le **città** invece li uniscono in una sola pagina (`/agenzia-seo/{città}/` targetizza "agenzia seo {città}" e "consulente seo {città}").
- L'hub `/intelligenza/` targetizza "intelligenza artificiale per aziende". L'articolo del blog sullo stesso tema ha un angolo diverso ("costi e primi passi").
- `/automazione-processi-aziendali/` (pagina commerciale) e l'articolo "da dove partire" (how-to) hanno intenti diversi e si linkano a vicenda.
- La home targetizza "agenzia intelligenza artificiale / agenzia AI": nessun'altra pagina usa questa keyword come principale.

### 8.4 Strategia GEO (visibilità nelle risposte AI)
1. **Blocchi "Risposta breve"** di 40–60 parole all'inizio di ogni pagina servizio e articolo.
2. **Entità chiare.**
   - Schema `Organization` con `sameAs` (LinkedIn, Instagram, Crunchbase, Google Business Profile), `founder` (Stefano Finoti) e `parentOrganization` (InsidersLab).
   - Schema `Person` per gli autori.
3. **Contenuti citabili.** Prezzi, tempi, tabelle comparative, dati originali (es. "Indice 3Runes di visibilità AI delle PMI del Nord-Est": una ricerca proprietaria da pubblicare ogni anno).
4. **Listicle onesti e confronti** (n8n vs Make vs Zapier, Claude vs ChatGPT, "come scegliere un'agenzia AI"): sono il formato più citato dagli LLM.
5. **`llms.txt`** nella root, con la descrizione del brand e i link alle pagine chiave.
   Il `robots.txt` **non** deve bloccare GPTBot, OAI-SearchBot, PerplexityBot, Google-Extended e ClaudeBot ⚠️ (decisione di Ste: consigliato consentire).
6. **Presenza esterna.** Schede su Clutch, Semrush Agencies, GoodFirms, directory italiane, Google Business Profile di Udine e Torino.
   Gli LLM citano queste fonti.
7. **Monitoraggio.** Un set di 30 prompt (es. "migliore agenzia SEO a Torino", "consulente AI Udine", "chi può creare un agente AI per la mia PMI")
   da testare ogni mese su ChatGPT, Gemini, Perplexity e AI Overviews, con un report di share of voice.

### 8.5 Local SEO
- **Google Business Profile** per le sedi reali (Udine, Torino ⚠️ indirizzi e verifica), categoria
  "Consulente di marketing" / "Servizio di ottimizzazione per i motori di ricerca", con i servizi elencati, post settimanali e foto vere.
- NAP (nome, indirizzo, telefono) coerente su sito, GBP e directory.
- Strategia per le recensioni: richiesta automatica a fine progetto (automazione n8n, a cui va dato il nostro stesso prodotto).

### 8.6 SEO tecnico
- Permalink `/%postname%/` per i post e slug senza date.
- Sitemap XML di Rank Math inviata a GSC.
- Canonical self-referencing. Archivi di tag e autore in `noindex` se sottili. Pagine allegato con redirect al file.
- Breadcrumb in tutte le pagine (schema BreadcrumbList).
- Immagini WebP/AVIF, font self-hosted, nessun plugin inutile. Soglie CWV come da prompt dell'assistente.
- Hreflang: non serve (solo italiano). ⚠️ Una versione inglese può essere una fase futura.
- Migrazione: `redirect-map.csv` con le 270+ URL attuali → 301 verso le nuove. Le URL che restano senza
  corrispondenza vanno sul pillar più vicino, mai tutte in home.

### 8.7 Link building (obiettivo: +35 domini referenti in 6 mesi)
| Tattica | Volume/mese | Note |
|---|---|---|
| Directory di agenzie (Clutch, GoodFirms, Semrush Agencies, Sortlist, DesignRush) | 3–4 | Utili anche per la GEO |
| Link dal gruppo (InsidersLab, Ginial, HEC, SIAMO Digital): link **contestuali**, non nel footer | 1–2 | Con il rapporto di gruppo dichiarato |
| Guest post / interviste su testate locali FVG e Piemonte, blog di settore (commercialisti, avvocati) | 1–2 | |
| Digital PR con dati proprietari (Indice visibilità AI PMI) | 1 ricerca/semestre | Link editoriali di valore |
| Eventi / workshop AI Act con Camere di Commercio, Confartigianato, Confindustria UD/TO | 1/trimestre | Link .it istituzionali |
| Podcast / webinar come ospite | 1 | |

### 8.8 Competitor (cosa fanno e come li battiamo)
| Competitor | Punto forte | Debolezza da sfruttare | Landing città |
|---|---|---|---|
| dngconsulting.it | Consulenza AI per PMI, sedi a Milano e Roma | Claim senza prove, nessun caso studio | Sì (Milano, Roma) |
| braincomputing.com | Pagine programmatiche AI × città (Torino inclusa) | Pagine stile doorway, poco contenuto | Sì, massicce |
| extra-web.it | Web agency con offerta AI | Pagine AI sottili e template | Sì |
| impesud.it | Blog tecnico su agentic AI | Scrive per sviluppatori, non per chi guida una PMI | Parziali |
| undici.tech · aroundigital.com | Posizionamento "agenzia AI Milano", AI Act | Solo Milano, pochi contenuti | Parziali |
| eskimoz.it · awisee.com | Brand SEO forti, landing città, listicle "migliori agenzie" | Template, nessuna automazione AI | Sì |
| avantgrade.com · studiosamo.it | Autorità storica SEO, GEO, formazione | Nessuna offerta di automazioni o agenti | No |

**Gap da sfruttare:**
- nessuno unisce SEO, GEO e automazioni;
- nessuno presidia il Nord-Est e il Friuli;
- nessuno pubblica prezzi;
- i long tail dell'AI Act orientati alle PMI sono quasi scoperti;
- non c'è una guida autorevole a n8n in italiano.

---

## 9. Piano editoriale blog (programmato in WordPress)

Il file completo è `data/piano-editoriale-blog.csv`. Contiene 52 articoli con data, ora, titolo, slug, keyword, volume, KD,
funnel, categoria, tipo, landing da linkare, lunghezza e note.

- **Ritmo:** 4 pillar al go-live (16/11/2026), poi **martedì e giovedì alle 09:00**, con pausa dal 21/12 al 6/1.
  Ultimo articolo il 18/05/2027.
- **Mix funnel:** 15 articoli TOFU (traffico: AI Act, AI Overview, AI Mode, prompt, agenti), 29 MOFU (confronti, guide, settori)
  e 8 BOFU (costi, checklist, casi studio).
- **Cluster:**

  | Cluster | Articoli |
  |---|---|
  | Agenti AI & Automazioni | 13 |
  | AI Act & Compliance | 9 |
  | SEO & GEO | 9 |
  | ChatGPT, Claude & Prompt | 7 |
  | AI per le aziende e settori | 7 |
  | Finanziamenti & Costi | 5 |
  | Casi studio | 2 |
- **Contenuti YMYL** (AI Act, leggi, bandi, Transizione 5.0): fonti ufficiali con link, data di verifica e disclaimer.
  Vanno ri-verificati alla data di pubblicazione, perché le norme cambiano. Ad esempio va controllato lo stato del
  "Digital Omnibus" UE sulle scadenze AI Act e della L. 132/2025 con i suoi decreti attuativi.
- **Lead magnet collegati:** PDF "50 prompt per aziende", "Checklist AI Act per PMI", template n8n scaricabili, Runa Check.
- **Riciclo:** ogni articolo diventa 1 carosello LinkedIn, 1 reel e 1 sezione della newsletter (coordinare con il team social).

---

## 10. Conversione e tracking

- **Conversioni GA4 (key events):** `generate_lead` (form), `runa_check_submit`, `book_call` (Calendly / Google Calendar), `click_whatsapp`, `click_tel`, `download_lead_magnet`.
- **CRM:** i form vanno via webhook a n8n e poi al CRM (Clientify ⚠️ o Monday), con notifica a Ste e sequenza email automatica (dogfooding: usiamo le nostre stesse automazioni).
- **Consent:** Iubenda + Consent Mode v2. Nessuno script di tracciamento prima del consenso.
- **Dashboard mensile:** traffico organico, keyword top 10, lead per canale, citazioni AI (share of voice), CWV.

---

## 11. KPI

| KPI | Mese 3 | Mese 6 | Mese 12 |
|---|---|---|---|
| Sessioni organiche/mese | 400 | 1.500 | 5.000 |
| Keyword top 10 | 8 | 25 | 80 |
| Landing città con impression > 0 | 50% | 85% | 95% |
| Lead qualificati/mese (tutti i canali sito) | 4 | 10 | 30 |
| Runa Check completati/mese | 15 | 40 | 100 |
| Citazioni AI su 30 prompt | 2 | 5 | 12 |
| PageSpeed mobile (home, pillar, landing) | ≥ 90 | ≥ 90 | ≥ 90 |

---

## 12. Roadmap

| Fase | Settimane | Output | Gate |
|---|---|---|---|
| 0. Inventario e baseline | 5–9 ott | Crawl, export GSC, inventario contenuti, `redirect-map.csv` bozza, dossier | Dossier creato |
| 1. Approvazione strategia | 12–16 ott | Sitemap e keyword map approvate da Ste, prezzi e Lab confermati | **Sitemap approvata** |
| 2. Design system e prototipo | 12–23 ott | Global colors/fonts, prototipo hero + "tre rune" in staging | Contrasto e performance del prototipo OK |
| 3. Copy | 19 ott–6 nov | Copy di home, hub, servizi P0, 12 landing SEO T1, 5 landing AI F1, istituzionali | Revisione grammaticale + QC |
| 4. Build in staging | 26 ott–11 nov | Theme Builder, template, ACF, pagine P0/P1, form + n8n, Runa Check | Gate build |
| 5. Blog | 26 ott–13 nov | 4 pillar pronti + i successivi 8 articoli in bozza, e tutti i 52 caricati come bozze/programmati | Revisione |
| 6. Performance e QA | 9–13 nov | CWV, accessibilità, cookie, tracking, redirect | **PUBBLICABILE** |
| 7. Go-live | **lun 16 nov** | Pubblicazione, 301 attivi, sitemap in GSC, 4 pillar online | Gate go-live |
| 8. Fase 2 landing | dic–gen | 13 landing SEO T2, 3 landing formazione, pagine settore | — |
| 9. Ottimizzazione continua | da dic | Report mensile, refresh contenuti, landing AI F2 se ci sono segnali, link building | — |

---

## 13. ⚠️ Da confermare con Ste (prima della fase 1)
1. Ragione sociale, P.IVA e indirizzi reali delle sedi (Udine, Torino) per footer, schema e GBP.
2. Posizionamento prezzo 3Runes (standard o premium) e prezzi di Dipartimento AI, formazione e chatbot.
3. Nomi e stato dei progetti del Lab. Quali casi studio possiamo pubblicare (Ginial, HEC) e con quali numeri.
4. Logo attuale: si tiene o si fa il rebrand con le tre rune? (Consigliato: logotipo nuovo con monogramma ᛋᚱᚨ.)
5. Web agency per città: su insiderslab.it (consigliato) o niente?
6. Hosting attuale di 3runes.it, accesso a staging, GSC e GA4.
7. CRM di destinazione dei lead (Clientify o Monday).
8. Consentire i crawler AI nel robots.txt (consigliato: sì).
9. Completare i volumi mancanti quando Ubersuggest ha di nuovo quota: agenzia seo Udine, Trieste, Treviso e Parma;
   pagine settore; SERP features / AI Overviews per le keyword P0.
