/**
 * Pure DOM helpers of the review script: which element the client means,
 * a CSS selector to find it again, its visible text — NEVER the values of
 * form fields — and the page address without hash, tracking or
 * credential-like parameters. Exported for the unit tests (happy-dom).
 */

const FIELD = "input,textarea,select,option,[contenteditable],[contenteditable] *";
const SKIP = "input,textarea,select,option,script,style,noscript,template,svg,[contenteditable],[data-heili-ignore]";
const SENSITIVE = /^(utm_.*|fbclid|gclid|msclkid|mc_eid)$|token|key|session|auth|pass|secret/i;

/** Page address that may leave the page: no hash, no tracking/credential-like parameters. */
export function cleanUrl(href: string): string {
  try {
    const url = new URL(href);
    url.hash = "";
    url.username = "";
    url.password = "";
    const drop: string[] = [];
    url.searchParams.forEach((_v, name) => {
      if (SENSITIVE.test(name)) drop.push(name);
    });
    drop.forEach((name) => url.searchParams.delete(name));
    return url.toString();
  } catch {
    return "";
  }
}

/** Single line, at most `max` characters. */
export function clip(text: string, max: number): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** True for form fields (and anything inside an editable area). */
export function isField(el: Element): boolean {
  return el.matches(FIELD);
}

/**
 * The element to comment: a field becomes its container (label, fieldset,
 * form or the nearest block), so nothing typed in it is ever read.
 */
export function pickTarget(el: Element): { el: Element; field: boolean } {
  if (!isField(el)) return { el, field: false };
  let node: Element | null = el.parentElement;
  while (node && (isField(node) || !node.matches("label,fieldset,form,div,section,li,p,main,body"))) node = node.parentElement;
  return { el: node ?? document.body, field: true };
}

/** Visible text of an element, skipping fields, scripts and [data-heili-ignore]. */
export function textOf(el: Element, max = 160): string {
  const parts: string[] = [];
  let length = 0;
  const walk = (node: Node) => {
    if (length > max * 2) return;
    if (node.nodeType === 3) {
      const text = node.textContent || "";
      parts.push(text);
      length += text.length;
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    if (element.matches(SKIP)) return;
    if (element.tagName === "IMG") {
      const alt = element.getAttribute("alt");
      if (alt) parts.push(` ${alt} `);
    }
    element.childNodes.forEach(walk);
  };
  if (!el.matches(SKIP)) walk(el);
  return clip(parts.join(" "), max);
}

/** Nearest heading of the element's section (≤ 120). */
export function headingOf(el: Element): string {
  let node: Element | null = el;
  while (node) {
    if (/^H[1-3]$/.test(node.tagName)) return textOf(node, 120);
    const heading = node.querySelector("h1,h2,h3");
    if (heading && node !== document.body) return textOf(heading, 120);
    node = node.parentElement;
  }
  const h1 = document.querySelector("h1");
  return h1 ? textOf(h1, 120) : "";
}

function stableId(id: string): boolean {
  return /^[A-Za-z][\w-]{0,40}$/.test(id) && !/\d{4,}|[a-f0-9]{8,}/i.test(id);
}

function unique(selector: string, el: Element): boolean {
  try {
    const found = document.querySelectorAll(selector);
    return found.length === 1 && found[0] === el;
  } catch {
    return false;
  }
}

function attr(value: string): string {
  return value.replace(/["\\]/g, "\\$&");
}

/**
 * Selector to find the element again: a stable id, data-testid, aria-label,
 * else a `tag:nth-of-type` path of at most 5 levels (from the nearest stable
 * id). Hash-like ids and classes are never used. ≤ 300 characters.
 */
export function selectorOf(el: Element): string {
  const tag = el.tagName.toLowerCase();
  if (el.id && stableId(el.id) && unique(`#${el.id}`, el)) return `#${el.id}`;
  const testId = el.getAttribute("data-testid");
  if (testId && unique(`[data-testid="${attr(testId)}"]`, el)) return `[data-testid="${attr(testId)}"]`;
  const label = el.getAttribute("aria-label");
  if (label && label.length < 80 && unique(`${tag}[aria-label="${attr(label)}"]`, el)) return `${tag}[aria-label="${attr(label)}"]`;
  const steps: string[] = [];
  let node: Element | null = el;
  while (node && node !== document.body && node !== document.documentElement && steps.length < 5) {
    if (node !== el && node.id && stableId(node.id)) {
      steps.unshift(`#${node.id}`);
      break;
    }
    const name = node.tagName.toLowerCase();
    let index = 1;
    let sibling = node.previousElementSibling;
    while (sibling) {
      if (sibling.tagName === node.tagName) index += 1;
      sibling = sibling.previousElementSibling;
    }
    steps.unshift(`${name}:nth-of-type(${index})`);
    node = node.parentElement;
  }
  if (node === document.body) steps.unshift("body");
  return steps.join(" > ").slice(0, 300);
}

export type FindMethod = "selector" | "text" | "scroll" | "none";

/**
 * Finds a commented element again: 1) the selector, when its text still
 * matches; 2) an element with the same text (≤ 5000 nodes); 3) nothing
 * (the caller scrolls to the saved position).
 */
export function findElement(selector: string, text: string): { el: Element | null; method: FindMethod } {
  let el: Element | null = null;
  try {
    el = document.querySelector(selector);
  } catch {
    el = null;
  }
  const want = clip(text, 160);
  if (el && (!want || textOf(el) === want)) return { el, method: "selector" };
  if (want) {
    const all = document.body.getElementsByTagName("*");
    let best: Element | null = null;
    for (let i = 0; i < all.length && i < 5000; i += 1) {
      if (textOf(all[i]) === want) best = all[i];
    }
    if (best) return { el: best, method: "text" };
  }
  return { el: null, method: "scroll" };
}
