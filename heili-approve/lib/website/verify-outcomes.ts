/**
 * Outcomes of «Verifica installazione» in words the agency understands:
 * found / what to do / site unreachable. Pure (no network code), so the
 * client components can import it; lib/website/verify.ts produces the
 * messages and `describeVerification` turns a stored message back into
 * the outcome (title, hints, whether «Verifica di nuovo» makes sense).
 */

/** found = all good; wrong = the line is there but not right; missing = not found; blocked = the site keeps us out;
 *  unreachable = the site does not answer; address = the address is not allowed. */
export type VerifyGroup = "found" | "wrong" | "missing" | "blocked" | "unreachable" | "address";

export interface VerifyOutcome {
  group: VerifyGroup;
  tone: "success" | "warning" | "error";
  /** The stored message. */
  title: string;
  /** What to do next, one short sentence each. */
  hints: readonly string[];
  /** «Verifica di nuovo» makes sense (something may change on its own or after a fix). */
  retry: boolean;
}

const MISSING_HINTS = [
  "Controlla di aver salvato e pubblicato il sito di prova dopo aver incollato la riga.",
  "Se il sito usa una cache o un plugin di ottimizzazione, svuotala: può tenere la versione vecchia o togliere la riga.",
  "La verifica legge la pagina iniziale: controlla che la riga sia lì.",
  "Usi Google Tag Manager o un tema Shopify non pubblicato? La verifica non li vede: apri il sito dal portale e, se compare il pulsante di Heili, spunta «invia comunque».",
];

export const OUTCOMES = {
  found: {
    group: "found",
    tone: "success",
    title: "Script trovato sul sito",
    hints: ["Tutto a posto: puoi inviare il sito in revisione."],
    retry: false,
  },
  otherKey: {
    group: "wrong",
    tone: "warning",
    title: "Lo script c'è ma con un'altra chiave",
    hints: [
      "Sul sito c'è la riga di un altro sito (o di una chiave vecchia).",
      "Copia di nuovo la riga da qui, sostituisci quella sul sito, svuota la cache e verifica di nuovo.",
    ],
    retry: true,
  },
  noKey: {
    group: "wrong",
    tone: "warning",
    title: "Lo script c'è ma senza chiave",
    hints: [
      "La riga sul sito è incompleta: manca la chiave (la parte data-site=\"hs_…\").",
      "Copia di nuovo la riga intera da qui e sostituiscila.",
    ],
    retry: true,
  },
  missing: {
    group: "missing",
    tone: "warning",
    title: "Script non trovato sul sito",
    hints: MISSING_HINTS,
    retry: true,
  },
  protected: {
    group: "blocked",
    tone: "warning",
    title: "Il sito chiede una password",
    hints: [
      "Approve non può entrare nei siti protetti da password o da un elenco di indirizzi.",
      "Apri tu il sito dal portale: se compare il pulsante di Heili va tutto bene. Poi spunta «invia comunque».",
    ],
    retry: false,
  },
  dns: {
    group: "unreachable",
    tone: "error",
    title: "Il sito non si trova",
    hints: [
      "Il nome del sito non esiste o non risponde: controlla di averlo scritto bene.",
      "Se il sito è appena nato, può servire qualche minuto: riprova più tardi.",
    ],
    retry: true,
  },
  timeout: {
    group: "unreachable",
    tone: "error",
    title: "Il sito non risponde in tempo",
    hints: ["Il sito ha messo troppo a rispondere: riprova tra poco.", "Se succede sempre, controlla che sia online e non sovraccarico."],
    retry: true,
  },
  network: {
    group: "unreachable",
    tone: "error",
    title: "Il sito non risponde",
    hints: ["Non riesco a raggiungerlo: controlla che sia online e riprova.", "Se il sito è protetto da password, non si può verificare da qui."],
    retry: true,
  },
  tls: {
    group: "unreachable",
    tone: "error",
    title: "Il certificato del sito non è valido",
    hints: ["Il sito ha un problema con il lucchetto (https): rinnova o correggi il certificato, poi riprova."],
    retry: true,
  },
  redirects: {
    group: "unreachable",
    tone: "error",
    title: "Il sito reindirizza troppe volte",
    hints: ["L'indirizzo rimanda di continuo a un altro indirizzo: controlla le regole di reindirizzamento (www, https)."],
    retry: true,
  },
  tooLarge: {
    group: "unreachable",
    tone: "warning",
    title: "La pagina è troppo grande da controllare",
    hints: ["Apri il sito dal portale: se compare il pulsante di Heili va tutto bene. Poi spunta «invia comunque»."],
    retry: false,
  },
  scheme: {
    group: "address",
    tone: "error",
    title: "Indirizzo non consentito: usa https://",
    hints: ["Scrivi l'indirizzo del sito partendo da https://."],
    retry: false,
  },
  credentials: {
    group: "address",
    tone: "error",
    title: "Indirizzo non consentito: togli nome utente e password.",
    hints: ["Nell'indirizzo del sito non devono comparire nome utente e password."],
    retry: false,
  },
  port: {
    group: "address",
    tone: "error",
    title: "Indirizzo non consentito: porta non ammessa (usa 80, 443, 8080 o 8443).",
    hints: ["Togli la porta dall'indirizzo, oppure usa una di queste: 80, 443, 8080, 8443."],
    retry: false,
  },
  host: {
    group: "address",
    tone: "error",
    title: "Indirizzo non consentito: serve un dominio pubblico.",
    hints: ["Usa il dominio del sito di prova, per esempio prova.cliente.it."],
    retry: false,
  },
  private: {
    group: "address",
    tone: "error",
    title: "Indirizzo non consentito: il sito punta a una rete privata.",
    hints: ["Usa l'indirizzo pubblico del sito di prova: Approve non entra nelle reti interne."],
    retry: false,
  },
} as const satisfies Record<string, VerifyOutcome>;

