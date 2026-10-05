"use client";

/**
 * Caption with the networks' "… altro" expander and highlighted
 * #hashtags, @mentions and links. Links are not followed from a preview:
 * they are styled like the network does, nothing more.
 */

import { useState } from "react";
import { tokenizeCaption, truncateCaption, type CaptionLimit } from "./helpers";

export interface CaptionProps {
  text: string;
  limit: CaptionLimit;
  /** Bold account name before the text (Instagram, TikTok first line). */
  lead?: string;
  leadClassName?: string;
  /** Hashtags, mentions and links. */
  linkClassName: string;
  /** "altro", "Altro...", "…altro", "Mostra altro". */
  moreLabel?: string;
  moreClassName?: string;
  /** Put the expander on its own line (X/Threads). */
  moreOnNewLine?: boolean;
  className?: string;
}

export default function Caption({
  text,
  limit,
  lead,
  leadClassName = "font-semibold",
  linkClassName,
  moreLabel = "altro",
  moreClassName = "text-current opacity-60",
  moreOnNewLine = false,
  className = "",
}: CaptionProps) {
  const [expanded, setExpanded] = useState(false);
  const cut = truncateCaption(text, limit);
  const shown = expanded || !cut.truncated ? text : cut.text;

  return (
    <p className={`whitespace-pre-line break-words ${className}`}>
      {lead ? <span className={leadClassName}>{lead} </span> : null}
      <RichText text={shown} linkClassName={linkClassName} />
      {cut.truncated && !expanded ? (
        <>
          {moreOnNewLine ? <br /> : <span aria-hidden="true">… </span>}
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className={`pointer-events-auto inline cursor-pointer ${moreClassName}`}
            aria-label={`${moreLabel}: mostra tutto il testo`}
          >
            {moreLabel}
          </button>
        </>
      ) : null}
    </p>
  );
}

/** Same token styling, never truncated (first comments, titles). */
export function RichText({ text, linkClassName }: { text: string; linkClassName: string }) {
  return (
    <>
      {tokenizeCaption(text).map((token, i) =>
        token.kind === "text" ? (
          <span key={i}>{token.value}</span>
        ) : (
          <span key={i} className={linkClassName}>
            {token.value}
          </span>
        )
      )}
    </>
  );
}
