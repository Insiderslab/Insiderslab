/**
 * heili-review.js — the «Sul sito» review script of Approve by Heili
 * (docs/SITO-WEB.md). Installed on the agency's test site with
 *   <script src="https://approve.heili.cloud/heili-review.js" data-site="hs_…" defer></script>
 *
 * Inert for every normal visitor: unless the address carries
 * `#heili-review=<code>` (opened from the portal) or this tab already started
 * a review (our own flag in sessionStorage), it returns at once — no request,
 * no DOM, nothing read.
 *
 * When active it only finds the element the client taps and hosts an iframe
 * served by Approve (Heili, comments, login all live there, in Approve's own
 * origin). It never reads cookies, persistent storage or the values of form fields,
 * never sends anything to the network itself, and talks to the iframe only
 * with postMessage on an explicit origin and a random channel.
 */

import { cleanUrl, clip, findElement, headingOf, pickTarget, selectorOf, textOf, type FindMethod } from "./picker";

const FLAG = "heili-review";



type State = "closed" | "open" | "picking";

function start2(base: string, siteKey: string, code: string | null) {
  const channel = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
  const host = document.createElement("heili-review-root");
  host.setAttribute("data-heili-ignore", "");
  host.setAttribute("data-heili-state", "closed");
  const root = host.attachShadow({ mode: "closed" });
  root.append(el("style", "", STYLE));
  const frame = document.createElement("iframe");
  frame.title = "Heili";
  frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms allow-popups");
  frame.setAttribute("allow", "microphone");
  frame.setAttribute("referrerpolicy", "no-referrer");
  frame.src = `${base}/embed/site?k=${encodeURIComponent(siteKey)}#c=${channel}`;
  frame.className = "f closed";
  const bar = el("div", "bar");
  bar.append(el("span", "", "Tocca l'elemento da commentare"));
  const cancel = el("button", "", "Annulla") as HTMLButtonElement;
  bar.append(cancel);
  const hover = el("div", "box");
  const focusBox = el("div", "box focus");
  const layer = el("div", "layer");
  root.append(frame, layer, hover, focusBox, bar);
  document.body.append(host);

  let state: State = "closed";
  let ready = false;
  let markers: Array<{ n: number; selector: string; pageUrl: string; resolved: boolean }> = [];
  let focusTarget: Element | null = null;
  /** «Apri nel punto»: the outcome stays readable on the host (data-heili-state="focus:…"). */
  let focused: string | null = null;
  const picks: number[] = [];

  const send = (type: string, data: Record<string, unknown> = {}) => {
    const message = JSON.stringify({ v: 1, c: channel, type, ...data });
    if (message.length > 8192) return;
    frame.contentWindow?.postMessage(JSON.parse(message), base);
  };
  const page = () => ({
    url: cleanUrl(location.href),
    title: clip(document.title, 120),
    viewport: { w: innerWidth, h: innerHeight },
    scrollY: Math.max(0, Math.round(scrollY)),
  });
  const setState = (next: State, label?: string) => {
    state = next;
    const phone = innerWidth < 768;
    const shape = next === "open" ? (phone ? "sheet" : "panel") : next;
    frame.className = `f ${shape}`;
    bar.style.display = next === "picking" ? "flex" : "none";
    if (next !== "picking") hover.style.display = "none";
    host.setAttribute("data-heili-state", label ?? (focused && next !== "picking" ? focused : shape));
  };

  // The iframe may start listening a moment after its load event: say hello
  // until it answers (at most 15 s), always to Approve's exact origin.
  frame.addEventListener("load", () => {
    let tries = 0;
    const hello = () => {
      if (ready || tries++ > 30) return;
      send("hello", { siteKey, launchCode: code, page: page() });
      setTimeout(hello, 500);
    };
    hello();
  });

  addEventListener("message", (event: MessageEvent) => {
    if (event.source !== frame.contentWindow || event.origin !== base) return;
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data !== "object" || data.v !== 1 || data.c !== channel || typeof data.type !== "string") return;
    switch (data.type) {
      case "ready":
        ready = true;
        code = null;
        send("page", { page: page() });
        break;
      case "ui":
        if (data.state === "open" || data.state === "closed") setState(data.state);
        break;
      case "pick:start":
        if (ready) setState("picking");
        break;
      case "pick:cancel":
        setState("open");
        break;
      case "markers":
        if (Array.isArray(data.markers)) {
          markers = data.markers
            .slice(0, 50)
            .filter(
              (m): m is { n: number; selector: string; pageUrl: string; resolved: boolean } =>
                !!m &&
                typeof m.n === "number" &&
                typeof m.selector === "string" &&
                m.selector.length <= 300 &&
                typeof m.pageUrl === "string"
            );
          drawMarkers();
        }
        break;
      case "focus":
        if (typeof data.selector === "string" && data.selector.length <= 300 && typeof data.textSnippet === "string") {
          const found = findElement(data.selector, data.textSnippet);
          let method: FindMethod = found.method;
          focusTarget = found.el;
          if (found.el) found.el.scrollIntoView({ block: "center" });
          else if (typeof data.scrollY === "number" && Number.isFinite(data.scrollY)) scrollTo(0, Math.max(0, data.scrollY));
          else method = "none";
          drawFocus();
          focused = `focus:${method}`;
          setState(state === "picking" ? "open" : state);
          send("focus:result", { method });
        }
        break;
      case "end":
        try {
          sessionStorage.removeItem(FLAG);
        } catch {
          // nothing stored
        }
        host.remove();
        break;
    }
  });

  // ─── Picking ───────────────────────────────────────────────────────────────

  const targetAt = (x: number, y: number): Element | null => {
    const found = document.elementFromPoint(x, y);
    return found && found !== host && !host.contains(found) ? found : null;
  };
  const place = (box: HTMLElement, rect: DOMRect | null) => {
    if (!rect) {
      box.style.display = "none";
      return;
    }
    box.style.cssText = `display:block;left:${rect.left - 3}px;top:${rect.top - 3}px;width:${rect.width + 6}px;height:${rect.height + 6}px`;
  };
  document.addEventListener(
    "pointermove",
    (event) => {
      if (state !== "picking" || event.pointerType === "touch") return;
      const target = targetAt(event.clientX, event.clientY);
      place(hover, target ? pickTarget(target).el.getBoundingClientRect() : null);
    },
    true
  );
  const stop = (event: Event) => {
    if (state !== "picking" || event.composedPath().includes(host)) return;
    event.preventDefault();
    event.stopPropagation();
  };
  ["pointerdown", "mousedown", "touchstart", "submit"].forEach((type) => document.addEventListener(type, stop, { capture: true, passive: false }));
  document.addEventListener(
    "click",
    (event) => {
      if (state !== "picking" || event.composedPath().includes(host)) return;
      event.preventDefault();
      event.stopPropagation();
      const now = Date.now();
      while (picks.length && now - picks[0] > 60_000) picks.shift();
      if (picks.length >= 20) return;
      const raw = targetAt(event.clientX, event.clientY);
      if (!raw) return;
      picks.push(now);
      const { el: target, field } = pickTarget(raw);
      const rect = target.getBoundingClientRect();
      send("pick:result", {
        selector: selectorOf(target),
        textSnippet: textOf(target),
        tag: target.tagName.toLowerCase(),
        role: clip(target.getAttribute("role") || "", 40),
        sectionHeading: headingOf(target),
        field,
        rect: { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) },
        offsetX: rect.width ? Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)) : 0.5,
        offsetY: rect.height ? Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)) : 0.5,
        scrollY: Math.max(0, Math.round(scrollY)),
        viewport: { w: innerWidth, h: innerHeight },
        page: page(),
      });
      place(hover, rect);
      setState("open");
    },
    true
  );
  cancel.addEventListener("click", () => {
    send("pick:cancel");
    setState("open");
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state === "picking") {
      send("pick:cancel");
      setState("open");
    }
  });

  // ─── Markers and focus ─────────────────────────────────────────────────────

  function drawMarkers() {
    layer.textContent = "";
    const here = cleanUrl(location.href);
    for (const marker of markers) {
      if (cleanUrl(marker.pageUrl) !== here) continue;
      const found = findElement(marker.selector, "");
      if (!found.el) continue;
      const rect = found.el.getBoundingClientRect();
      const badge = el("span", marker.resolved ? "n done" : "n", String(marker.n));
      badge.style.left = `${Math.max(0, rect.left - 10)}px`;
      badge.style.top = `${Math.max(0, rect.top - 10)}px`;
      layer.append(badge);
    }
  }
  function drawFocus() {
    place(focusBox, focusTarget ? focusTarget.getBoundingClientRect() : null);
  }
  let queued = false;
  const redraw = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      drawMarkers();
      drawFocus();
    });
  };
  addEventListener("scroll", redraw, { passive: true });
  addEventListener("resize", () => {
    redraw();
    if (state === "open") setState("open");
  });

  // ─── Navigation (also single-page apps) ────────────────────────────────────

  const changed = () => {
    if (ready) send("page", { page: page() });
    focusTarget = null;
    redraw();
  };
  (["pushState", "replaceState"] as const).forEach((name) => {
    const original = history[name];
    history[name] = function (this: History, ...args: Parameters<History["pushState"]>) {
      const result = original.apply(this, args);
      changed();
      return result;
    };
  });
  addEventListener("popstate", changed);
  addEventListener("hashchange", changed);
}

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const STYLE = `
:host{all:initial}
.f{position:fixed;z-index:2147483646;border:0;background:transparent;color-scheme:normal}
.closed{right:16px;bottom:16px;width:72px;height:72px;border-radius:36px}
.sheet{left:0;right:0;bottom:0;width:100%;height:85vh;border-radius:16px 16px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,.2);background:#fff}
.panel{top:0;right:0;width:400px;height:100vh;box-shadow:-4px 0 24px rgba(0,0,0,.15);background:#fff}
.picking{width:1px;height:1px;opacity:0;pointer-events:none;right:0;bottom:0}
.bar{display:none;position:fixed;z-index:2147483647;left:8px;right:8px;bottom:8px;gap:12px;align-items:center;justify-content:space-between;padding:12px 16px;border-radius:12px;background:#0f1f3d;color:#fff;font:600 16px/1.3 system-ui,sans-serif}
.bar button{min-height:44px;padding:0 16px;border-radius:8px;border:1px solid #fff;background:transparent;color:#fff;font:inherit;cursor:pointer}
.box{display:none;position:fixed;z-index:2147483645;pointer-events:none;border:3px solid #18b394;border-radius:6px}
.focus{border-color:#ff8a3d;box-shadow:0 0 0 4px rgba(255,138,61,.3)}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483644}
.n{position:fixed;min-width:22px;height:22px;padding:0 4px;box-sizing:border-box;border-radius:11px;background:#0f1f3d;color:#fff;font:700 12px/22px system-ui,sans-serif;text-align:center}
.done{opacity:.5}
`;

// Boot last: everything above is declared before it runs.
(function boot() {
  const match = /(?:^#|&)heili-review=([A-Za-z0-9_-]{20,128})/.exec(location.hash);
  let flagged = false;
  try {
    flagged = sessionStorage.getItem(FLAG) === "1";
  } catch {
    flagged = false;
  }
  if (!match && !flagged) return;
  const script =
    (document.currentScript as HTMLScriptElement | null) ||
    document.querySelector<HTMLScriptElement>('script[data-site][src*="heili-review"]');
  const siteKey = script?.getAttribute("data-site") || "";
  if (!script || !/^hs_[A-Za-z0-9_-]{16,64}$/.test(siteKey)) return;
  let base = "";
  try {
    base = new URL(script.src).origin;
  } catch {
    return;
  }
  const code = match ? match[1] : null;
  if (code) {
    // The one-time code leaves the address at once: no history, no bookmarks.
    history.replaceState(history.state, "", location.pathname + location.search);
  }
  try {
    sessionStorage.setItem(FLAG, "1");
  } catch {
    // private mode: the review lasts for this page only
  }
  const start = () => start2(base, siteKey, code);
  if (document.body) start();
  else document.addEventListener("DOMContentLoaded", start);
})();
