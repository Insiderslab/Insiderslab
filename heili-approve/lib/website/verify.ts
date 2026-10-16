/**
 * «Verifica installazione»: downloads the site's page with the anti-SSRF
 * fetch (lib/website/ssrf.ts) and looks for the review tag with this site's
 * key. The page is only searched as text: nothing of it runs or is stored.
 */

import { localFetchAllowed, safeFetchText, SsrfError, type LookupAll } from "./ssrf";

export interface VerifyResult {
  found: boolean;
  /** Italian, shown to the agency. */
  message: string;
}

const SCRIPT_TAG = /<script\b[^>]*>/gi;

/** data-site of every review tag in the HTML (src ending in heili-review.js / heili-review.v1.js). */
export function findReviewTags(html: string): string[] {
  const keys: string[] = [];
  for (const match of html.matchAll(SCRIPT_TAG)) {
    const tag = match[0];
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? "";
    if (!/\/heili-review(?:\.v\d+)?\.js(?:[?#]|$)/i.test(src)) continue;
    const key = /\bdata-site\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? "";
    keys.push(key);
  }
  return keys;
}

const FETCH_MESSAGES: Record<string, string> = {
  scheme: "Indirizzo non consentito: usa https://",
  credentials: "Indirizzo non consentito: togli nome utente e password.",
  port: "Indirizzo non consentito: porta non ammessa (usa 80, 443, 8080 o 8443).",
  host: "Indirizzo non consentito: serve un dominio pubblico.",
  private: "Indirizzo non consentito: il sito punta a una rete privata.",
  dns: "Il dominio non esiste o non risponde.",
  redirects: "Il sito fa troppi reindirizzamenti.",
  timeout: "Il sito non risponde (tempo scaduto).",
  "too-large": "La pagina è troppo grande da controllare.",
  tls: "Certificato non valido: controlla l'https del sito.",
  network: "Il sito non risponde.",
};

/** Looks for the tag on `url`. Never throws: the outcome is a message. */
export async function verifyInstallation(
  url: string,
  siteKey: string,
  opts: { lookupAll?: LookupAll; allowLocal?: boolean } = {}
): Promise<VerifyResult> {
  try {
    const page = await safeFetchText(url, {
      lookupAll: opts.lookupAll,
      allowLocal: opts.allowLocal ?? localFetchAllowed(),
    });
    if (page.status === 401 || page.status === 403) {
      return {
        found: false,
        message: "Il sito chiede una password o blocca l'accesso: non si può verificare da qui.",
      };
    }
    if (page.status >= 400) return { found: false, message: `Il sito risponde con un errore (${page.status}).` };
    const keys = findReviewTags(page.body);
    if (keys.includes(siteKey)) return { found: true, message: "Script trovato sul sito" };
    if (keys.length > 0) {
      return { found: false, message: "Lo script c'è ma con un'altra chiave: copia di nuovo la riga di codice." };
    }
    return {
      found: false,
      message: "Non trovato: controlla di aver salvato, la cache del sito e il plugin di ottimizzazione.",
    };
  } catch (error) {
    if (error instanceof SsrfError) return { found: false, message: FETCH_MESSAGES[error.code] ?? "Il sito non risponde." };
    return { found: false, message: "Il sito non risponde." };
  }
}
