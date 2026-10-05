/**
 * Feed mockups: Instagram post (single or carousel), Facebook post,
 * LinkedIn post. Plain markup; interaction lives in Caption and MediaStage.
 */

import Caption from "./caption";
import { CAPTION_LIMITS, formatPublishDate } from "./helpers";
import {
  BookmarkIcon,
  CommentIcon,
  GlobeIcon,
  HeartIcon,
  MoreIcon,
  RepostIcon,
  SendIcon,
  ShareArrowIcon,
  ThumbIcon,
} from "./icons";
import MediaStage from "./media-stage";
import { ActionGlyph, Avatar, FirstComment, MockupFrame, stageProps } from "./parts";
import type { MockupProps } from "./types";

// ─── Instagram feed ──────────────────────────────────────────────────────────

export function InstagramFeed(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "dayMonth", p.timeZone);
  return (
    <MockupFrame
      label="Instagram, post"
      className="max-w-[420px] overflow-hidden rounded-lg border border-[#dbdbdb] bg-white text-black"
    >
      <header className="flex items-center gap-2.5 px-3 py-2">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={32} ring />
        <p className="min-w-0 flex-1 truncate text-[14px] font-semibold">{p.accountName}</p>
        <MoreIcon className="h-5 w-5" />
      </header>

      {/* Instagram crops the feed between 4:5 and 1.91:1; videos show at 4:5. */}
      <MediaStage
        {...stageProps(p)}
        label="Post Instagram"
        ratio={{ min: 4 / 5, max: 1.91, fallback: 4 / 5 }}
        videoRatio={4 / 5}
        indicators="dots-counter"
        dotsClassName="pt-1"
        emptyLabel="Instagram richiede almeno un'immagine o un video"
      />

      <div className="flex items-center gap-4 px-3 pb-1 pt-2.5" aria-hidden="true">
        <HeartIcon />
        <CommentIcon />
        <SendIcon />
        <BookmarkIcon className="ml-auto h-6 w-6" />
      </div>

      <div className="space-y-1.5 px-3 pb-3 pt-1 text-[14px] leading-snug">
        {p.text.trim() ? (
          <Caption
            text={p.text}
            limit={CAPTION_LIMITS.instagramFeed}
            lead={p.accountName}
            linkClassName="text-[#00376b]"
            moreLabel="altro"
            moreClassName="text-[#737373]"
          />
        ) : null}
        <FirstComment accountName={p.accountName} text={p.firstCommentText} linkClassName="text-[#00376b]" />
        {date ? <p className="text-[12px] text-[#737373]">{date}</p> : null}
      </div>
    </MockupFrame>
  );
}

// ─── Facebook ────────────────────────────────────────────────────────────────

export function FacebookPost(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "time", p.timeZone);
  return (
    <MockupFrame
      label="Facebook, post"
      className="max-w-[500px] overflow-hidden rounded-lg border border-[#dadde1] bg-white text-[#050505]"
    >
      <header className="flex items-center gap-2 px-3 pb-2 pt-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] font-semibold">{p.accountName}</p>
          <p className="flex items-center gap-1 text-[13px] text-[#65676b]">
            {date ? <span>{date}</span> : null}
            {date ? <span aria-hidden="true">·</span> : null}
            <GlobeIcon className="h-3 w-3" />
            <span className="sr-only">Pubblico</span>
          </p>
        </div>
        <MoreIcon className="h-5 w-5 text-[#65676b]" />
      </header>

      {p.text.trim() ? (
        <Caption
          text={p.text}
          limit={CAPTION_LIMITS.facebook}
          linkClassName="text-[#0064d1]"
          moreLabel="Altro"
          moreClassName="font-semibold text-[#050505]"
          className="px-3 pb-3 text-[15px] leading-snug"
        />
      ) : null}

      {p.media.length > 0 ? (
        <MediaStage
          {...stageProps(p)}
          label="Post Facebook"
          layout="grid"
          ratio={{ min: 4 / 5, max: 1.91, fallback: 1 }}
          indicators="dots"
          dotsClassName="pt-1"
        />
      ) : null}

      <div
        className="mx-3 mt-2 flex items-center justify-around border-t border-[#ced0d4] py-1 text-[#65676b]"
        aria-hidden="true"
      >
        <ActionGlyph label="Mi piace">
          <ThumbIcon className="h-5 w-5" />
        </ActionGlyph>
        <ActionGlyph label="Commenta">
          <CommentIcon className="h-5 w-5" />
        </ActionGlyph>
        <ActionGlyph label="Condividi">
          <ShareArrowIcon className="h-5 w-5" />
        </ActionGlyph>
      </div>

      <FirstComment
        accountName={p.accountName}
        text={p.firstCommentText}
        linkClassName="text-[#0064d1]"
        className="mx-3 mb-3 rounded-2xl bg-[#f0f2f5] px-3 py-2"
      />
    </MockupFrame>
  );
}

// ─── LinkedIn ────────────────────────────────────────────────────────────────

export function LinkedInPost(p: MockupProps) {
  const date = formatPublishDate(p.publishAt, "short", p.timeZone);
  return (
    <MockupFrame
      label="LinkedIn, post"
      className="max-w-[555px] overflow-hidden rounded-lg border border-[#e0dfdc] bg-white text-[rgba(0,0,0,0.9)]"
    >
      <header className="flex items-start gap-2 px-3 pb-2 pt-3">
        <Avatar name={p.accountName} url={p.accountAvatarUrl} size={48} square />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-semibold">{p.accountName}</p>
          <p className="text-[12px] text-[#666]">Follower</p>
          <p className="flex items-center gap-1 text-[12px] text-[#666]">
            {date ? <span>{date}</span> : null}
            {date ? <span aria-hidden="true">·</span> : null}
            <GlobeIcon className="h-3 w-3" />
            <span className="sr-only">Pubblico</span>
          </p>
        </div>
        <MoreIcon className="h-5 w-5 text-[#666]" />
      </header>

      {p.text.trim() ? (
        <Caption
          text={p.text}
          limit={CAPTION_LIMITS.linkedin}
          linkClassName="font-semibold text-[#0a66c2]"
          moreLabel="altro"
          moreClassName="text-[#666]"
          className="px-3 pb-2 text-[14px] leading-[1.45]"
        />
      ) : null}

      {p.media.length > 0 ? (
        <MediaStage
          {...stageProps(p)}
          label="Post LinkedIn"
          layout="grid"
          ratio={{ min: 4 / 5, max: 1.91, fallback: 1.91 }}
          indicators="dots"
          dotsClassName="pt-1"
        />
      ) : null}

      <div
        className="mx-3 mt-1 grid grid-cols-4 border-t border-[#e0dfdc] py-1.5 text-[#666]"
        aria-hidden="true"
      >
        {[
          { label: "Consiglia", icon: <ThumbIcon className="h-5 w-5" /> },
          { label: "Commenta", icon: <CommentIcon className="h-5 w-5" /> },
          { label: "Diffondi", icon: <RepostIcon className="h-5 w-5" /> },
          { label: "Invia", icon: <SendIcon className="h-5 w-5" /> },
        ].map((action) => (
          <span key={action.label} className="flex flex-col items-center gap-0.5 text-[12px] font-semibold">
            {action.icon}
            {action.label}
          </span>
        ))}
      </div>

      <FirstComment
        accountName={p.accountName}
        text={p.firstCommentText}
        linkClassName="font-semibold text-[#0a66c2]"
        className="mx-3 mb-3 rounded-lg bg-[#f2f2f2] px-3 py-2"
      />
    </MockupFrame>
  );
}
