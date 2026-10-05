/* eslint-disable @next/next/no-img-element -- avatars are arbitrary public URLs, not next/image sources */

/**
 * Small pieces shared by the mockups (no state, safe in server components).
 */

import type { ReactNode } from "react";
import { RichText } from "./caption";
import { initials } from "./helpers";
import type { MockupProps } from "./types";

/** Account picture, or initials on a neutral circle when there is none. */
export function Avatar({
  name,
  url,
  size = 32,
  square = false,
  ring = false,
  className = "",
}: {
  name: string;
  url?: string | null;
  size?: number;
  /** LinkedIn company pages use square logos. */
  square?: boolean;
  /** Instagram story ring. */
  ring?: boolean;
  className?: string;
}) {
  const shape = square ? "rounded-md" : "rounded-full";
  const picture = url ? (
    <img
      src={url}
      alt=""
      referrerPolicy="no-referrer"
      className={`block shrink-0 object-cover ${shape}`}
      style={{ width: size, height: size }}
    />
  ) : (
    <span
      aria-hidden="true"
      className={`flex shrink-0 items-center justify-center bg-[#dbdbdb] font-semibold text-[#262626] [text-shadow:none] ${shape}`}
      style={{ width: size, height: size, fontSize: Math.max(10, Math.round(size * 0.38)) }}
    >
      {initials(name)}
    </span>
  );
  if (!ring) return <span className={`inline-flex shrink-0 ${className}`}>{picture}</span>;
  return (
    <span className={`inline-flex shrink-0 rounded-full border-2 border-[#d62976] p-[2px] ${className}`}>
      {picture}
    </span>
  );
}

/** Outer frame of every mockup: an accessible, labelled article. */
export function MockupFrame({
  label,
  className = "",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article aria-label={`Anteprima ${label}`} className={`mx-auto w-full ${className}`}>
      {children}
    </article>
  );
}

/** Icon + optional text inside a decorative action row (likes, comments…). */
export function ActionGlyph({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" aria-hidden="true">
      {children}
      {label ? <span className="text-[13px] font-semibold">{label}</span> : null}
    </span>
  );
}

/** The props MediaStage takes from a mockup, passed through untouched. */
export function stageProps(p: MockupProps) {
  return {
    media: p.media,
    pins: p.pins,
    onMediaClick: p.onMediaClick,
    markers: p.markers,
    onRequestComment: p.onRequestComment,
    onTimeChange: p.onTimeChange,
    registerTimeGetter: p.registerTimeGetter,
    seekTo: p.seekTo,
  };
}

/** First comment published by the account right after the post. */
export function FirstComment({
  accountName,
  text,
  linkClassName,
  className = "",
}: {
  accountName: string;
  text?: string | null;
  linkClassName: string;
  className?: string;
}) {
  if (!text?.trim()) return null;
  return (
    <div className={className}>
      <p className="text-[12px] text-[#737373]">Primo commento</p>
      <p className="whitespace-pre-line break-words text-[14px] leading-snug">
        <span className="font-semibold">{accountName}</span> <RichText text={text} linkClassName={linkClassName} />
      </p>
    </div>
  );
}
