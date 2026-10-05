/**
 * Text-first mockups: X, Threads, Bluesky. Media sit in a rounded box under
 * the text, as in the real timelines.
 */

import Caption from "./caption";
import { CAPTION_LIMITS, formatPublishDate, toHandle } from "./helpers";
import {
  BookmarkIcon,
  ChartIcon,
  CommentIcon,
  HeartIcon,
  MoreIcon,
  RepostIcon,
  SendIcon,
} from "./icons";
import MediaStage from "./media-stage";
import { Avatar, MockupFrame, stageProps } from "./parts";
import type { MockupProps } from "./types";

// ─── X ───────────────────────────────────────────────────────────────────────

export function XPost(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "short", p.timeZone);
  return (
    <MockupFrame label="X, post" className="max-w-[600px] rounded-lg border border-[#eff3f4] bg-white text-[#0f1419]">
      <div className="flex gap-3 px-4 py-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-1 text-[15px]">
            <span className="min-w-0 truncate font-bold">{p.accountName}</span>
            <span className="min-w-0 shrink-[4] truncate text-[#536471]">{toHandle(p.accountName)}</span>
            {date ? <span className="shrink-0 text-[#536471]">· {date}</span> : null}
            <MoreIcon className="ml-auto h-4 w-4 shrink-0 self-center text-[#536471]" />
          </p>
          {p.text.trim() ? (
            <Caption
              text={p.text}
              limit={CAPTION_LIMITS.twitter}
              linkClassName="text-[#1d9bf0]"
              moreLabel="Mostra altro"
              moreClassName="text-[#1d9bf0]"
              moreOnNewLine
              className="mt-0.5 text-[15px] leading-5"
            />
          ) : null}
          {p.media.length > 0 ? (
            <MediaStage
              {...stageProps(p)}
              label="Post X"
              layout="grid"
              ratio={{ min: 3 / 4, max: 1.91, fallback: 16 / 9 }}
              videoRatio={16 / 9}
              fit="cover"
              indicators="counter"
              frameClassName="rounded-2xl border border-[#cfd9de]"
              className="mt-3"
            />
          ) : null}
          <div className="mt-3 flex max-w-[425px] justify-between text-[#536471]" aria-hidden="true">
            <CommentIcon className="h-[18px] w-[18px]" />
            <RepostIcon className="h-[18px] w-[18px]" />
            <HeartIcon className="h-[18px] w-[18px]" />
            <ChartIcon className="h-[18px] w-[18px]" />
            <BookmarkIcon className="h-[18px] w-[18px]" />
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ─── Threads ─────────────────────────────────────────────────────────────────

export function ThreadsPost(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "short", p.timeZone);
  return (
    <MockupFrame label="Threads, post" className="max-w-[600px] rounded-lg border border-[#e5e5e5] bg-white text-black">
      <div className="flex gap-3 px-4 py-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={36} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-2 text-[15px]">
            <span className="truncate font-semibold">{toHandle(p.accountName).slice(1)}</span>
            {date ? <span className="shrink-0 text-[#999]">{date}</span> : null}
            <MoreIcon className="ml-auto h-4 w-4 shrink-0 self-center" />
          </p>
          {p.text.trim() ? (
            <Caption
              text={p.text}
              limit={CAPTION_LIMITS.threads}
              linkClassName="text-[#0095f6]"
              moreLabel="Altro"
              moreClassName="text-[#999]"
              moreOnNewLine
              className="mt-0.5 text-[15px] leading-[1.4]"
            />
          ) : null}
          {p.media.length > 0 ? (
            <MediaStage
              {...stageProps(p)}
              label="Post Threads"
              ratio={{ min: 3 / 4, max: 1.91, fallback: 4 / 5 }}
              indicators="counter"
              frameClassName="rounded-lg"
              className="mt-2"
            />
          ) : null}
          <div className="mt-3 flex gap-5" aria-hidden="true">
            <HeartIcon className="h-5 w-5" />
            <CommentIcon className="h-5 w-5" />
            <RepostIcon className="h-5 w-5" />
            <SendIcon className="h-5 w-5" />
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}

// ─── Bluesky ─────────────────────────────────────────────────────────────────

export function BlueskyPost(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "short", p.timeZone);
  return (
    <MockupFrame label="Bluesky, post" className="max-w-[600px] rounded-lg border border-[#d4dbe2] bg-white text-[#0b0f14]">
      <div className="flex gap-3 px-4 py-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={42} />
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-baseline gap-1 text-[15px]">
            <span className="min-w-0 truncate font-semibold">{p.accountName}</span>
            <span className="min-w-0 shrink-[4] truncate text-[#6f869f]">{toHandle(p.accountName)}.bsky.social</span>
            {date ? <span className="shrink-0 text-[#6f869f]">· {date}</span> : null}
          </p>
          {p.text.trim() ? (
            <Caption
              text={p.text}
              limit={CAPTION_LIMITS.bluesky}
              linkClassName="text-[#1083fe]"
              moreLabel="Mostra altro"
              moreClassName="text-[#1083fe]"
              moreOnNewLine
              className="mt-0.5 text-[15px] leading-5"
            />
          ) : null}
          {p.media.length > 0 ? (
            <MediaStage
              {...stageProps(p)}
              label="Post Bluesky"
              layout="grid"
              ratio={{ min: 3 / 4, max: 1.91, fallback: 16 / 9 }}
              indicators="counter"
              frameClassName="rounded-xl border border-[#d4dbe2]"
              className="mt-2"
            />
          ) : null}
          <div className="mt-3 flex max-w-[320px] justify-between text-[#6f869f]" aria-hidden="true">
            <CommentIcon className="h-[18px] w-[18px]" />
            <RepostIcon className="h-[18px] w-[18px]" />
            <HeartIcon className="h-[18px] w-[18px]" />
            <MoreIcon className="h-[18px] w-[18px]" />
          </div>
        </div>
      </div>
    </MockupFrame>
  );
}
