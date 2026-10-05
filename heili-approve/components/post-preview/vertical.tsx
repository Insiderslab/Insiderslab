/**
 * Full-screen vertical mockups (9:16): Instagram/Facebook Reel and Story,
 * TikTok, YouTube Short. The network UI is drawn over the media as a
 * non-interactive overlay (only "altro" and the carousel arrows take taps),
 * so the client can still tap the paused frame to pin a comment.
 */

import type { ReactNode } from "react";
import Caption from "./caption";
import { CAPTION_LIMITS, formatPublishDate, toHandle } from "./helpers";
import {
  BookmarkIcon,
  CameraIcon,
  CloseIcon,
  CommentIcon,
  HeartIcon,
  MoreIcon,
  MusicIcon,
  PlusIcon,
  SendIcon,
  ShareArrowIcon,
  ThumbIcon,
} from "./icons";
import MediaStage from "./media-stage";
import { Avatar, FirstComment, MockupFrame, stageProps } from "./parts";
import type { MockupProps } from "./types";

const FRAME = "max-w-[340px] overflow-hidden rounded-xl border border-border bg-background";
const SHADOW = "[text-shadow:0_1px_2px_rgba(0,0,0,0.6)]";

function RightRail({ items }: { items: ReactNode[] }) {
  return (
    <div className={`absolute bottom-24 right-2 flex flex-col items-center gap-5 text-white ${SHADOW}`}>
      {items.map((item, i) => (
        <span key={i} className="flex flex-col items-center">
          {item}
        </span>
      ))}
    </div>
  );
}

// ─── Reel (Instagram / Facebook) ─────────────────────────────────────────────

export function ReelMockup(p: MockupProps & { variant: "instagram" | "facebook" }) {
  const networkName = p.variant === "instagram" ? "Instagram" : "Facebook";
  const chrome = (
    <div className="absolute inset-0">
      <div className={`absolute inset-x-3 top-3 flex items-center justify-between text-white ${SHADOW}`} aria-hidden="true">
        <span className="text-[18px] font-bold">Reels</span>
        <CameraIcon className="h-6 w-6" />
      </div>
      <div aria-hidden="true">
        <RightRail
          items={[
            <HeartIcon key="h" className="h-7 w-7" />,
            <CommentIcon key="c" className="h-7 w-7" />,
            <SendIcon key="s" className="h-7 w-7" />,
            <MoreIcon key="m" className="h-6 w-6" />,
          ]}
        />
      </div>
      <div className={`absolute bottom-3 left-3 right-14 space-y-2 text-white ${SHADOW}`}>
        <div className="flex items-center gap-2" aria-hidden="true">
          <Avatar name={p.accountName} url={p.accountAvatarUrl} size={28} />
          <span className="truncate text-[14px] font-semibold">{p.accountName}</span>
          <span className="rounded-md border border-white/80 px-2 py-0.5 text-[12px] font-semibold">Segui</span>
        </div>
        {p.text.trim() ? (
          <Caption
            text={p.text}
            limit={CAPTION_LIMITS.instagramReel}
            linkClassName="font-semibold"
            moreLabel="altro"
            moreClassName="text-white/75"
            className="text-[13px] leading-snug"
          />
        ) : null}
        <p className="flex items-center gap-1.5 text-[12px]" aria-hidden="true">
          <MusicIcon className="h-3.5 w-3.5" />
          <span className="truncate">{p.accountName} · Audio originale</span>
        </p>
      </div>
    </div>
  );

  return (
    <MockupFrame label={`${networkName}, Reel`} className={FRAME}>
      <MediaStage
        {...stageProps(p)}
        label={`Reel ${networkName}`}
        ratio={9 / 16}
        overlay={chrome}
        indicators="counter"
        emptyLabel="Il Reel richiede un video"
      />
      <FirstComment
        accountName={p.accountName}
        text={p.firstCommentText}
        linkClassName={p.variant === "instagram" ? "text-[#00376b]" : "text-[#0064d1]"}
        className="border-t border-border px-3 py-2 text-black"
      />
    </MockupFrame>
  );
}

// ─── Story (Instagram / Facebook) — no caption, like the real thing ──────────

export function StoryMockup(p: MockupProps & { variant: "instagram" | "facebook" }) {
  const networkName = p.variant === "instagram" ? "Instagram" : "Facebook";
  const date = formatPublishDate(p.publishAt, "short", p.timeZone);
  const chrome = (
    <div className={`absolute inset-0 text-white ${SHADOW}`} aria-hidden="true">
      {p.media.length <= 1 ? <span className="absolute inset-x-2 top-2 h-0.5 rounded-full bg-white" /> : null}
      <div className="absolute inset-x-3 top-5 flex items-center gap-2">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={32} />
        <span className="truncate text-[14px] font-semibold">{p.accountName}</span>
        {date ? <span className="shrink-0 text-[13px] text-white/75">{date}</span> : null}
        <MoreIcon className="ml-auto h-5 w-5 shrink-0" />
        <CloseIcon className="h-6 w-6 shrink-0" />
      </div>
      <div className="absolute inset-x-3 bottom-3 flex items-center gap-3">
        <span className="flex-1 rounded-full border border-white/70 px-4 py-2 text-[14px]">Invia messaggio</span>
        <HeartIcon className="h-6 w-6 shrink-0" />
        <SendIcon className="h-6 w-6 shrink-0" />
      </div>
    </div>
  );

  return (
    <MockupFrame label={`${networkName}, Storia`} className={FRAME}>
      <MediaStage
        {...stageProps(p)}
        label={`Storia ${networkName}`}
        ratio={9 / 16}
        overlay={chrome}
        indicators="story"
        emptyLabel="La storia richiede un'immagine o un video"
      />
    </MockupFrame>
  );
}

