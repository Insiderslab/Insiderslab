# DATI CLIENTE — InsidersLab

> Unico file che cambia da un'installazione all'altra. La SKILL.md resta identica.
> Per un'altra agenzia o un cliente: copia questo file e ricompilalo da zero.
> Dati ripresi dalle skill già in uso (`web-factory-insiderslab`, `hr-agent-insiderslab`,
> `vice-ste`, `business-administration`). Ciò che non è confermato è marcato ⚠️.

---

## ANAGRAFICA
- Ragione sociale: InsidersLab
- Settore: agenzia digitale (web, social, ads, AI)
- Sede / timezone: Italia / Europe/Rome — team distribuito IT, VE, IN
- Owner e decisore finale UX/UI: Ste (Stefano Finoti)

## TEAM — CHI RICEVE COSA DA QUESTA SKILL

| Persona | Ruolo nel flusso UX/UI | Riceve | Lingua dei materiali |
|---|---|---|---|
| Ste | Web Lead, approva direzione e priorità | Report audit, opzioni di direzione, verdetti | IT |
| Barbara Mastrangelo | Contenuti, interfaccia non tecnica col cliente | Domande al cliente, sintesi per il cliente | IT (messaggi team in ES) |
| Mandeep Kumar | Web dev Elementor | Spec di schermata e handoff eseguibili | EN |
| Juan | Web dev | Spec di schermata e handoff eseguibili | ⚠️ DA CONFERMARE (ES?) |
| Arianna Parino | Grafica | Note asset con misure, formato, punto focale | IT |
| Jose, Andreina | Grafica | Note asset con misure, formato, punto focale | ES |
| Mihir Dwivedi | Performance / Ads | Rilievi CRO e landing per campagne | EN |

Regola: il deliverable al **cliente finale** è in italiano (o nella lingua del suo mercato:
ES per Spagna/LATAM, EN internazionale). Le spec per il team sono nella lingua della persona.

## STRUMENTI IN USO
- Project management: Monday.com — board "Website Projects 2026" ID `5034591742`
- Creazione task: solo via `monday-task-creator` (preview + OK obbligatori)
- Stack web standard: WordPress + Elementor Pro (Theme Builder, Flexbox/Grid Containers,
  Global Colors/Fonts), Rank Math, Imagify — fonte: `web-factory-insiderslab/references/standard-stack.md`
- Design tool: ⚠️ DA CONFERMARE (Figma? Canva per asset social)
- Archivio: Google Drive, cartella del cliente
- Call registrate: Fireflies

## SOGLIE DI AGENZIA
- Performance siti WordPress: gate 6 di `web-factory-insiderslab` come minimo bloccante di
  go-live (PageSpeed mobile ≥ 85 su home e due template più visitati, LCP < 3,0 s,
  CLS < 0,15, INP < 300 ms). L'obiettivo UX della skill resta il "buono" Google
  (2,5 s / 200 ms / 0,1).
- Padding verticale di sezione standard: 96px desktop / 48px mobile
- Scala spaziature di agenzia — **sostituisce** quella di `design-system.md § 4` per i
  siti WordPress: 4 / 8 / 16 / 24 / 32 / 48 / 64 / 96 px
- Massimo due famiglie tipografiche, self-hosted, `font-display: swap`

## CONVENZIONI STACK
- Nomi dei Global Colors in Elementor (token semantici → nome): `Primario`,
  `Primario Scuro`, `Accento`, `Testo`, `Testo Chiaro`, `Sfondo`, `Sfondo Alt`, `Bordo`
- Formato spec per i siti WordPress: `spec-sezione.md` di `web-factory-insiderslab`
- Skill per creare task: `monday-task-creator` (preview + OK obbligatori)
- Strumento delle call registrate: Fireflies (`fireflies-processor`)

## BRAND / TONE OF VOICE INSIDERSLAB (quando il prodotto è nostro)
- Tone: ⚠️ DA CONFERMARE
- Colori/font: ⚠️ DA CONFERMARE

## CLIENTI — SCHEDE UX
Per ogni cliente su cui si lavora spesso, aggiungere qui (o in `references/cliente-[nome].md`,
o nella cartella Drive del cliente come "Scheda UX"). Serve a non richiedere due volte le
stesse informazioni:

| Cliente | Prodotto e superficie | Utenti principali | Task critici | Tu/Lei | Vincoli di brand | Design system (link) | Note |
|---|---|---|---|---|---|---|---|
| ___ | ___ | ___ | ___ | ___ | ___ | ___ | ___ |

Il design system del cliente vive in un documento principale; le eccezioni per singole
pagine si annotano a parte, con il motivo.

## REGISTRO DIREZIONI VISIVE
Ogni direzione approvata si registra qui. Prima di proporre una direzione si controlla che
la stessa coppia font/palette non sia già stata usata per un altro cliente.

| Data | Cliente | Direzione | Font | Palette (hex principali) | Approvata da |
|---|---|---|---|---|---|
| ___ | ___ | ___ | ___ | ___ | ___ |

## NOTE OPERATIVE SPECIFICHE
- Se il progetto è un sito WordPress/Elementor, la spec finale si traduce nel formato
  dell'agente 2 di `web-factory-insiderslab` (container, widget, note per la grafica).
- Barbara deve poter usare la skill: con lei niente gergo (non "IA", "affordance",
  "heuristic"), solo cosa cambia per l'utente del cliente.
