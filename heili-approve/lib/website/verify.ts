/**
 * «Verifica installazione»: downloads the site's page with the anti-SSRF
 * fetch (lib/website/ssrf.ts) and looks for the review tag with this site's
 * key. The page is only searched as text: nothing of it runs or is stored.
 *
 * The result is a short Italian message (stored on the site as
 * `verifyMessage`); verify-outcomes.ts explains it in plain words.
 */

import { localFetchAllowed, safeFetchText, SsrfError, type LookupAll } from "./ssrf";
import { OUTCOMES, SSRF_KINDS } from "./verify-outcomes";
export { describeVerification, type VerifyGroup, type VerifyKind, type VerifyOutcome } from "./verify-outcomes";

export interface VerifyResult {
  found: boolean;
  /** Italian, shown to the agency (the title of the outcome). */
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
    if (page.status === 401 || page.status === 403) return { found: false, message: OUTCOMES.protected.title };
    if (page.status >= 400) return { found: false, message: `Il sito risponde con un errore (${page.status}).` };
    const keys = findReviewTags(page.body);
    if (keys.includes(siteKey)) return { found: true, message: OUTCOMES.found.title };
    if (keys.some((key) => key === "")) return { found: false, message: OUTCOMES.noKey.title };
    if (keys.length > 0) return { found: false, message: OUTCOMES.otherKey.title };
    return { found: false, message: OUTCOMES.missing.title };
  } catch (error) {
    if (error instanceof SsrfError) return { found: false, message: OUTCOMES[SSRF_KINDS[error.code] ?? "network"].title };
    return { found: false, message: OUTCOMES.network.title };
  }
}
