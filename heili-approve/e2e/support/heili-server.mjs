// A second server of the same build with Heili (the AI assistant) switched on
// and answered by a tiny mock provider: the main e2e server has no AI key.
// Used by the specs that open the Heili dock (heili-dock-layout). Same recipe as
// assistant-after-changes.spec.mjs: OPENAI_BASE_URL points at a local HTTP
// server that answers the Responses API with fixed structured outputs.
//
// Port: E2E_HELI_PORT (default 3102). The specs run one after the other, so the
// port is free again when this one starts.

import { spawn } from "node:child_process";
import { appendFileSync } from "node:fs";
import http from "node:http";
import { root } from "../helpers.mjs";

export const HELI_PORT = Number(process.env.E2E_HELI_PORT ?? 3102);
export const HELI_BASE = `http://localhost:${HELI_PORT}`;

function startMockProvider() {
  return new Promise((resolve) => {
    const ai = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        let request = {};
        try {
          request = JSON.parse(body);
        } catch {
          // not JSON: answered below as an empty request
        }
        const payload =
          request.text?.format?.name === "review_summary"
            ? {
                verdict: "changes",
                summary: "Vorrei il titolo più grande e un tono meno formale.",
                actionItems: [
                  {
                    area: "testo",
                    mediaIndex: null,
                    timeSec: null,
                    timeEndSec: null,
                    pinX: null,
                    pinY: null,
                    request: "Rendere il tono più colloquiale",
                    priority: "alta",
                    variantId: null,
                    anchorQuote: null,
                  },
                ],
              }
            : { reply: "Capito. Quale frase ti suona peggio?", readiness: "exploring" };
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            id: "resp_e2e",
            object: "response",
            created_at: Math.floor(Date.now() / 1000),
            status: "completed",
            model: "gpt-e2e-mock",
            error: null,
            incomplete_details: null,
            instructions: null,
            metadata: {},
            parallel_tool_calls: false,
            temperature: 1,
            tool_choice: "auto",
            tools: [],
            top_p: 1,
            output: [
              {
                id: "msg_e2e",
                type: "message",
                status: "completed",
                role: "assistant",
                content: [{ type: "output_text", text: JSON.stringify(payload), annotations: [] }],
              },
            ],
          })
        );
      });
    });
    ai.listen(0, "127.0.0.1", () => resolve({ ai, port: ai.address().port }));
  });
}

/**
 * Starts the mock provider and the AI-enabled server; returns `{ stop }`.
 * `providerPort`: use a provider the spec runs itself (heili-voice: chat + GPT-Live);
 * `env`: extra variables for the server (they win over the defaults).
 */
export async function startHeiliServer({ providerPort, env = {} } = {}) {
  const { ai, port } = providerPort ? { ai: null, port: providerPort } : await startMockProvider();
  let log = "";
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(HELI_PORT)], {
    cwd: root,
    env: {
      ...process.env,
      APP_VARIANT: "all",
      METRICOOL_FAKE: "1",
      PORT: String(HELI_PORT),
      REVIEW_ASSISTANT_PROVIDER: "openai",
      OPENAI_API_KEY: "sk-e2e-mock-not-a-real-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      REVIEW_ASSISTANT_ATTEMPT_COOLDOWN_MS: "1",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true,
  });
  // E2E_HELI_LOG=<file>: keep the server's output for debugging a spec.
  const keep = (chunk) => {
    log += chunk;
    if (process.env.E2E_HELI_LOG) appendFileSync(process.env.E2E_HELI_LOG, chunk);
  };
  server.stdout.on("data", keep);
  server.stderr.on("data", keep);

  const started = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${HELI_BASE}/api/health`);
      if (res.ok) break;
    } catch {
      // not up yet
    }
    if (server.exitCode !== null) throw new Error(`Il server di prova si è fermato:\n${log}`);
    if (Date.now() - started > 60_000) throw new Error(`Il server di prova non risponde su ${HELI_BASE}:\n${log}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  async function stop() {
    ai?.close();
    if (server.exitCode !== null) return;
    try {
      process.kill(-server.pid, "SIGTERM"); // the whole group: next start may fork
    } catch {
      server.kill("SIGTERM");
    }
    await new Promise((resolve) => {
      const timer = setTimeout(() => {
        try {
          process.kill(-server.pid, "SIGKILL");
        } catch {
          // already gone
        }
        resolve();
      }, 5_000);
      server.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
    });
  }
  return { stop };
}
