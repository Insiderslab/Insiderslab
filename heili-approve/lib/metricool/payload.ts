/**
 * Metricool scheduler payload (pure, no I/O).
 *
 * Turns an approved post + version into the JSON body of
 * `POST /v2/scheduler/posts`, and validates it per network so the editor and
 * the worker apply exactly the same rules. Messages are in Italian because
 * they end up in the UI (editor warnings, Post.lastError).
 */

import {
  NETWORK_FORMATS,
  NETWORK_LABELS,
  NETWORK_TEXT_LIMITS,
  isNetwork,
  parseMediaItems,
  type MediaItem,
  type Network,
} from "@/lib/domain";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface PayloadPostInput {
  /** Desired publication instant (UTC). */
  publishAt: Date;
  networks: readonly string[];
  /** Post.networkOptions: { "<network>Data": {...} }. */
  networkOptions?: unknown;
}

export interface PayloadVersionInput {
  text: string;
  firstCommentText?: string | null;
  /** PostVersion.media (JSON array of MediaItem). */
  media: unknown;
}

export interface PayloadClientInput {
  /** IANA time zone of the brand, e.g. "Europe/Rome". */
  timezone: string;
}

export interface MetricoolSchedulerPayload {
  publicationDate: { dateTime: string; timezone: string };
  text: string;
  firstCommentText?: string;
  providers: Array<{ network: Network }>;
  media: string[];
  mediaAltText: string[];
  autoPublish: true;
  draft: false;
  shortener: false;
  smartLinkData: { ids: string[] };
  descendants: unknown[];
  hasNotReadNotes: false;
  /** One `<network>Data` object per selected network. */
  [networkData: `${string}Data`]: Record<string, unknown>;
}

export type ValidationField = "networks" | "text" | "media" | "options" | "publishAt" | "timezone";

export interface ValidationIssue {
  /** null = applies to the whole post, not to one network. */
  network: Network | null;
  field: ValidationField;
  message: string;
}

export interface ValidateInput {
  networks: readonly string[];
  networkOptions?: unknown;
  text: string;
  firstCommentText?: string | null;
  media: unknown;
  /** When given, must be in the future (relative to `now`). */
  publishAt?: Date;
  /** When given, must be a valid IANA zone. */
  timezone?: string;
  now?: Date;
}

/** Thrown by buildSchedulerPayload; never retryable (the content is wrong). */
export class SchedulerPayloadError extends Error {
  constructor(public issues: ValidationIssue[]) {
    super(formatValidationIssues(issues));
    this.name = "SchedulerPayloadError";
  }
}

export function formatValidationIssues(issues: ValidationIssue[]): string {
  return issues.map((issue) => issue.message).join(" ");
}

