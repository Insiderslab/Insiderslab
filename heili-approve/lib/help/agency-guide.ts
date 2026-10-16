/**
 * The agency's «Guida» page (/guida): the path from the first client to the
 * scheduled post, in short steps that each link to the page where it is done,
 * plus a few frequent questions. Only what the app really does; steps about
 * Metricool and the monthly plan appear only when social posts are enabled.
 * docs/GUIDA-RAPIDA.md is the same guide as a document to send around.
 */

import type { ContentKind } from "@/app/generated/prisma/client";

export interface GuideLink {
  label: string;
  href: string;
}

export interface GuideStep {
  id: string;
  title: string;
  /** Two or three short lines. */
  body: string;
  links: GuideLink[];
}

export interface GuideQuestion {
  id: string;
  question: string;
  answer: string;
}

export function agencyGuideSteps(kinds: readonly ContentKind[]): GuideStep[] {
  const social = kinds.includes("SOCIAL_POST");
  const internal = kinds.some((kind) => kind !== "SOCIAL_POST");
  const single = kinds.length === 1 ? kinds[0] : null;
  const contents = single === "SOCIAL_POST" ? "i post" : single === "BLOG_ARTICLE" ? "gli articoli" : "i contenuti";

  const steps: GuideStep[] = [
    {
      id: "cliente",
      title: "Aggiungi il cliente",
      body: social
        ? "In «Clienti» crea la scheda: nome, servizi e il brand Metricool per i social. Poi, in «Referenti», aggiungi chi approva: basta il nome, l'email è facoltativa."
        : "In «Clienti» crea la scheda con nome e servizi. Poi, in «Referenti», aggiungi chi approva: basta il nome, l'email è facoltativa.",
      links: [
        { label: "Nuovo cliente", href: "/clients/new" },
        ...(social ? [{ label: "Importa da Metricool", href: "/clients/import" }] : []),
      ],
    },
    {
      id: "post",
      title: social ? "Crea o importa i post" : `Crea ${contents}`,
      body: social
        ? "«Nuovo post» apre l'editor con l'anteprima di ogni rete. Per tanti post insieme usa «Importa post»: carichi un foglio Excel o CSV con le immagini, oppure incolli le righe. Nascono solo bozze."
        : "«Nuovo contenuto» apre l'editor con l'anteprima. Finché non lo invii resta una bozza che il cliente non vede.",
      links: [
        { label: single === "SOCIAL_POST" ? "Nuovo post" : "Nuovo contenuto", href: "/posts/new" },
        ...(social ? [{ label: "Importa post", href: "/posts/import" }] : []),
      ],
    },
    {
      id: "invio",
      title: "Invia in revisione e condividi il link",
      body: "Dalla bozza tocca «Invia in revisione»: chi ha l'email riceve un messaggio. Nella scheda compare il link del cliente: «Copia link», «Invia su WhatsApp» o il QR. Ogni referente ha un link personale, senza password.",
      links: [
        { label: "Le bozze", href: "/posts?status=DRAFT" },
        { label: "Referenti dei clienti", href: "/clients" },
      ],
    },
    {
      id: "risposta",
      title: "Il cliente approva o chiede modifiche",
      body: "Il cliente apre il link dal telefono, guarda l'anteprima e approva, oppure tocca il punto da cambiare e lo scrive. Le richieste arrivano in «Da gestire»: correggi e reinvia, il cliente approva la nuova versione.",
      links: [
        { label: "Da gestire", href: "/posts?status=attention" },
        { label: "In revisione", href: "/posts?status=IN_REVIEW" },
      ],
    },
  ];

  if (social) {
    steps.push({
      id: "metricool",
      title: "Programmazione su Metricool",
      body:
        "Collega una volta Metricool in «Impostazioni». Se il cliente ha il brand e la programmazione automatica, il post approvato va su Metricool da solo. Se vedi «Errore», apri il post, leggi il motivo e usa «Riprova»." +
        (internal ? " Articoli e creatività ads invece si esportano dalla scheda." : ""),
      links: [
        { label: "Collega Metricool", href: "/settings#metricool" },
        { label: "Calendario", href: "/calendar" },
      ],
    });
    steps.push({
      id: "piano",
      title: "Piano del mese",
      body: "In «Piani» scegli cliente e mese: i post già preparati diventano un solo percorso di revisione. «Controlla e invia il piano» li manda insieme; il cliente li rivede uno per uno o con «Approva tutto il piano».",
      links: [{ label: "Piani", href: "/plans" }],
    });
  } else {
    steps.push({
      id: "consegna",
      title: "Esporta e consegna",
      body:
        single === "AD_CREATIVE"
          ? "Dopo l'approvazione scarica dalla scheda il pacchetto ZIP con le varianti approvate e i testi. Quando le hai caricate, usa «Segna come consegnato»."
          : "Dopo l'approvazione scarica il contenuto dalla scheda (Markdown o HTML per gli articoli, ZIP per le creatività). Poi usa «Segna come pubblicato» o «Segna come consegnato».",
      links: [{ label: "Approvati", href: "/posts?status=APPROVED" }],
    });
  }

  steps.push({
    id: "mcp",
    title: "Collega la tua AI (MCP)",
    body: "Claude, ChatGPT o Codex possono leggere post e commenti e preparare bozze per te. Non approvano, non inviano e non programmano: tutto resta in bozza finché lo invii tu. Indirizzo e passi sono in «Impostazioni».",
    links: [{ label: "Collega la tua AI", href: "/settings#mcp" }],
  });

  return steps;
}

export function agencyGuideQuestions(kinds: readonly ContentKind[]): GuideQuestion[] {
  const social = kinds.includes("SOCIAL_POST");
  return [
    {
      id: "link",
      question: "Il cliente non trova il link",
      answer:
        "Apri il post, oppure la scheda del cliente alla voce «Referenti», e usa «Copia link» o «Invia su WhatsApp»: è sempre lo stesso link personale. Se l'ha perso o non deve più funzionare, «Nuovo link» ne crea uno nuovo e il vecchio smette di funzionare.",
    },
    {
      id: "errore",
      question: "Ho sbagliato un post già approvato",
      answer: social
        ? "Se è ancora «Approvato», aprilo e correggilo: torna in bozza, lo reinvii e il cliente approva la nuova versione. Se è già «Programmato» su Metricool, qui non si modifica più: correggilo direttamente in Metricool. Il cliente, subito dopo aver approvato, ha qualche secondo per «Annulla»."
        : "Se è ancora «Approvato», aprilo e correggilo: torna in bozza, lo reinvii e il cliente approva la nuova versione. Il cliente, subito dopo aver approvato, ha qualche secondo per «Annulla».",
    },
    {
      id: "cliente",
      question: "Cosa vede il cliente",
      answer:
        "Solo i contenuti che gli hai inviato, del suo cliente: mai le bozze né gli altri clienti. Vede l'anteprima come apparirà, cosa è cambiato tra una versione e l'altra e Heili, che gli spiega i passi. Per controllare, nel post usa «Apri come cliente».",
    },
    {
      id: "sollecito",
      question: "Il cliente non risponde",
      answer:
        "Quando invii puoi scegliere «Risposta entro»: dopo quella data chi ha l'email riceve un sollecito. I contenuti in ritardo compaiono anche in «Da gestire» sulla dashboard.",
    },
  ];
}
