/**
 * Pure text edits behind the Markdown editor's toolbar. Each action returns
 * the range of the original text to replace, the replacement, and where the
 * selection goes afterwards (in the new text), so the editor can apply it
 * through the browser's undo stack.
 */

export type MarkdownAction = "bold" | "italic" | "h2" | "h3" | "ul" | "ol" | "quote" | "link";

export interface MarkdownEdit {
  /** Range of the original text to replace. */
  start: number;
  end: number;
  /** Replacement text. */
  text: string;
  /** Selection in the resulting text. */
  selectionStart: number;
  selectionEnd: number;
}

const WRAPS: Partial<Record<MarkdownAction, { marker: string; placeholder: string }>> = {
  bold: { marker: "**", placeholder: "grassetto" },
  italic: { marker: "_", placeholder: "corsivo" },
};

const LINE_PREFIX: Partial<Record<MarkdownAction, { prefix: string; strip: RegExp }>> = {
  h2: { prefix: "## ", strip: /^#{1,6}\s+/ },
  h3: { prefix: "### ", strip: /^#{1,6}\s+/ },
  ul: { prefix: "- ", strip: /^(?:[-*+]|\d+[.)])\s+/ },
  ol: { prefix: "1. ", strip: /^(?:[-*+]|\d+[.)])\s+/ },
  quote: { prefix: "> ", strip: /^>\s?/ },
};

export function applyMarkdownAction(text: string, selStart: number, selEnd: number, action: MarkdownAction): MarkdownEdit {
  const from = Math.max(0, Math.min(selStart, selEnd, text.length));
  const to = Math.min(text.length, Math.max(selStart, selEnd));
  const wrap = WRAPS[action];
  if (wrap) return toggleWrap(text, from, to, wrap.marker, wrap.placeholder);
  if (action === "link") return makeLink(text, from, to);
  return prefixLines(text, from, to, action);
}

function toggleWrap(text: string, from: number, to: number, marker: string, placeholder: string): MarkdownEdit {
  const m = marker.length;
  // Already wrapped around the selection: "**|testo|**".
  if (to > from && text.slice(from - m, from) === marker && text.slice(to, to + m) === marker) {
    const inner = text.slice(from, to);
    return { start: from - m, end: to + m, text: inner, selectionStart: from - m, selectionEnd: from - m + inner.length };
  }
  const selected = text.slice(from, to);
  // Selection includes the markers: "|**testo**|".
  if (selected.length > 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) {
    const inner = selected.slice(m, -m);
    return { start: from, end: to, text: inner, selectionStart: from, selectionEnd: from + inner.length };
  }
  if (!selected.trim()) {
    const insert = `${marker}${placeholder}${marker}`;
    return { start: from, end: to, text: insert, selectionStart: from + m, selectionEnd: from + m + placeholder.length };
  }
  // Keep surrounding spaces outside the markers ("**testo** ", not "**testo **").
  const lead = selected.length - selected.trimStart().length;
  const trail = selected.length - selected.trimEnd().length;
  const start = from + lead;
  const end = to - trail;
  const inner = text.slice(start, end);
  return {
    start,
    end,
    text: `${marker}${inner}${marker}`,
    selectionStart: start + m,
    selectionEnd: start + m + inner.length,
  };
}

function makeLink(text: string, from: number, to: number): MarkdownEdit {
  const selected = text.slice(from, to).trim();
  if (/^https?:\/\/\S+$/i.test(selected)) {
    const label = "testo del link";
    return {
      start: from,
      end: to,
      text: `[${label}](${selected})`,
      selectionStart: from + 1,
      selectionEnd: from + 1 + label.length,
    };
  }
  const label = selected || "testo del link";
  const insert = `[${label}](https://)`;
  const urlStart = from + label.length + 3;
  return { start: from, end: to, text: insert, selectionStart: urlStart, selectionEnd: urlStart + "https://".length };
}

function prefixLines(text: string, from: number, to: number, action: MarkdownAction): MarkdownEdit {
  const rule = LINE_PREFIX[action]!;
  const lineStart = text.lastIndexOf("\n", from - 1) + 1;
  // A selection ending right after a newline does not include the next line.
  const effectiveTo = to > from && text[to - 1] === "\n" ? to - 1 : to;
  const nextBreak = text.indexOf("\n", effectiveTo);
  const lineEnd = nextBreak < 0 ? text.length : nextBreak;
  const lines = text.slice(lineStart, lineEnd).split("\n");
  const content = lines.filter((line) => line.trim());

  const hasPrefix = (line: string) =>
    action === "ol" ? /^\d+[.)]\s+/.test(line) : action === "ul" ? /^[-*+]\s+/.test(line) : line.startsWith(rule.prefix);
  const exactHeading = (line: string) => line.startsWith(rule.prefix) && !line.startsWith(`${rule.prefix.trim()}#`);
  const allSet =
    content.length > 0 && content.every((line) => (action === "h2" || action === "h3" ? exactHeading(line) : hasPrefix(line)));

  let n = 0;
  const next = lines
    .map((line) => {
      if (!line.trim()) return line;
      const bare = line.replace(rule.strip, "");
      if (allSet) return bare;
      n++;
      return action === "ol" ? `${n}. ${bare}` : `${rule.prefix}${bare}`;
    })
    .join("\n");

  const single = lines.length === 1;
  return {
    start: lineStart,
    end: lineEnd,
    text: next,
    selectionStart: single ? lineStart + next.length : lineStart,
    selectionEnd: lineStart + next.length,
  };
}

/**
 * Inserts an image as its own paragraph at the cursor (blank lines around
 * it), selecting the alternative text so the author can describe it.
 */
export function insertImageMarkdown(text: string, selStart: number, selEnd: number, url: string, alt: string): MarkdownEdit {
  const from = Math.max(0, Math.min(selStart, selEnd, text.length));
  const to = Math.min(text.length, Math.max(selStart, selEnd));
  const before = text.slice(0, from);
  const after = text.slice(to);
  const lead = before.length === 0 || before.endsWith("\n\n") ? "" : before.endsWith("\n") ? "\n" : "\n\n";
  const trail = after.length === 0 || after.startsWith("\n\n") ? "" : after.startsWith("\n") ? "\n" : "\n\n";
  const label = alt.replace(/[[\]]/g, "").trim() || "Descrivi l'immagine";
  const safeUrl = url.replace(/[()\s]/g, (ch) => encodeURIComponent(ch));
  const insert = `${lead}![${label}](${safeUrl})${trail}`;
  const altStart = from + lead.length + 2;
  return { start: from, end: to, text: insert, selectionStart: altStart, selectionEnd: altStart + label.length };
}
