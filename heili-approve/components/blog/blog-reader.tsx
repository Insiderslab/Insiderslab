"use client";

/**
 * BlogReader — the client's reading and review view of an article.
 *
 * - Comfortable on a phone: ~68 characters per line, 17–18px body.
 * - Selecting text shows "Commenta questa frase": a floating bubble above
 *   the selection with a mouse, a sticky button at the bottom of the screen
 *   on touch screens (where the system menu sits next to the selection).
 *   Tapping it calls onCommentRequest(anchor) with a BlogAnchor.
 * - Commented passages are highlighted with their number; tapping one calls
 *   onCommentOpen(id) so the parent opens the thread. activeCommentId
 *   scrolls to and outlines a highlight.
 * - Comments whose passage no longer exists (the text was rewritten) are not
 *   lost: they are listed under "Commenti su testo modificato".
 *
 * The body is the sanitized HTML from renderMarkdownSafe, rendered on the
 * server and passed in `html`: this component only anchors text (blog-text),
 * so the Markdown renderer and sanitizer never ship to the phone.
 * Highlights are <mark> elements added to that DOM after render and removed
 * before the next one; their numbers are CSS pseudo-elements, so the text
 * (and every offset computed from it) never changes.
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  buildAnchor,
  countWords,
  findAnchor,
  htmlToTextWithBlocks,
  readingMinutesForWords,
  type AnchorMatch,
} from "@/lib/content/blog-text";
import type { BlogAnchor, BlogContent } from "@/lib/content/types";
import ArticleHeader from "./article-header";
import {
  ARTICLE_BODY_CLASS,
  ARTICLE_WIDTH_CLASS,
  COMMENT_MARK_ACTIVE_CLASS,
  COMMENT_MARK_BADGE_CLASS,
  COMMENT_MARK_BADGE_RESOLVED_CLASS,
  COMMENT_MARK_CLASS,
  COMMENT_MARK_MOVED_CLASS,
  COMMENT_MARK_RESOLVED_CLASS,
} from "./prose";

export interface BlogReaderComment {
  id: string;
  /** Number shown on the highlight and in the comment list. */
  number: number;
  anchor: BlogAnchor;
  resolved: boolean;
}

export interface BlogReaderProps {
  content: BlogContent;
  /** renderMarkdownSafe(content.bodyMarkdown), rendered on the server. Never unsanitized HTML. */
  html: string;
  /** Anchored comments on this version. */
  comments: BlogReaderComment[];
  /** Absent = read-only (no "Commenta" bubble). */
  onCommentRequest?: (anchor: BlogAnchor) => void;
  /** A highlight (or an entry under "Commenti su testo modificato") was tapped. */
  onCommentOpen?: (commentId: string) => void;
  /** Scrolls to and outlines this comment's highlight. */
  activeCommentId?: string | null;
  /** Highlight resolved comments too (in green). Default true. */
  showResolved?: boolean;
  /** "7 ottobre 2026", the planned publication date. */
  dateLabel?: string | null;
  /** Label of the bubble. */
  commentLabel?: string;
  className?: string;
}

type Placement = { comment: BlogReaderComment; match: AnchorMatch | null };

interface SelectionDraft {
  anchor: BlogAnchor;
  /** Bubble position relative to the reader's box (mouse only). */
  top: number;
  left: number;
  below: boolean;
  touch: boolean;
}

const BLOCK_PARENTS = new Set(["UL", "OL", "TABLE", "THEAD", "TBODY", "TFOOT", "TR", "BLOCKQUOTE", "FIGURE"]);

