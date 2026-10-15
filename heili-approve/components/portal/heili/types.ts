/**
 * Heili nel portale cliente: tipi del contesto di pagina e del contesto di
 * revisione. Le destinazioni sono calcolate dal server: il dock non costruisce
 * mai un link da sé (vedi `rules.ts`, `isPortalHref`).
 */

import type { ContentKind } from "@/app/generated/prisma/client";
import type { BlogAnchor } from "@/lib/content/types";
import type {
  AssistantAdsContext,
  AssistantMode,
} from "@/lib/review-assistant/shared";

/** Pagine del portale che possono registrare un contesto. */
export type HeiliPageKind =
  | "home"
  | "plan"
  | "plan-grid"
  | "browse"
  | "month"
  | "post"
  | "article"
  | "ads";

/** Destinazione proposta da Heili: solo id, etichetta e href scelti dal server. */
export interface HeiliDestination {
  id: string;
  label: string;
  href: string;
  kind: "next" | "plan" | "home" | "post" | "view";
}

/** Punto scelto dal cliente su un'immagine o su un fotogramma in pausa. */
export interface HeiliPoint {
  mediaIndex: number;
  x: number;
  y: number;
  variantId?: string | null;
  timeSec?: number | null;
}

/**
 * Quello che serve al pannello di oggi (chat, voce, marcatori) quando la
 * pagina è un contenuto da commentare. Le funzioni arrivano dai componenti
 * della pagina e valgono solo finché la pagina è montata.
 */
export interface HeiliReviewContext {
  postId: string;
  versionNumber: number;
  mode: AssistantMode;
  kind: ContentKind;
  /** "Post 3 di 12 · Instagram" per l'intestazione del dock. */
  heading: string;
  /** Rigenera il pannello dopo «Aggiungi al feedback». */
  sessionKey: number;
  /** La pagina ha un'immagine su cui indicare un punto. */
  canPickPoint?: boolean;
  /** La pagina ha un video su cui indicare il momento. */
  canPickMoment?: boolean;
  getVideoTime?: () => number | null;
  getPointContext?: () => HeiliPoint | null;
  getSelection?: () => BlogAnchor | null;
  getContext?: () => AssistantAdsContext | null;
  variantNames?: Record<string, string>;
  onSubmitChanges(input: { message: string; reviewSessionId: string }): Promise<void>;
  onApprove?(): Promise<void>;
  onRequestSavedChanges?(): Promise<void>;
}

/** Contesto che ogni pagina del portale registra nel provider. */
export interface HeiliPageContext {
  page: HeiliPageKind;
  /** "Piano social di novembre", "Post 3 di 12". */
  title: string;
  /** "12 post, 3 da rivedere". */
  summary?: string;
  destinations: HeiliDestination[];
  review?: HeiliReviewContext;
  /** Servizi del cliente: filtrano le domande frequenti della Guida. */
  services: ContentKind[];
}