// ─── Time zones ──────────────────────────────────────────────────────────────

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function getFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      // h23, not hour12:false: some ICU builds render midnight as "24".
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone) return false;
  try {
    getFormatter(timeZone);
    return true;
  } catch {
    return false;
  }
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function wallClockIn(instant: Date, timeZone: string): WallClock {
  const parts = getFormatter(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

const pad = (value: number, length = 2) => String(value).padStart(length, "0");

/**
 * Wall-clock time of `instant` in `timeZone`, as Metricool expects it:
 * "YYYY-MM-DDTHH:mm:ss" (no offset; the zone travels in a separate field).
 */
export function toZonedDateTimeString(instant: Date, timeZone: string): string {
  const c = wallClockIn(instant, timeZone);
  return `${pad(c.year, 4)}-${pad(c.month)}-${pad(c.day)}T${pad(c.hour)}:${pad(c.minute)}:${pad(c.second)}`;
}

/** Offset of `timeZone` from UTC at `instant`, in ms (Rome summer = +2h). */
function zoneOffsetMs(instant: number, timeZone: string): number {
  const c = wallClockIn(new Date(instant), timeZone);
  const asUtc = Date.UTC(c.year, c.month - 1, c.day, c.hour, c.minute, c.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

const LOCAL_DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Inverse of toZonedDateTimeString: the UTC instant at which the wall clock in
 * `timeZone` reads `local` ("YYYY-MM-DDTHH:mm[:ss]", e.g. a datetime-local
 * input). A time skipped by the spring-forward jump is moved forward by the
 * gap (02:30 → 03:30 in Rome); an ambiguous autumn time resolves to the second
 * occurrence (standard time). Returns null for malformed input.
 */
export function zonedDateTimeToUtc(local: string, timeZone: string): Date | null {
  const match = LOCAL_DATE_TIME.exec(local.trim());
  if (!match || !isValidTimeZone(timeZone)) return null;
  const [, y, mo, d, h, mi, s] = match;
  const guess = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s ?? 0));
  if (Number.isNaN(guess)) return null;

  const firstOffset = zoneOffsetMs(guess, timeZone);
  let utc = guess - firstOffset;
  const secondOffset = zoneOffsetMs(utc, timeZone);
  if (secondOffset !== firstOffset) utc = guess - secondOffset;
  return new Date(utc);
}

// ─── Network options ─────────────────────────────────────────────────────────

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function networkDataKey(network: Network): `${Network}Data` {
  return `${network}Data`;
}

/** The agency-set `<network>Data` object, or {} when absent/malformed. */
export function getNetworkOptions(networkOptions: unknown, network: Network): Record<string, unknown> {
  if (!isPlainObject(networkOptions)) return {};
  const value = networkOptions[networkDataKey(network)];
  return isPlainObject(value) ? value : {};
}

function stringOption(options: Record<string, unknown>, key: string): string | undefined {
  const value = options[key];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

/** Selected format for a network ("POST" | "REEL" | "STORY", "short"…), with defaults. */
export function getNetworkFormat(network: Network, networkOptions: unknown): string | undefined {
  const formats = NETWORK_FORMATS[network];
  if (!formats) return undefined;
  return stringOption(getNetworkOptions(networkOptions, network), "type") ?? formats[0];
}

function isStoryFormat(network: Network, networkOptions: unknown): boolean {
  return (network === "instagram" || network === "facebook") && getNetworkFormat(network, networkOptions) === "STORY";
}

/**
 * Defaults Metricool expects for each network's data object; the agency's
 * options are merged on top. Networks without required fields get {}.
 */
function defaultNetworkData(network: Network, format: string | undefined): Record<string, unknown> {
  switch (network) {
    case "instagram":
      return format === "REEL" ? { type: "REEL", showReelOnFeed: true } : { type: format ?? "POST" };
    case "facebook":
      return { type: format ?? "POST" };
    case "linkedin":
      return { type: "post", previewIncluded: true };
    case "tiktok":
      return {
        privacyOption: "PUBLIC_TO_EVERYONE",
        disableComment: false,
        disableDuet: false,
        disableStitch: false,
      };
    case "youtube":
      return { type: format ?? "video", privacy: "public", madeForKids: false };
    case "gmb":
      return { type: format ?? "publication" };
    case "twitter":
      return { tags: [] };
    case "bluesky":
      return { postLanguages: [] };
    case "pinterest":
    case "threads":
      return {};
  }
}

export function buildNetworkData(network: Network, networkOptions: unknown): Record<string, unknown> {
  const format = getNetworkFormat(network, networkOptions);
  return { ...defaultNetworkData(network, format), ...getNetworkOptions(networkOptions, network) };
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Instagram carousels and X posts cap the number of attachments. */
const MAX_MEDIA: Partial<Record<Network, number>> = {
  instagram: 10,
  twitter: 4,
};

function charCount(text: string): number {
  // Count code points, not UTF-16 units: an emoji is one character for users.
  return Array.from(text).length;
}

function isPublicUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Every reason Metricool (or the network behind it) would reject the post,
 * in Italian. Empty array = publishable. Shared by the editor and the worker.
 */
export function validateForNetworks(input: ValidateInput): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (network: Network | null, field: ValidationField, message: string) =>
    issues.push({ network, field, message });

  const media = parseMediaItems(input.media);
  const images = media.filter((item) => item.type === "image");
  const videos = media.filter((item) => item.type === "video");
  const text = input.text ?? "";
  const networks: Network[] = [];

  for (const value of input.networks) {
    if (isNetwork(value)) {
      if (!networks.includes(value)) networks.push(value);
    } else {
      add(null, "networks", `La rete "${String(value)}" non è supportata.`);
    }
  }

  if (networks.length === 0 && issues.length === 0) {
    add(null, "networks", "Seleziona almeno una rete.");
  }

  if (input.timezone !== undefined && !isValidTimeZone(input.timezone)) {
    add(null, "timezone", `Il fuso orario "${input.timezone}" del cliente non è valido.`);
  }

  if (input.publishAt) {
    const now = input.now ?? new Date();
    if (Number.isNaN(input.publishAt.getTime())) {
      add(null, "publishAt", "La data di pubblicazione non è valida.");
    } else if (input.publishAt.getTime() <= now.getTime()) {
      add(null, "publishAt", "La data di pubblicazione è già passata: scegli una data futura.");
    }
  }

  if (media.some((item) => !isPublicUrl(item.url))) {
    add(null, "media", "Alcuni contenuti non hanno un URL pubblico: Metricool non può scaricarli.");
  }

  if (text.trim() === "" && media.length === 0) {
    add(null, "text", "Il post è vuoto: aggiungi un testo o almeno un'immagine o un video.");
  }

  for (const network of networks) {
    const label = NETWORK_LABELS[network];
    const options = getNetworkOptions(input.networkOptions, network);
    const format = getNetworkFormat(network, input.networkOptions);
    const allowedFormats = NETWORK_FORMATS[network];

    if (allowedFormats && format && !allowedFormats.includes(format)) {
      add(network, "options", `Il formato "${format}" non è valido per ${label}.`);
    }

    // Stories carry no caption, so the caption limit does not apply to them.
    const limit = NETWORK_TEXT_LIMITS[network];
    if (limit !== undefined && !isStoryFormat(network, input.networkOptions)) {
      const length = charCount(text);
      if (length > limit) {
        add(network, "text", `Il testo supera il limite di ${limit} caratteri per ${label} (${length}).`);
      }
    }

    const maxMedia = MAX_MEDIA[network];
    if (maxMedia !== undefined && media.length > maxMedia) {
      add(network, "media", `${label} accetta al massimo ${maxMedia} contenuti per post (${media.length}).`);
    }

    switch (network) {
      case "instagram":
        if (media.length === 0) {
          add(network, "media", "Instagram richiede almeno un'immagine o un video.");
        } else if (format === "REEL" && videos.length === 0) {
          add(network, "media", "Il Reel di Instagram richiede un video.");
        } else if (format === "STORY" && media.length > 1) {
          add(network, "media", "La Storia di Instagram accetta un solo contenuto.");
        }
        break;
      case "facebook":
        if (format === "REEL" && videos.length === 0) {
          add(network, "media", "Il Reel di Facebook richiede un video.");
        } else if (format === "STORY" && media.length === 0) {
          add(network, "media", "La Storia di Facebook richiede un'immagine o un video.");
        }
        break;
      case "tiktok":
        if (media.length === 0) add(network, "media", "TikTok richiede un video o delle immagini.");
        break;
      case "youtube":
        if (videos.length === 0) add(network, "media", "YouTube richiede un video.");
        if (!stringOption(options, "title")) add(network, "options", "YouTube richiede un titolo per il video.");
        break;
      case "pinterest":
        if (images.length === 0) add(network, "media", "Pinterest richiede almeno un'immagine.");
        if (!stringOption(options, "boardId")) add(network, "options", "Pinterest richiede la bacheca (boardId).");
        break;
      case "gmb":
        if (format === "photo" && images.length === 0) {
          add(network, "media", "La foto per Google Business richiede un'immagine.");
        }
        break;
      default:
        break;
    }
  }

  return issues;
}

// ─── Payload ─────────────────────────────────────────────────────────────────

/**
 * Body for `POST /v2/scheduler/posts`. Throws SchedulerPayloadError when the
 * content would be rejected, so the worker can fail fast without a retry.
 */
export function buildSchedulerPayload({
  post,
  version,
  client,
  now,
}: {
  post: PayloadPostInput;
  version: PayloadVersionInput;
  client: PayloadClientInput;
  /** Reference time for the "date in the past" check (defaults to now). */
  now?: Date;
}): MetricoolSchedulerPayload {
  const issues = validateForNetworks({
    networks: post.networks,
    networkOptions: post.networkOptions,
    text: version.text,
    firstCommentText: version.firstCommentText,
    media: version.media,
    publishAt: post.publishAt,
    timezone: client.timezone,
    now,
  });
  if (issues.length > 0) throw new SchedulerPayloadError(issues);

  const networks = post.networks.filter(isNetwork).filter((n, i, all) => all.indexOf(n) === i);
  const media: MediaItem[] = parseMediaItems(version.media);
  const allStories = networks.every((n) => isStoryFormat(n, post.networkOptions));
  const firstComment = version.firstCommentText?.trim();

  const payload: MetricoolSchedulerPayload = {
    publicationDate: {
      dateTime: toZonedDateTimeString(post.publishAt, client.timezone),
      timezone: client.timezone,
    },
    // Stories carry no caption: send none when every target is a story.
    text: allStories ? "" : version.text,
    providers: networks.map((network) => ({ network })),
    media: media.map((item) => item.url),
    mediaAltText: [],
    autoPublish: true,
    draft: false,
    shortener: false,
    smartLinkData: { ids: [] },
    descendants: [],
    hasNotReadNotes: false,
  };

  if (firstComment && !allStories) payload.firstCommentText = firstComment;

  for (const network of networks) {
    payload[networkDataKey(network)] = buildNetworkData(network, post.networkOptions);
  }

  return payload;
}
