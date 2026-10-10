/**
 * View models of the client portal's month views (Griglia / Sfoglia),
 * serializable from the server pages to the client component.
 */

import type { PostStatus } from "@/app/generated/prisma/client";
import type { MediaItem, Network } from "@/lib/domain";

/** One card of Sfoglia: the post as the client is sent it. */
export interface BrowsePost {
  id: string;
  title: string;
  status: PostStatus;
  /** The client can approve it now. */
  canAct: boolean;
  /** Version shown, and the one "Approva" binds to. */
  versionNumber: number;
  networks: Network[];
  networkOptions: unknown;
  text: string;
  firstCommentText: string | null;
  media: MediaItem[];
  publishAt: Date;
  /** "ven 9 ottobre · 18:30" in the client's time zone. */
  slotLabel: string;
  /** "venerdì 9 ottobre alle 18:30": used in the approved sentence. */
  publishLabel: string;
  /** Open client feedback on the version shown (excluded from "Approva i rimanenti"). */
  openComments: number;
  /** The post review page (without the "come back" query). */
  href: string;
}

/** What "Approva i rimanenti" of Sfoglia calls. */
export type BrowseScope =
  | { kind: "plan"; planId: string }
  /** Month route: posts without a plan. */
  | { kind: "month"; month: string };