// ─── TikTok ──────────────────────────────────────────────────────────────────

export function TikTokMockup(p: MockupProps) {
  const chrome = (
    <div className="absolute inset-0">
      <div
        className={`absolute inset-x-0 top-3 flex justify-center gap-4 text-[16px] text-white ${SHADOW}`}
        aria-hidden="true"
      >
        <span className="text-white/70">Seguiti</span>
        <span className="border-b-2 border-white pb-0.5 font-semibold">Per te</span>
      </div>
      <div aria-hidden="true">
        <RightRail
          items={[
            <span key="a" className="relative mb-2">
              <Avatar name={p.accountName} url={p.accountAvatarUrl} size={44} className="rounded-full border border-white" />
              <span className="absolute -bottom-2 left-1/2 flex h-5 w-5 -translate-x-1/2 items-center justify-center rounded-full bg-[#fe2c55]">
                <PlusIcon className="h-3.5 w-3.5" />
              </span>
            </span>,
            <HeartIcon key="h" className="h-8 w-8" />,
            <CommentIcon key="c" className="h-8 w-8" />,
            <BookmarkIcon key="b" className="h-7 w-7" />,
            <ShareArrowIcon key="s" className="h-8 w-8" />,
          ]}
        />
      </div>
      <div className={`absolute bottom-3 left-3 right-16 space-y-1.5 text-white ${SHADOW}`}>
        <p className="truncate text-[15px] font-semibold" aria-hidden="true">
          {p.accountName}
        </p>
        {p.text.trim() ? (
          <Caption
            text={p.text}
            limit={CAPTION_LIMITS.tiktok}
            linkClassName="font-semibold"
            moreLabel="altro"
            moreClassName="font-semibold text-white"
            className="text-[14px] leading-snug"
          />
        ) : null}
        <p className="flex items-center gap-1.5 text-[13px]" aria-hidden="true">
          <MusicIcon className="h-3.5 w-3.5" />
          <span className="truncate">suono originale - {p.accountName}</span>
        </p>
      </div>
    </div>
  );

  return (
    <MockupFrame label="TikTok" className={FRAME}>
      <MediaStage
        {...stageProps(p)}
        label="TikTok"
        ratio={9 / 16}
        fit={p.media.every((m) => m.type === "image") ? "contain" : "cover"}
        overlay={chrome}
        indicators="counter"
        emptyLabel="TikTok richiede un video o delle foto"
      />
    </MockupFrame>
  );
}

// ─── YouTube Short ───────────────────────────────────────────────────────────

export function YouTubeShortMockup(p: MockupProps) {
  const title = p.text.trim().split("\n")[0] ?? "";
  const chrome = (
    <div className="absolute inset-0">
      <div aria-hidden="true">
        <RightRail
          items={[
            <ThumbIcon key="l" className="h-7 w-7" />,
            <ThumbIcon key="d" className="h-7 w-7 rotate-180" />,
            <CommentIcon key="c" className="h-7 w-7" />,
            <ShareArrowIcon key="s" className="h-7 w-7" />,
          ]}
        />
      </div>
      <div className={`absolute bottom-3 left-3 right-14 space-y-2 text-white ${SHADOW}`}>
        <div className="flex items-center gap-2" aria-hidden="true">
          <Avatar name={p.accountName} url={p.accountAvatarUrl} size={28} />
          <span className="truncate text-[14px] font-semibold">{toHandle(p.accountName)}</span>
          <span className="rounded-full bg-white px-3 py-1 text-[12px] font-semibold text-black [text-shadow:none]">
            Iscriviti
          </span>
        </div>
        {title ? (
          <Caption
            text={title}
            limit={CAPTION_LIMITS.youtube}
            linkClassName="font-semibold"
            moreLabel="altro"
            moreClassName="text-white/75"
            className="text-[14px] leading-snug"
          />
        ) : null}
      </div>
    </div>
  );

  return (
    <MockupFrame label="YouTube, Short" className={FRAME}>
      <MediaStage
        {...stageProps(p)}
        label="YouTube Short"
        ratio={9 / 16}
        overlay={chrome}
        indicators="counter"
        emptyLabel="Lo Short richiede un video"
      />
    </MockupFrame>
  );
}
