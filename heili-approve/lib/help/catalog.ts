import type { ContentKind } from "@/app/generated/prisma/client";

export type HelpAudience = "agency" | "client";

export interface HelpStep {
  title: string;
  body: string;
}

export interface HelpTopic {
  id: string;
  audience: HelpAudience;
  title: string;
  summary: string;
  searchTerms: string[];
  kinds?: ContentKind[];
  routes: RegExp[];
  steps: HelpStep[];
}

const TOPICS: HelpTopic[] = [
  {
    id: "client-review-social",
    audience: "client",
    title: "Rivedere e approvare un post",
    summary: "Controlla anteprima, testo e data prima di dare la tua decisione.",
    searchTerms: ["come approvo", "approvare post", "rivedere post", "anteprima social", "facebook instagram linkedin"],
    kinds: ["SOCIAL_POST"],
    routes: [/\/posts\//],
    steps: [
      { title: "Guarda ogni rete", body: "Usa le schede sopra l’anteprima per controllare come cambia il post sulle reti previste." },
      { title: "Controlla tutto il contenuto", body: "Leggi la didascalia completa, la data prevista e scorri foto o video. Nei video puoi fermarti sul momento che vuoi segnalare." },
      { title: "Dai la tua decisione", body: "Se è tutto corretto scegli «Approva». Se serve un intervento, salva i commenti sul contenuto e scegli «Chiedi modifiche»: saranno inviati senza doverli riscrivere." },
    ],
  },
  {
    id: "client-plan",
    audience: "client",
    title: "Rivedere il piano del mese",
    summary: "Controlla insieme calendario, griglia e singoli post del mese.",
    searchTerms: ["piano mensile", "approva tutto", "calendario", "griglia instagram", "post del mese"],
    kinds: ["SOCIAL_POST"],
    routes: [/\/piani(?:\/|$)/],
    steps: [
      { title: "Leggi il riepilogo", body: "In cima trovi il messaggio dell’agenzia e lo stato complessivo del piano." },
      { title: "Apri i post da verificare", body: "Usa calendario e griglia per aprire ogni contenuto. Puoi approvare o chiedere modifiche al singolo post." },
      { title: "Conferma il piano", body: "«Approva tutto il piano» conferma insieme soltanto i contenuti ancora approvabili. Prima controlla che non restino note da inviare." },
    ],
  },
  {
    id: "client-blog",
    audience: "client",
    title: "Rivedere un articolo",
    summary: "Leggi l’articolo e collega le note esattamente alla frase interessata.",
    searchTerms: ["articolo blog", "commentare frase", "selezionare testo", "approvare articolo", "seo"],
    kinds: ["BLOG_ARTICLE"],
    routes: [/\/posts\//],
    steps: [
      { title: "Leggi la versione proposta", body: "Controlla titolo, immagine e corpo dell’articolo. Se è una nuova versione, apri anche «Cosa è cambiato»." },
      { title: "Commenta una frase", body: "Seleziona il passaggio interessato e usa «Commenta questa frase»: la nota resterà collegata a quel testo." },
      { title: "Concludi la revisione", body: "Approva se l’articolo è pronto; altrimenti salva i commenti sulle frasi e scegli «Chiedi modifiche», senza riscriverli." },
    ],
  },
  {
    id: "client-ads",
    audience: "client",
    title: "Valutare le creatività pubblicitarie",
    summary: "Confronta le varianti e registra una decisione per ciascuna.",
    searchTerms: ["ads", "pubblicità", "creatività", "variante", "scarta", "approva variante"],
    kinds: ["AD_CREATIVE"],
    routes: [/\/posts\//],
    steps: [
      { title: "Controlla le varianti", body: "Apri ogni variante e passa tra i posizionamenti per vedere immagini, video, testi e pulsante previsto." },
      { title: "Lascia note precise", body: "Tocca l’immagine oppure usa «Commenta a…» sul video. Così l’agenzia vede il punto o il momento esatto." },
      { title: "Decidi variante per variante", body: "Scegli «Approva variante» oppure «Scarta». Se scarti, spiega il motivo; poi invia le decisioni quando tutte le varianti sono complete." },
    ],
  },
  {
    id: "client-comments",
    audience: "client",
    title: "Scrivere una richiesta di modifica chiara",
    summary: "Indica cosa cambiare e dove, usando commenti e assistente di revisione.",
    searchTerms: ["commento", "modifica", "modifiche", "come chiedo una modifica", "non mi piace", "assistente", "aiuto feedback", "nota foto video secondo"],
    routes: [/\/posts\//],
    steps: [
      { title: "Indica il punto", body: "Su una foto tocca il punto interessato; su un video fermati sul secondo giusto; in un articolo seleziona la frase." },
      { title: "Descrivi il risultato che vuoi", body: "Scrivi cosa cambiare e, se puoi, perché: per esempio tono, colore, immagine, frase o invito all’azione." },
      { title: "Usa l’assistente se serve", body: "Apri «Parla con Heili» per scrivere o conversare a voce, anche interrompendo l’assistente. Controlla il riepilogo, poi invialo all’agenzia: parlare o preparare il riepilogo non invia una richiesta. «Detta il messaggio» trascrive soltanto nel campo di testo." },
    ],
  },
  {
    id: "agency-create-content",
    audience: "agency",
    title: "Creare e inviare un contenuto",
    summary: "Dalla bozza alla revisione del cliente, senza saltare i controlli.",
    searchTerms: ["nuovo contenuto", "creare post", "inviare revisione", "bozza", "pubblicare", "programmare"],
    routes: [/\/posts\/new(?:\/|$)/, /\/posts(?:\/|$)/],
    steps: [
      { title: "Scegli cliente e tipo", body: "Apri «Nuovo contenuto» e seleziona un servizio attivo per il cliente. Compila data e contenuti richiesti." },
      { title: "Verifica l’anteprima", body: "Controlla testo, media e anteprime. Correggi gli avvisi prima di inviare." },
      { title: "Invia e condividi", body: "Salva la bozza e usa «Invia in revisione». Nella stessa scheda compare subito «Link diretto per il cliente»: scegli il referente, copia il link oppure aprilo come cliente." },
    ],
  },
  {
    id: "agency-handle-feedback",
    audience: "agency",
    title: "Gestire commenti e modifiche richieste",
    summary: "Trova le note del cliente, prepara una nuova versione e reinviala.",
    searchTerms: ["commenti cliente", "modifiche richieste", "rispondere", "risolvi commento", "nuova versione", "assistente"],
    routes: [/\/posts\/[^/]+(?:\/|$)/],
    steps: [
      { title: "Apri la revisione", body: "Nella scheda del contenuto, la sezione «Revisione» raccoglie note, punti su immagini, momenti video e trascrizione dell’assistente." },
      { title: "Prepara la nuova versione", body: "Passa a «Modifica», applica le richieste e salva. Dopo il primo invio, i cambi al contenuto creano una nuova versione verificabile." },
      { title: "Chiudi e reinvia", body: "Risolvi i commenti completati e invia di nuovo in revisione. Il cliente approverà la nuova versione." },
    ],
  },
  {
    id: "agency-social",
    audience: "agency",
    title: "Portare un post social fino alla programmazione",
    summary: "Verifica reti e anteprime, raccogli l’approvazione e controlla l’esito Metricool.",
    searchTerms: ["social", "metricool", "programmare post", "errore programmazione", "approvazione post"],
    kinds: ["SOCIAL_POST"],
    routes: [/\/posts(?:\/|$)/, /\/calendar(?:\/|$)/],
    steps: [
      { title: "Controlla ogni rete", body: "Nella bozza verifica le anteprime e le opzioni specifiche di Instagram, Facebook, LinkedIn o delle altre reti selezionate." },
      { title: "Ottieni l’approvazione", body: "Invia il post in revisione. Se il cliente chiede modifiche, crea la nuova versione e reinviala prima di programmare." },
      { title: "Verifica la programmazione", body: "Con programmazione automatica, il post approvato passa a Metricool. Se compare «Fallito», apri la scheda, leggi l’errore e usa «Riprova» dopo averlo corretto." },
    ],
  },
  {
    id: "agency-blog",
    audience: "agency",
    title: "Preparare e consegnare un articolo",
    summary: "Scrivi, controlla SEO e commenti, poi esporta la versione approvata.",
    searchTerms: ["blog", "articolo", "seo", "markdown", "html", "wordpress", "esporta articolo"],
    kinds: ["BLOG_ARTICLE"],
    routes: [/\/posts(?:\/|$)/],
    steps: [
      { title: "Prepara testo e dati SEO", body: "Compila titolo, corpo, slug, meta description e immagine. Usa il pannello SEO come controllo prima dell’invio." },
      { title: "Gestisci le note sul testo", body: "La revisione mostra i commenti collegati alle frasi. Correggi l’articolo e verifica il confronto tra versioni." },
      { title: "Esporta la versione approvata", body: "Dopo l’approvazione scarica Markdown o HTML dalla scheda, pubblica sul sito e infine usa «Segna come pubblicato»." },
    ],
  },
  {
    id: "agency-ads",
    audience: "agency",
    title: "Preparare e consegnare le creatività ads",
    summary: "Costruisci le varianti, raccogli le decisioni e scarica il pacchetto finale.",
    searchTerms: ["ads", "creatività", "variante", "campagna", "zip", "google ads", "consegnare creatività"],
    kinds: ["AD_CREATIVE"],
    routes: [/\/posts(?:\/|$)/],
    steps: [
      { title: "Crea le varianti", body: "Inserisci dati campagna, media, copy, CTA, URL e posizionamenti. Controlla gli avvisi delle specifiche per ogni variante." },
      { title: "Leggi decisioni e commenti", body: "Il cliente approva o scarta ogni variante. Le note restano collegate alla variante, al punto dell’immagine o al momento del video." },
      { title: "Esporta ciò che è approvato", body: "Scarica il pacchetto ZIP dalla scheda: contiene le varianti approvate e i relativi copy. Dopo la consegna usa «Segna come consegnato»." },
    ],
  },
  {
    id: "agency-plans",
    audience: "agency",
    title: "Preparare il piano social del mese",
    summary: "Riunisci i post mensili e condividi un solo percorso di revisione.",
    searchTerms: ["piano social", "piano mensile", "mese", "griglia instagram", "invia piano"],
    kinds: ["SOCIAL_POST"],
    routes: [/\/plans(?:\/|$)/],
    steps: [
      { title: "Apri il mese del cliente", body: "Da «Piani» scegli cliente e mese. Aprire il piano non invia nulla: raccoglie i post social già preparati per quel mese." },
      { title: "Controlla gli stessi post", body: "Elenco, calendario e griglia sono tre viste degli stessi contenuti. I post creati dopo compaiono come «da aggiungere» e vengono inclusi automaticamente al prossimo invio." },
      { title: "Invia e copia il link", body: "Usa «Controlla e invia il piano», conferma i post e poi scegli il referente nel riquadro «Link diretto del piano» per copiarlo, aprirlo o preparare WhatsApp." },
    ],
  },
  {
    id: "agency-client-links",
    audience: "agency",
    title: "Gestire i link dei referenti cliente",
    summary: "Crea, copia, rinnova o disattiva un accesso personale al portale.",
    searchTerms: ["link cliente", "referente", "accesso cliente", "copia link", "nuovo link", "whatsapp"],
    routes: [/\/clients(?:\/|$)/, /\/posts\/[^/]+(?:\/|$)/, /\/plans\/[^/]+(?:\/|$)/],
    steps: [
      { title: "Trova il link dove lavori", body: "Nel post o nel piano già inviato trovi il link diretto sempre visibile. La scheda cliente raccoglie invece tutti i referenti e i relativi accessi generali." },
      { title: "Aggiungi la persona", body: "Inserisci il nome del referente. L’email è facoltativa: serve soltanto se vuoi inviare il link e le notifiche anche via email." },
      { title: "Scegli il referente", body: "Se ce n’è più di uno, scegli la persona prima di copiare o aprire il link. Il link è una chiave personale: se non deve più funzionare, disattivalo o generane uno nuovo." },
    ],
  },
  {
    id: "agency-import",
    audience: "agency",
    title: "Preparare importazioni da Excel",
    summary: "Configura una chiave personale per creare bozze tramite Codex o Claude.",
    searchTerms: ["excel", "importare", "importo excel", "dove importo excel con codex", "codex", "claude", "automazione", "api", "chiave automazione", "csv"],
    routes: [/\/settings(?:\/|$)/],
    steps: [
      { title: "Crea una chiave", body: "In «Impostazioni», nella sezione «Importa con Codex o Claude», assegna un nome riconoscibile e crea la chiave. La scadenza è fissata a 30 giorni." },
      { title: "Conservala subito", body: "La chiave completa viene mostrata una sola volta. Copiala nel gestore sicuro usato dall’agente, mai nel file Excel o nei messaggi condivisi." },
      { title: "Valida prima di importare", body: "Fai eseguire prima una validazione o un dry-run. L’importazione crea soltanto bozze: invio al cliente e pubblicazione restano azioni separate." },
    ],
  },
  {
    id: "agency-services",
    audience: "agency",
    title: "Attivare i servizi di un cliente",
    summary: "Decidi se il cliente usa post social, articoli, creatività o più servizi.",
    searchTerms: ["servizi cliente", "attivare social", "attivare blog", "attivare ads", "tipo contenuto"],
    routes: [/\/clients(?:\/|$)/],
    steps: [
      { title: "Apri la scheda cliente", body: "Da «Clienti» apri il cliente da configurare e modifica i suoi dati." },
      { title: "Seleziona i servizi", body: "Attiva Post social, Articoli o Creatività in base al lavoro concordato. Le nuove bozze possono usare solo i servizi attivi." },
      { title: "Salva e verifica", body: "Salva la scheda. I contenuti già esistenti restano visibili anche se in seguito disattivi un servizio." },
    ],
  },
];

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("it")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const QUERY_FILLERS = new Set([
  "a", "aiuto", "al", "alla", "che", "come", "con", "cosa", "da", "devo", "di", "dove", "e", "fare", "il", "in",
  "la", "le", "lo", "mi", "non", "per", "posso", "potete", "puoi", "riesco", "sapere", "serve", "si", "un", "una",
  "voglio", "vorrei",
]);

function matchesQuery(topic: HelpTopic, query: string): boolean {
  const normalized = normalize(query);
  if (!normalized) return true;
  const haystack = normalize([topic.title, topic.summary, ...topic.searchTerms, ...topic.steps.flatMap((step) => [step.title, step.body])].join(" "));
  if (haystack.includes(normalized)) return true;
  const words = normalized.split(" ").filter((word) => word.length > 1 && !QUERY_FILLERS.has(word));
  const haystackWords = haystack.split(" ");
  return words.length > 0 && words.every((word) =>
    haystack.includes(word) ||
    (word.length >= 5 && haystackWords.some((candidate) => candidate.length >= 5 && candidate.slice(0, 5) === word.slice(0, 5)))
  );
}

export function helpTopics({
  audience,
  services,
  query = "",
}: {
  audience: HelpAudience;
  services: readonly ContentKind[];
  query?: string;
}): HelpTopic[] {
  const allowed = new Set(services);
  return TOPICS.filter(
    (topic) => topic.audience === audience && (!topic.kinds || topic.kinds.some((kind) => allowed.has(kind))) && matchesQuery(topic, query)
  );
}

export function suggestedHelpTopics(topics: readonly HelpTopic[], pathname: string, limit = 3): HelpTopic[] {
  const contextual = topics.filter((topic) => topic.routes.some((route) => route.test(pathname)));
  return (contextual.length > 0 ? contextual : topics).slice(0, limit);
}