export default function BlogReader({
  content,
  html,
  comments,
  onCommentRequest,
  onCommentOpen,
  activeCommentId = null,
  showResolved = true,
  dateLabel,
  commentLabel = "Commenta questa frase",
  className = "",
}: BlogReaderProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const pointerTypeRef = useRef<string>("mouse");
  const pressingBubbleRef = useRef(false);
  const [draft, setDraft] = useState<SelectionDraft | null>(null);

  const model = useMemo(() => htmlToTextWithBlocks(html), [html]);
  const readingMinutes = useMemo(() => readingMinutesForWords(countWords(model.text)), [model]);

  const visible = useMemo(
    () => comments.filter((c) => showResolved || !c.resolved),
    [comments, showResolved]
  );
  const placements = useMemo<Placement[]>(
    () => visible.map((comment) => ({ comment, match: findAnchor(model.text, comment.anchor, { blockStarts: model.blockStarts }) })),
    [visible, model]
  );
  const unanchored = placements.filter((p) => p.match === null).map((p) => p.comment);

  // ── Highlights ────────────────────────────────────────────────────────────
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root) return;
    let list = placements;
    // The browser's parse of the HTML should give exactly model.text; if it
    // does not (unusual markup), anchor against what is really on screen.
    const domText = root.textContent ?? "";
    if (domText !== model.text) {
      list = visible.map((comment) => ({ comment, match: findAnchor(domText, comment.anchor) }));
    }
    const created: HTMLElement[] = [];
    const ordered = list
      .filter((p): p is { comment: BlogReaderComment; match: AnchorMatch } => p.match !== null)
      .sort((a, b) => a.match.start - b.match.start || b.match.end - a.match.end);
    for (const { comment, match } of ordered) {
      created.push(...wrapRange(root, match, comment, comment.id === activeCommentId));
    }
    return () => {
      for (const mark of created) {
        const parent = mark.parentNode;
        if (!parent) continue;
        while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
        parent.removeChild(mark);
      }
      root.normalize();
    };
  }, [html, placements, visible, model, activeCommentId]);

  useEffect(() => {
    if (!activeCommentId) return;
    const mark = bodyRef.current?.querySelector<HTMLElement>(`mark[data-comment-id="${cssEscape(activeCommentId)}"]`);
    mark?.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }, [activeCommentId]);

  // ── Selection → "Commenta questa frase" ──────────────────────────────────
  const readSelection = useCallback((): SelectionDraft | null => {
    const root = bodyRef.current;
    const box = boxRef.current;
    const selection = typeof window !== "undefined" ? window.getSelection() : null;
    if (!root || !box || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const range = selection.getRangeAt(0);
    if (!range.intersectsNode(root)) return null;

    // Clamp to the article body (a selection may start in the header).
    const clamped = range.cloneRange();
    if (!root.contains(clamped.startContainer)) clamped.setStart(root, 0);
    if (!root.contains(clamped.endContainer)) clamped.setEnd(root, root.childNodes.length);

    const before = document.createRange();
    before.selectNodeContents(root);
    before.setEnd(clamped.startContainer, clamped.startOffset);
    const start = before.toString().length;
    const end = start + clamped.toString().length;

    const startElement =
      clamped.startContainer.nodeType === Node.ELEMENT_NODE
        ? (clamped.startContainer as Element)
        : clamped.startContainer.parentElement;
    const block = startElement?.closest("[data-block]");
    const blockIndex = block && root.contains(block) ? Number(block.getAttribute("data-block")) : null;

    const anchor = buildAnchor(root.textContent ?? "", start, end, Number.isFinite(blockIndex) ? blockIndex : null);
    if (!anchor) return null;

    const rect = clamped.getBoundingClientRect();
    const boxRect = box.getBoundingClientRect();
    const below = rect.top < 72;
    return {
      anchor,
      top: (below ? rect.bottom : rect.top) - boxRect.top,
      left: Math.min(Math.max(rect.left + rect.width / 2 - boxRect.left, 80), Math.max(80, boxRect.width - 80)),
      below,
      touch: pointerTypeRef.current !== "mouse",
    };
  }, []);

  useEffect(() => {
    if (!onCommentRequest) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const update = () => {
      const next = readSelection();
      if (next) setDraft(next);
      else if (!pressingBubbleRef.current) setDraft(null);
    };
    // Touch: selection handles move for a while, so wait for them to settle.
    const onSelectionChange = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, pointerTypeRef.current === "mouse" ? 120 : 300);
    };
    // Mouse/keyboard: show the bubble as soon as the selection is done.
    const onRelease = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(update, 0);
    };
    document.addEventListener("selectionchange", onSelectionChange);
    document.addEventListener("mouseup", onRelease);
    document.addEventListener("keyup", onRelease);
    return () => {
      if (timer) clearTimeout(timer);
      document.removeEventListener("selectionchange", onSelectionChange);
      document.removeEventListener("mouseup", onRelease);
      document.removeEventListener("keyup", onRelease);
    };
  }, [onCommentRequest, readSelection]);

  function requestComment() {
    pressingBubbleRef.current = false;
    if (!draft || !onCommentRequest) return;
    onCommentRequest(draft.anchor);
    window.getSelection()?.removeAllRanges();
    setDraft(null);
  }

  // ── Opening a highlight ───────────────────────────────────────────────────
  function openFrom(target: EventTarget | null): boolean {
    if (!onCommentOpen || !(target instanceof Element)) return false;
    const mark = target.closest<HTMLElement>("mark[data-comment-id]");
    if (!mark || !bodyRef.current?.contains(mark)) return false;
    // A tap that ends a selection is not an "open".
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) return false;
    onCommentOpen(mark.dataset.commentId!);
    return true;
  }

  return (
    <div ref={boxRef} className={`relative space-y-8 ${className}`}>
      <ArticleHeader content={content} readingMinutes={readingMinutes} dateLabel={dateLabel} />

      {onCommentRequest && (
        <p className={`${ARTICLE_WIDTH_CLASS} rounded-md border border-border bg-surface px-3 py-2 text-sm text-muted`}>
          Per commentare un passaggio selezionalo (sul telefono tieni premuto su una parola e allarga la selezione),
          poi tocca <span className="font-medium text-foreground">«{commentLabel}»</span>.
        </p>
      )}

      {html ? (
        <div
          ref={bodyRef}
          className={`${ARTICLE_WIDTH_CLASS} ${ARTICLE_BODY_CLASS}`}
          onPointerDown={(event) => {
            pointerTypeRef.current = event.pointerType || "mouse";
          }}
          onClick={(event) => {
            openFrom(event.target);
          }}
          onKeyDown={(event) => {
            if ((event.key === "Enter" || event.key === " ") && openFrom(event.target)) event.preventDefault();
          }}
          // Sanitized by renderMarkdownSafe on the server (see the props).
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <p className={`${ARTICLE_WIDTH_CLASS} text-muted`}>L&apos;articolo non ha ancora un testo.</p>
      )}

      {unanchored.length > 0 && (
        <section
          className={`${ARTICLE_WIDTH_CLASS} space-y-2 rounded-lg border border-border bg-surface p-4`}
          aria-labelledby="blog-reader-moved"
        >
          <h2 id="blog-reader-moved" className="text-sm font-semibold">
            Commenti su testo modificato
          </h2>
          <p className="text-xs text-muted">Il passaggio commentato è stato riscritto e non si trova più nel testo.</p>
          <ul className="space-y-2">
            {unanchored.map((comment) => (
              <li key={comment.id}>
                <button
                  type="button"
                  onClick={() => onCommentOpen?.(comment.id)}
                  disabled={!onCommentOpen}
                  className={`flex w-full items-start gap-2 rounded-md border bg-background p-2 text-left text-sm hover:border-border-hover disabled:cursor-default ${
                    comment.id === activeCommentId ? "border-accent" : "border-border"
                  }`}
                >
                  <NumberBadge number={comment.number} resolved={comment.resolved} />
                  <span className="min-w-0">
                    <span className="line-clamp-3 break-words text-muted line-through decoration-muted/50">
                      «{comment.anchor.quote}»
                    </span>
                    {comment.resolved && <span className="text-xs text-success">Risolto</span>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {draft && onCommentRequest && (
        <CommentBubble
          draft={draft}
          label={commentLabel}
          onPress={() => {
            pressingBubbleRef.current = true;
          }}
          onRelease={() => {
            // Let the click land first; a press dragged off the button then
            // stops pinning the bubble.
            setTimeout(() => {
              pressingBubbleRef.current = false;
            }, 400);
          }}
          onActivate={requestComment}
        />
      )}
    </div>
  );
}

function CommentBubble({
  draft,
  label,
  onPress,
  onRelease,
  onActivate,
}: {
  draft: SelectionDraft;
  label: string;
  onPress: () => void;
  /** The press ended (the click, if any, follows right after). */
  onRelease: () => void;
  onActivate: () => void;
}) {
  const button = (
    <button
      type="button"
      // Keep the text selected while the button is pressed (mouse).
      onPointerDown={(event) => {
        onPress();
        if (event.pointerType === "mouse") event.preventDefault();
      }}
      onMouseDown={(event) => event.preventDefault()}
      onPointerUp={onRelease}
      onPointerCancel={onRelease}
      onClick={onActivate}
      className={
        draft.touch
          ? "flex min-h-12 w-full max-w-md items-center justify-center gap-2 rounded-full bg-accent px-5 text-base font-semibold text-white shadow-lg hover:bg-accent-hover"
          : "inline-flex min-h-9 items-center gap-1.5 whitespace-nowrap rounded-full bg-accent px-3.5 text-sm font-semibold text-white shadow-md hover:bg-accent-hover"
      }
    >
      <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 fill-current">
        <path d="M3 4.5A2.5 2.5 0 0 1 5.5 2h9A2.5 2.5 0 0 1 17 4.5v6a2.5 2.5 0 0 1-2.5 2.5H9l-3.6 3.1A.75.75 0 0 1 4.2 15.5V13A2.5 2.5 0 0 1 3 10.9V4.5Z" />
      </svg>
      {label}
    </button>
  );

  if (draft.touch) {
    // Above the portal's sticky DecisionBar (z-40), which it covers while a
    // passage is selected: a tap must never land on Approva / Chiedi modifiche.
    return (
      <div
        className="fixed inset-x-0 bottom-0 z-50 flex justify-center border-t border-border bg-background px-4 pt-3"
        style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
      >
        {button}
      </div>
    );
  }
  return (
    <div
      className={`absolute z-30 -translate-x-1/2 ${draft.below ? "translate-y-2" : "-translate-y-full pb-2"}`}
      style={{ top: draft.top, left: draft.left }}
    >
      {button}
    </div>
  );
}

function NumberBadge({ number, resolved }: { number: number; resolved: boolean }) {
  return (
    <span
      className={`inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full px-1 text-[11px] font-semibold text-white ${
        resolved ? "bg-success" : "bg-warning"
      }`}
    >
      {number}
    </span>
  );
}

/**
 * Wraps the text between two textContent offsets in <mark> elements (one
 * per text node it spans), returning them so they can be unwrapped.
 */
function wrapRange(root: HTMLElement, match: AnchorMatch, comment: BlogReaderComment, active: boolean): HTMLElement[] {
  const segments: Array<{ node: Text; from: number; to: number }> = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let offset = 0;
  for (let node = walker.nextNode() as Text | null; node; node = walker.nextNode() as Text | null) {
    const length = node.data.length;
    const from = Math.max(match.start, offset) - offset;
    const to = Math.min(match.end, offset + length) - offset;
    offset += length;
    if (to <= from) {
      if (offset >= match.end) break;
      continue;
    }
    // Newlines between blocks (inside <ul>, <table>…) are not part of the text a reader sees.
    const parent = node.parentElement;
    if (!node.data.slice(from, to).trim() && (parent === root || (parent && BLOCK_PARENTS.has(parent.tagName)))) continue;
    segments.push({ node, from, to });
    if (offset >= match.end) break;
  }

  const classes = [
    COMMENT_MARK_CLASS,
    comment.resolved ? COMMENT_MARK_RESOLVED_CLASS : "",
    match.exact ? "" : COMMENT_MARK_MOVED_CLASS,
    active ? COMMENT_MARK_ACTIVE_CLASS : "",
  ]
    .filter(Boolean)
    .join(" ");

  const marks: HTMLElement[] = [];
  segments.forEach(({ node, from, to }, i) => {
    let target = node;
    if (from > 0) target = target.splitText(from);
    if (to - from < target.data.length) target.splitText(to - from);
    const mark = document.createElement("mark");
    mark.dataset.commentId = comment.id;
    mark.className = classes;
    if (i === 0) {
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute(
        "aria-label",
        `Commento ${comment.number}${comment.resolved ? " (risolto)" : ""}${match.exact ? "" : ", su testo modificato"}`
      );
    }
    if (!match.exact) mark.title = "Il testo è cambiato: questo è il passaggio più simile";
    if (i === segments.length - 1) {
      mark.dataset.number = String(comment.number);
      mark.className = `${classes} ${COMMENT_MARK_BADGE_CLASS} ${comment.resolved ? COMMENT_MARK_BADGE_RESOLVED_CLASS : ""}`;
    }
    target.parentNode!.insertBefore(mark, target);
    mark.appendChild(target);
    marks.push(mark);
  });
  return marks;
}

function cssEscape(value: string): string {
  return typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, "\\$&");
}

function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
