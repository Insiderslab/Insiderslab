/**
 * «Sul sito» installation guide shown in the agency's panel: one card per
 * platform, three plain steps each, with a copy button where something has
 * to be pasted. Pure data (no React) so it is tested and shared with
 * docs/INSTALLARE-SUL-SITO.md. The wording is for non-technical people: no
 * jargon beyond the names of the menus they will actually see.
 */

export const PLATFORM_IDS = ["html", "wordpress", "webflow", "shopify", "gtm"] as const;
export type PlatformId = (typeof PLATFORM_IDS)[number];

/** What the small button of a step does. */
export type InstallAction = "copy-line" | "copy-key" | "download-plugin";

export interface InstallStep {
  text: string;
  action?: InstallAction;
}

export interface PlatformGuide {
  id: PlatformId;
  /** Tab label. */
  label: string;
  /** One line under the tab: when to use it. */
  summary: string;
  /** Exactly three steps. */
  steps: readonly [InstallStep, InstallStep, InstallStep];
  /** Something that can go wrong or differ on this platform. */
  note?: string;
  /** «Verifica installazione» can see the line on this platform. */
  verifiable: boolean;
}

export const ACTION_LABELS: Record<InstallAction, { idle: string; done: string }> = {
  "copy-line": { idle: "Copia la riga", done: "Riga copiata" },
  "copy-key": { idle: "Copia la chiave", done: "Chiave copiata" },
  "download-plugin": { idle: "Scarica il plugin", done: "Scarica il plugin" },
};

export const WORDPRESS_PLUGIN_PATH = "/wordpress/heili-approve-review.zip";

export const PLATFORMS: readonly PlatformGuide[] = [
  {
    id: "html",
    label: "HTML",
    summary: "Sito scritto a mano, Next.js o qualsiasi sito dove puoi modificare il codice.",
    steps: [
      { text: "Copia la riga qui sotto.", action: "copy-line" },
      {
        text: "Incollala nel codice del sito di prova, subito prima di </body>, in un punto che compaia in tutte le pagine (di solito il modello o il footer).",
      },
      { text: "Salva e pubblica il sito di prova, poi premi «Verifica installazione» qui sotto." },
    ],
    note: "Con Next.js la riga va nel layout principale (app/layout.tsx), prima della chiusura di <body>.",
    verifiable: true,
  },
  {
    id: "wordpress",
    label: "WordPress",
    summary: "Con il nostro plugin: niente codice da toccare.",
    steps: [
      { text: "Scarica il plugin e tienilo sul computer.", action: "download-plugin" },
      { text: "In WordPress vai in Plugin → Aggiungi nuovo → Carica plugin, scegli il file, poi premi Installa ora e Attiva." },
      { text: "Vai in Impostazioni → Heili Approve, incolla la chiave del sito e premi Salva.", action: "copy-key" },
    ],
    note: "Se usi un plugin di cache (LiteSpeed, WP Rocket, Autoptimize…) svuota la cache. Poi premi «Verifica installazione».",
    verifiable: true,
  },
  {
    id: "webflow",
    label: "Webflow",
    summary: "Dalle impostazioni del sito, senza toccare il progetto.",
    steps: [
      { text: "Copia la riga qui sotto.", action: "copy-line" },
      { text: "In Webflow vai in Impostazioni del sito → Codice personalizzato → Codice nel footer. Incolla la riga e premi Salva." },
      { text: "Pubblica il sito (anche solo sull'indirizzo webflow.io), poi premi «Verifica installazione» qui sotto." },
    ],
    verifiable: true,
  },
  {
    id: "shopify",
    label: "Shopify",
    summary: "Nel file del tema, meglio su una copia non pubblicata.",
    steps: [
      { text: "Copia la riga qui sotto.", action: "copy-line" },
      {
        text: "In Shopify vai in Negozio online → Temi → ⋯ → Modifica codice → layout/theme.liquid. Incolla la riga subito prima di </body> e premi Salva.",
      },
      { text: "Apri il sito dal portale per controllare che compaia il pulsante di Heili, poi premi «Verifica installazione»." },
    ],
    note: "«Verifica installazione» legge solo il tema pubblicato: se lavori su una copia del tema, controlla tu aprendo il sito dal portale e spunta «invia comunque».",
    verifiable: true,
  },
  {
    id: "gtm",
    label: "Google Tag Manager",
    summary: "Se il sito usa già Tag Manager e non puoi toccare il codice.",
    steps: [
      { text: "Copia la riga qui sotto.", action: "copy-line" },
      { text: "In Tag Manager vai in Tag → Nuovo → HTML personalizzato. Incolla la riga e scegli l'attivatore «All Pages» (tutte le pagine)." },
      { text: "Salva e premi Pubblica. Poi apri il sito dal portale e controlla che compaia il pulsante di Heili." },
    ],
    note: "«Verifica installazione» non vede i tag di Tag Manager: dopo aver controllato tu, spunta «invia comunque».",
    verifiable: false,
  },
];

export function platformGuide(id: string): PlatformGuide {
  return PLATFORMS.find((platform) => platform.id === id) ?? PLATFORMS[0];
}

/** What to tell the agency at the top of the panel, for the state of the installation. */
export function nextStepSentence(state: { revoked: boolean; verified: boolean; waived: boolean; originRegistered: boolean }): string {
  if (state.revoked) return "La chiave è revocata: lo script sul sito non fa più nulla.";
  if (state.verified) return "Tutto a posto: lo script è sul sito. Puoi inviare il sito in revisione.";
  if (state.waived) return "Hai scelto di inviare senza verifica: controlla tu, aprendo il sito dal portale, che compaia il pulsante di Heili.";
  if (!state.originRegistered) return "Passo 1: consenti l'indirizzo del sito. Passo 2: installa la riga. Passo 3: premi «Verifica installazione».";
  return "Passo 1: installa la riga sul sito di prova (scegli la tua piattaforma qui sotto). Passo 2: premi «Verifica installazione».";
}