export type VerifyKind = keyof typeof OUTCOMES;

export const SSRF_KINDS: Record<string, VerifyKind> = {
  scheme: "scheme",
  credentials: "credentials",
  port: "port",
  host: "host",
  private: "private",
  dns: "dns",
  redirects: "redirects",
  timeout: "timeout",
  "too-large": "tooLarge",
  tls: "tls",
  network: "network",
};

/** Messages written by earlier versions of the panel, still stored on some sites. */
const LEGACY: Array<[RegExp, VerifyKind]> = [
  [/^Lo script c'è ma con un'altra chiave/, "otherKey"],
  [/^Non trovato/, "missing"],
  [/^Il sito chiede una password o blocca/, "protected"],
  [/^Il dominio non esiste/, "dns"],
  [/^Il sito non risponde \(tempo scaduto\)/, "timeout"],
  [/^Il sito fa troppi reindirizzamenti/, "redirects"],
  [/^Certificato non valido/, "tls"],
];

const HTTP_ERROR = /^Il sito risponde con un errore \((\d{3})\)/;

/** The outcome a stored message stands for; null when there is no message. */
export function describeVerification(message: string | null | undefined): VerifyOutcome | null {
  const text = (message ?? "").trim();
  if (!text) return null;
  const http = HTTP_ERROR.exec(text);
  if (http) {
    const status = Number(http[1]);
    return {
      group: "unreachable",
      tone: "error",
      title: text,
      hints:
        status >= 500
          ? ["Il sito ha un problema suo (errore del server): riprova tra poco o avvisa chi lo gestisce."]
          : ["Controlla che l'indirizzo del sito sia giusto e che la pagina si apra dal browser."],
      retry: true,
    };
  }
  for (const kind of Object.keys(OUTCOMES) as VerifyKind[]) {
    if (OUTCOMES[kind].title === text) return OUTCOMES[kind];
  }
  for (const [pattern, kind] of LEGACY) if (pattern.test(text)) return OUTCOMES[kind];
  return { group: "unreachable", tone: "warning", title: text, hints: ["Riprova tra poco."], retry: true };
}
