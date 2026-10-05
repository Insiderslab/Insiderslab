/**
 * Remaining networks: Pinterest pin, YouTube video (16:9), Google Business
 * update. Title = first line of the text, as the agency writes it.
 */

import Caption from "./caption";
import { CAPTION_LIMITS, formatPublishDate } from "./helpers";
import { MoreIcon, PinMapIcon, ShareArrowIcon, ThumbIcon } from "./icons";
import MediaStage from "./media-stage";
import { Avatar, MockupFrame, stageProps } from "./parts";
import type { MockupProps } from "./types";

function splitTitle(text: string): { title: string; body: string } {
  const trimmed = text.trim();
  const newline = trimmed.indexOf("\n");
  if (newline === -1) return { title: trimmed, body: "" };
  return { title: trimmed.slice(0, newline).trim(), body: trimmed.slice(newline + 1).trim() };
}

// ─── Pinterest ───────────────────────────────────────────────────────────────

export function PinterestPin(p: MockupProps) {
  const { title, body } = splitTitle(p.text);
  return (
    <MockupFrame label="Pinterest, pin" className="max-w-[360px] bg-white text-[#111]">
      <MediaStage
        {...stageProps(p)}
        label="Pin Pinterest"
        ratio={{ min: 1 / 2, max: 1.5, fallback: 2 / 3 }}
        indicators="dots"
        frameClassName="rounded-2xl"
        dotsClassName="pt-1"
        emptyLabel="Pinterest richiede un'immagine"
      />
      <div className="space-y-2 px-1 pt-2">
        {title ? <p className="text-[16px] font-semibold leading-snug">{title}</p> : null}
        <div className="flex items-center gap-2">
          <Avatar name={p.accountName} url={p.accountAvatarUrl} size={32} />
          <span className="truncate text-[14px] font-semibold">{p.accountName}</span>
          <MoreIcon className="ml-auto h-5 w-5" />
        </div>
        {body ? (
          <Caption
            text={body}
            limit={CAPTION_LIMITS.pinterest}
            linkClassName="font-semibold"
            moreLabel="altro"
            moreClassName="font-semibold"
            className="text-[14px] leading-snug"
          />
        ) : null}
      </div>
    </MockupFrame>
  );
}

// ─── YouTube video ───────────────────────────────────────────────────────────

export function YouTubeVideo(p: MockupProps) {
  const { title, body } = splitTitle(p.text);
  const date = formatPublishDate(p.publishAt, "long", p.timeZone);
  return (
    <MockupFrame label="YouTube, video" className="max-w-[640px] bg-white text-[#0f0f0f]">
      <MediaStage
        {...stageProps(p)}
        label="Video YouTube"
        ratio={16 / 9}
        fit="contain"
        indicators="counter"
        frameClassName="rounded-xl"
        emptyLabel="YouTube richiede un video"
      />
      <div className="space-y-3 px-1 pt-3">
        {title ? <p className="text-[18px] font-bold leading-snug">{title}</p> : null}
        <div className="flex items-center gap-2.5">
          <Avatar name={p.accountName} url={p.accountAvatarUrl} size={40} />
          <span className="min-w-0 flex-1 truncate text-[16px] font-semibold">{p.accountName}</span>
          <span className="rounded-full bg-[#0f0f0f] px-4 py-2 text-[14px] font-semibold text-white" aria-hidden="true">
            Iscriviti
          </span>
        </div>
        <div className="flex gap-2 text-[14px] font-semibold" aria-hidden="true">
          <span className="flex items-center gap-1.5 rounded-full bg-[#f2f2f2] px-3 py-1.5">
            <ThumbIcon className="h-4 w-4" /> Mi piace
          </span>
          <span className="flex items-center gap-1.5 rounded-full bg-[#f2f2f2] px-3 py-1.5">
            <ShareArrowIcon className="h-4 w-4" /> Condividi
          </span>
        </div>
        {body || date ? (
          <div className="rounded-xl bg-[#f2f2f2] px-3 py-2.5 text-[14px]">
            {date ? <p className="font-semibold">{date}</p> : null}
            {body ? (
              <Caption
                text={body}
                limit={CAPTION_LIMITS.youtube}
                linkClassName="text-[#065fd4]"
                moreLabel="altro"
                moreClassName="font-semibold"
                className="leading-snug"
              />
            ) : null}
          </div>
        ) : null}
      </div>
    </MockupFrame>
  );
}

// ─── Google Business ─────────────────────────────────────────────────────────

export function GoogleBusinessPost(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "long", p.timeZone);
  return (
    <MockupFrame
      label="Google Business, aggiornamento"
      className="max-w-[420px] overflow-hidden rounded-lg border border-[#dadce0] bg-white text-[#202124]"
    >
      <header className="flex items-center gap-3 px-4 py-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-medium">{p.accountName}</p>
          <p className="flex items-center gap-1 text-[12px] text-[#70757a]">
            <PinMapIcon className="h-3 w-3" />
            {date ?? "Aggiornamento"}
          </p>
        </div>
      </header>
      {p.media.length > 0 ? (
        <MediaStage {...stageProps(p)} label="Aggiornamento Google Business" ratio={4 / 3} indicators="dots" dotsClassName="pt-1" />
      ) : null}
      {p.text.trim() ? (
        <Caption
          text={p.text}
          limit={CAPTION_LIMITS.gmb}
          linkClassName="text-[#1a73e8]"
          moreLabel="Altro"
          moreClassName="font-medium text-[#1a73e8]"
          className="px-4 py-3 text-[14px] leading-[1.45]"
        />
      ) : null}
    </MockupFrame>
  );
}
