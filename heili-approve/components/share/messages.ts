/**
 * Share messages
 *
 * The prefilled texts the agency sends with a reviewer's personal link
 * (WhatsApp, the phone's share sheet) and the notice after "Invia in
 * revisione" when nobody gets an email. Pure: no server-only imports, so the
 * client components can use them too.
 */

import type { ContentKind, PostStatus } from "@/app/generated/prisma/client";

/** "Chiara Bianchi" → "Chiara": a WhatsApp greeting uses the first name. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] ?? "";
}

function greeting(reviewerName: string): string {
  const name = firstName(reviewerName);
  return name ? `Ciao ${name}` : "Ciao";
}

/**
 * Message for the client's portal link:
 * "Ciao Chiara, ecco il link per rivedere e approvare i contenuti di Agriturismo Le Querce: <url>".
 * `contentsThe` is "i post" / "gli articoli" / "le creatività" / "i contenuti".
 */
export function clientLinkMessage({
  reviewerName,
  clientName,
  url,
  contentsThe = "i contenuti",
}: {
  reviewerName: string;
  clientName: string;
  url: string;
  contentsThe?: string;
}): string {
  return `${greeting(reviewerName)}, ecco il link per rivedere e approvare ${contentsThe} di ${clientName}: ${url}`;
}

const POST_WORDS: Record<ContentKind, { fresh: string; here: string; the: string }> = {
  SOCIAL_POST: { fresh: "c'è un nuovo post da approvare", here: "Lo trovi qui", the: "il post" },
  BLOG_ARTICLE: { fresh: "c'è un nuovo articolo da approvare", here: "Lo trovi qui", the: "l'articolo" },
  AD_CREATIVE: { fresh: "ci sono nuove creatività da approvare", here: "Le trovi qui", the: "le creatività" },
};

/**
 * Message for the deep link to one item:
 * "Ciao Chiara, c'è un nuovo post da approvare: «Titolo». Lo trovi qui: <url>".
 * When the client already asked for changes it just points back to the item.
 */
export function postLinkMessage({
  kind,
  status,
  reviewerName,
  title,
  url,
}: {
  kind: ContentKind;
  status?: PostStatus;
  reviewerName: string;
  title: string;
  url: string;
}): string {
  const words = POST_WORDS[kind] ?? POST_WORDS.SOCIAL_POST;
  const name = title.trim();
  if (status === "CHANGES_REQUESTED") {
    return `${greeting(reviewerName)}, ecco il link per rivedere ${words.the}${name ? ` «${name}»` : ""}: ${url}`;
  }
  return `${greeting(reviewerName)}, ${words.fresh}${name ? `: «${name}»` : ""}. ${words.here}: ${url}`;
}

/** WhatsApp "click to chat" without a number: the agency picks the contact. */
export function whatsappHref(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

/**
 * Follow-up to "… inviato in revisione." about who gets told:
 * - clients without active reviewers: nobody can see it yet;
 * - clients whose reviewers have no email: share the link by hand.
 * `clientCount` is how many distinct clients the submitted items belong to.
 */
export function submitFollowUp({
  clientCount,
  clientsWithoutReviewers,
  clientsWithoutEmail,
}: {
  clientCount: number;
  clientsWithoutReviewers: readonly string[];
  clientsWithoutEmail: readonly string[];
}): string {
  const parts: string[] = [];
  if (clientsWithoutReviewers.length > 0) {
    parts.push(
      `Attenzione: ${clientsWithoutReviewers.join(", ")} non ha referenti attivi, quindi nessuno riceverà l'email. Aggiungili nella scheda del cliente.`
    );
  }
  if (clientsWithoutEmail.length > 0) {
    const everyone = clientsWithoutEmail.length >= clientCount && clientsWithoutReviewers.length === 0;
    parts.push(
      everyone
        ? "Nessun referente ha un'email: copia il link dal riquadro «Condividi con il cliente» e mandalo tu (WhatsApp, messaggio…)."
        : `I referenti di ${clientsWithoutEmail.join(", ")} non hanno un'email: manda tu il link dal riquadro «Condividi con il cliente».`
    );
  }
  return parts.join(" ");
}

/** True when nobody among the submitted items' clients gets an email. */
export function nobodyEmailed({
  clientCount,
  clientsWithoutReviewers,
  clientsWithoutEmail,
}: {
  clientCount: number;
  clientsWithoutReviewers: readonly string[];
  clientsWithoutEmail: readonly string[];
}): boolean {
  return clientCount > 0 && clientsWithoutReviewers.length + clientsWithoutEmail.length >= clientCount;
}
