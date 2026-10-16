// A tiny static web site for the «Sul sito» e2e (website-live.spec.mjs):
// serves e2e/fixtures/site/* with the review tag pointing at the app under
// test (__APPROVE_BASE__) and the site key set by the test (__HEILI_SITE_KEY__).
// Port: E2E_SITE_PORT (default 4180).

import { readFileSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const SITE_DIR = path.join(here, "..", "fixtures", "site");

export const SITE_PORT = Number(process.env.E2E_SITE_PORT ?? 4180);

/** Starts the site on `port`; returns { origin, setKey(key), stop() }. */
export function startStaticSite({ port = SITE_PORT, approveBase }) {
  let siteKey = "";
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const name = url.pathname === "/" ? "index.html" : url.pathname.replace(/^\/+/, "");
    if (!/^[a-z0-9-]+\.html$/.test(name)) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("non trovato");
      return;
    }
    let html;
    try {
      html = readFileSync(path.join(SITE_DIR, name), "utf8");
    } catch {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("non trovato");
      return;
    }
    html = html.replaceAll("__APPROVE_BASE__", approveBase).replaceAll("__HEILI_SITE_KEY__", siteKey);
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
    res.end(html);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () =>
      resolve({
        origin: `http://localhost:${port}`,
        setKey(key) {
          siteKey = key;
        },
        stop: () => new Promise((done) => server.close(() => done())),
      })
    );
  });
}
