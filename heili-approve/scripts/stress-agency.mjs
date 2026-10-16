/**
 * Stress test for the AGENCY side of Approve by Heili (docs/notte/DEEPSEEK-2026-10-16-AGENZIA.md, Parte 2).
 *
 * Self-contained: uses `pg` for bulk data + query analysis, `fetch` for HTTP
 * (pages, automation API, MCP) and `bullmq` for the scheduling queue. Run it
 * against a running app (PORT 3501) and worker with METRICOOL_FAKE=1.
 *
 *   node scripts/stress-agency.mjs [--only seed|pages|api|queue|queries]
 *
 * It reads DATABASE_URL, REDIS_URL, BASE_URL and the session cookie from the
 * environment (or `.env`), and the automation key from APPROVE_API_TOKEN.
 * Nothing here approves, sends or publishes: drafts are created through the
 * automation/MCP channel, scheduling jobs run only against the fake Metricool.
 */

import { randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import { readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
if (typeof loadEnvFile === "function") {
  try { loadEnvFile(path.join(ROOT, ".env")); } catch { /* no .env */ }
}
for (const [key, value] of Object.entries({ ...process.env })) {
  if (value === undefined) delete process.env[key];
}

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3501";
const SESSION_TOKEN = process.env.STRESS_SESSION_TOKEN ?? "dev-session-stefano-insiderslab-0000000001";
const COOKIE = `authjs.session-token=${SESSION_TOKEN}`;

const { default: pg } = await import("pg");
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();

async function workspaceId() {
  const { rows } = await db.query('select id from "Workspace" order by "createdAt" asc limit 1');
  return rows[0].id;
}

function uid() {
  return randomUUID().replace(/-/g, "");
}

// ─────────────────────────────────────────────────────────────────────────────
// Timing helpers
function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx];
}
function summarize(name, durations, errors) {
  const sorted = [...durations].sort((a, b) => a - b);
  console.log(
    `  ${name.padEnd(34)} n=${durations.length} p50=${(percentile(sorted, 50) ?? 0).toFixed(0)}ms ` +
      `p95=${(percentile(sorted, 95) ?? 0).toFixed(0)}ms max=${(sorted[sorted.length - 1] ?? 0).toFixed(0)}ms errors=${errors}`
  );
}

async function timeOnce(fn) {
  const t = performance.now();
  let err = 0;
  try { await fn(); } catch { err = 1; }
  return { ms: performance.now() - t, err };
}

async function timeConcurrent(fn, concurrency, n) {
  const t0 = performance.now();
  let errors = 0;
  let i = 0;
  async function worker() {
    while (i < n) {
      i += 1;
      const r = await timeOnce(fn);
      if (r.err) errors += 1;
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker));
  return { totalMs: performance.now() - t0, errors, rps: (n / ((performance.now() - t0) / 1000)).toFixed(1) };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Bulk seed data
async function seedBulk() {
  const ws = await workspaceId();
  const stamp = Date.now().toString(36);

  // 50 clients; client #1 ("Stress Picco") gets 500 posts in one month + 20 versions/post on a subset.
  const clientIds = [];
  const clientValues = [];
  for (let i = 1; i <= 50; i++) {
    const id = uid();
    clientIds.push(id);
    clientValues.push(
      `('${id}','${ws}','Stress ${i} ${stamp}','Europe/Rome','{instagram,facebook}',true,'{SOCIAL_POST}',now())`
    );
  }
  await db.query(
    `insert into "Client" (id, "workspaceId", name, timezone, networks, "autoSchedule", services, "updatedAt") values ${clientValues.join(",")}`
  );

  const peakClient = clientIds[0];
  const now = Date.now();
  // 500 posts for the peak client, spread over one month (publishAt).
  const postIds = [];
  const postRows = [];
  for (let i = 0; i < 500; i++) {
    const id = uid();
    postIds.push(id);
    const publishAt = new Date(now + (i % 30) * 86_400_000 + i * 60_000).toISOString();
    postRows.push(
      `('${id}','${ws}','${peakClient}','Post picco ${i}','SOCIAL_POST','IN_REVIEW','${publishAt}','{instagram,facebook}',now())`
    );
  }
  // 3000 posts spread over the remaining clients.
  for (let i = 0; i < 3000; i++) {
    const id = uid();
    postIds.push(id);
    const clientId = clientIds[1 + (i % 49)];
    const publishAt = new Date(now + (i % 60) * 86_400_000 + (i % 24) * 3_600_000).toISOString();
    postRows.push(
      `('${id}','${ws}','${clientId}','Post stress ${i}','SOCIAL_POST','IN_REVIEW','${publishAt}','{instagram}',now())`
    );
  }
  const BATCH = 1000;
  for (let i = 0; i < postRows.length; i += BATCH) {
    await db.query(
      `insert into "Post" (id, "workspaceId", "clientId", title, kind, status, "publishAt", networks, "updatedAt") values ${postRows
        .slice(i, i + BATCH)
        .join(",")}`
    );
  }
  // Versions for every post (version 1) and 20 versions for the first 50 peak posts.
  const versionRows = [];
  postIds.forEach((postId, idx) => {
    versionRows.push(`('${uid()}','${postId}',1,'Testo della versione 1 #stress','[]','{}')`);
    if (idx < 50) {
      for (let v = 2; v <= 20; v++) {
        versionRows.push(`('${uid()}','${postId}',${v},'Testo della versione ${v}','[]','{}')`);
      }
    }
  });
  for (let i = 0; i < versionRows.length; i += BATCH) {
    await db.query(
      `insert into "PostVersion" (id, "postId", number, text, media, content) values ${versionRows.slice(i, i + BATCH).join(",")}`
    );
  }
  // 1000 comments across posts.
  const commentRows = [];
  for (let i = 0; i < 1000; i++) {
    commentRows.push(`('${uid()}','${postIds[i % postIds.length]}','CLIENT','Commento di stress ${i}')`);
  }
  for (let i = 0; i < commentRows.length; i += BATCH) {
    await db.query(
      `insert into "PostComment" (id, "postId", "authorType", body) values ${commentRows.slice(i, i + BATCH).join(",")}`
    );
  }
  console.log(`[seed] 50 clients, ${postRows.length} posts, ${versionRows.length} versions, 1000 comments. peakClient=${peakClient}`);
  return { ws, peakClient, clientIds };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Page measurements
async function measurePages() {
  const peak = (await db.query(`select id from "Client" where name like 'Stress 1 %' order by "createdAt" desc limit 1`)).rows[0]?.id;
  const peakPosts = (await db.query(`select id from "Post" where "clientId"=$1 order by "createdAt" desc limit 1`, [peak])).rows[0]?.id;

  const targets = [
    ["dashboard", "/dashboard"],
    ["posts (tutti)", "/posts"],
    ["posts (filtro stato)", "/posts?status=IN_REVIEW"],
    ["posts (ricerca)", "/posts?q=stress"],
    ["posts (filtro cliente)", `/posts?clientId=${peak}`],
    ["calendar", "/calendar"],
    ["plans", "/plans"],
    ["editor (nuovo post)", "/posts/new?kind=social"],
    ["editor (post esistente)", `/posts/${peakPosts}`],
    ["clients", "/clients"],
  ];

  for (const [name, pathname] of targets) {
    const dur = [];
    let err = 0;
    for (let i = 0; i < 3; i++) {
      const r = await timeOnce(() =>
        fetch(`${BASE_URL}${pathname}`, { headers: { cookie: COOKIE }, redirect: "manual" })
      );
      dur.push(r.ms);
      err += r.err;
    }
    summarize(name, dur, err);
  }

  console.log("\n[pages] concurrency (dashboard)");
  for (const c of [1, 10, 50]) {
    const r = await timeConcurrent(
      () => fetch(`${BASE_URL}/dashboard`, { headers: { cookie: COOKIE } }),
      c,
      c === 1 ? 1 : c * 2
    );
    console.log(`  concurrency=${String(c).padEnd(3)} total=${r.totalMs}ms rps=${r.rps} errors=${r.errors}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Automation API + MCP edge cases
async function apiTests() {
  const key = process.env.APPROVE_API_TOKEN ?? readFileSync("/tmp/opencode/automation-key.txt", "utf8").trim();
  const auth = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  const clients = await (await fetch(`${BASE_URL}/api/automation/v1/clients?limit=100`, { headers: auth })).json();
  const clientId = clients?.data?.clients?.[0]?.id;
  if (!clientId) { console.log("[api] no client available via API"); return; }

  console.log("[api] clients reachable:", clients?.data?.clients?.length);

  // 100 parallel drafts with the same key (same externalId space, unique ids).
  const t0 = performance.now();
  const createOne = (i) =>
    fetch(`${BASE_URL}/api/automation/v1/posts`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        externalId: `stress-${i}-${Date.now()}`,
        post: { clientId, title: `Draft stress ${i}`, publishAt: "2026-12-01T10:00:00+01:00", networks: ["instagram"], text: "Testo", media: [] },
      }),
    });
  const results = await Promise.all(Array.from({ length: 100 }, (_, i) => createOne(i)));
  const statuses = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] ?? 0) + 1;
  console.log(`[api] 100 parallel drafts: ${JSON.stringify(statuses)} in ${(performance.now() - t0).toFixed(0)}ms`);

  // Idempotency replay: same externalId again returns the same post.
  const replay = await fetch(`${BASE_URL}/api/automation/v1/posts`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ externalId: "stress-replay-1", post: { clientId, title: "Replay", publishAt: "2026-12-02T10:00:00+01:00", networks: ["instagram"], text: "T", media: [] } }),
  });
  const replay2 = await fetch(`${BASE_URL}/api/automation/v1/posts`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ externalId: "stress-replay-1", post: { clientId, title: "Replay", publishAt: "2026-12-02T10:00:00+01:00", networks: ["instagram"], text: "T", media: [] } }),
  });
  console.log(`[api] replay same id: ${replay.status} then ${replay2.status} (expect 201 then 200)`);

  // Wrong key
  const wrong = await fetch(`${BASE_URL}/api/automation/v1/clients`, { headers: { Authorization: "Bearer approve_auto_wrong" } });
  console.log(`[api] wrong key: ${wrong.status} (expect 401)`);

  // Malformed JSON
  const malformed = await fetch(`${BASE_URL}/api/automation/v1/posts`, { method: "POST", headers: auth, body: "{\"externalId\": " });
  console.log(`[api] malformed JSON: ${malformed.status} (expect 400)`);

  // HTML/script in fields
  const html = await fetch(`${BASE_URL}/api/automation/v1/posts`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ externalId: `stress-html-${Date.now()}`, post: { clientId, title: "<script>alert(1)</script>", publishAt: "2026-12-03T10:00:00+01:00", networks: ["instagram"], text: "<img src=x onerror=alert(1)>", media: [] } }),
  });
  console.log(`[api] HTML/script fields: ${html.status} (expect 201, stored as text)`);

  // Absurd date (year 0001): draft creation accepts it (past dates are checked at submit, not draft).
  const absurd = await fetch(`${BASE_URL}/api/automation/v1/posts`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ externalId: `stress-date-${Date.now()}`, post: { clientId, title: "Data", publishAt: "0001-01-01T00:00:00+00:00", networks: ["instagram"], text: "T", media: [] } }),
  });
  console.log(`[api] absurd date: ${absurd.status} (draft created; past dates are not a draft-time error)`);

  // 5 MB body
  const big = await fetch(`${BASE_URL}/api/automation/v1/posts`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ externalId: `stress-big-${Date.now()}`, post: { clientId, title: "Big", publishAt: "2026-12-04T10:00:00+01:00", networks: ["instagram"], text: "x".repeat(5 * 1024 * 1024), media: [] } }),
  });
  console.log(`[api] 5MB body: ${big.status} (expect 413/400)`);

  // MCP tools/list + create_draft_posts
  const mcp = await fetch(`${BASE_URL}/mcp`, { method: "POST", headers: auth, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  console.log(`[api] MCP tools/list: ${mcp.status}`);
  const mcpDraft = await fetch(`${BASE_URL}/mcp`, {
    method: "POST", headers: auth,
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "create_draft_posts", arguments: { posts: [{ source_id: `mcp-stress-${Date.now()}`, client_id: clientId, title: "MCP draft", publish_at: "2026-12-05T10:00:00+01:00", networks: ["facebook"], text: "Testo MCP" }] } } }),
  });
  const mcpDraftBody = await mcpDraft.json().catch(() => ({}));
  console.log(`[api] MCP create_draft_posts: ${mcpDraft.status} error=${JSON.stringify(mcpDraftBody.error ?? null)}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. BullMQ: 200 scheduling jobs in ~10s against the fake Metricool
async function queueTest() {
  const { Queue } = await import("bullmq");
  const { default: Redis } = await import("ioredis");
  const redis = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  const ws = await workspaceId();

  // A dedicated client with a Metricool brand + 200 APPROVED posts with a version.
  const clientId = uid();
  await db.query(
    `insert into "Client" (id, "workspaceId", name, timezone, networks, "autoSchedule", services, "metricoolBlogId", "updatedAt") values ($1,$2,$3,'Europe/Rome','{facebook}',true,'{SOCIAL_POST}','fake-1001', now())`,
    [clientId, ws, "Stress Queue"]
  );
  const postIds = [];
  const rows = [];
  for (let i = 0; i < 200; i++) {
    const id = uid();
    postIds.push(id);
    rows.push([id, ws, clientId, `Queue post ${i}`, new Date(Date.now() + 86_400_000 + i * 60_000).toISOString()]);
  }
  for (const r of rows) {
    await db.query(
      `insert into "Post" (id, "workspaceId", "clientId", title, kind, status, "publishAt", networks, "currentVersionNumber", "approvedAt", "updatedAt") values ($1,$2,$3,$4,'SOCIAL_POST','APPROVED',$5,'{facebook}',1, now(), now())`,
      r
    );
  }
  for (const id of postIds) {
    await db.query(`insert into "PostVersion" (id, "postId", number, text, media, content) values ($1,$2,1,'Testo queue','[]','{}')`, [uid(), id]);
  }

  const queue = new Queue("post-scheduling", { connection: redis });
  const SCHEDULE_POST_JOB_NAME = "schedule-post";
  const schedulePostJobId = (postId, version, attempt = 0) => `schedule_${postId}_v${version}_${attempt}`;

  const t0 = performance.now();
  // Move APPROVED -> SCHEDULING (what requestScheduling does) and enqueue.
  await db.query(`update "Post" set status='SCHEDULING', "metricoolPostId"=null where "clientId"=$1`, [clientId]);
  for (const id of postIds) {
    await queue.add(SCHEDULE_POST_JOB_NAME, { postId: id, versionNumber: 1 }, { jobId: schedulePostJobId(id, 1) });
  }
  const enqueueMs = performance.now() - t0;
  console.log(`[queue] 200 jobs enqueued in ${enqueueMs.toFixed(0)}ms`);

  // Wait until all 200 are SCHEDULED (fake Metricool is instant) or timeout.
  const started = Date.now();
  let scheduled = 0;
  for (;;) {
    const { rows: r } = await db.query(`select count(*)::int as c from "Post" where "clientId"=$1 and status='SCHEDULED'`, [clientId]);
    scheduled = r[0].c;
    const failed = (await db.query(`select count(*)::int as c from "Post" where "clientId"=$1 and status='FAILED'`, [clientId])).rows[0].c;
    if (scheduled + failed >= 200 || Date.now() - started > 30_000) break;
    await new Promise((res) => setTimeout(res, 200));
  }
  const totalMs = Date.now() - started;
  const dupe = await db.query(`select "metricoolPostId", count(*)::int as c from "Post" where "clientId"=$1 group by "metricoolPostId" having count(*) > 1`, [clientId]);
  const failed = (await db.query(`select count(*)::int as c from "Post" where "clientId"=$1 and status='FAILED'`, [clientId])).rows[0].c;
  console.log(`[queue] settled: SCHEDULED=${scheduled} FAILED=${failed} in ${totalMs}ms; duplicate metricoolPostId groups=${dupe.rows.length}`);

  // Cron sweep should find nothing stuck / nothing to double-schedule.
  const sweep = await fetch(`${BASE_URL}/api/cron/sweep`, { headers: { Authorization: `Bearer ${process.env.CRON_SECRET ?? process.env.NEXTAUTH_SECRET}` } });
  console.log(`[queue] cron sweep status=${sweep.status}`);

  await queue.close();
  redis.disconnect();
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Query analysis (pg_stat_statements + EXPLAIN on hot queries)
async function queries() {
  const { rows: ss } = await db.query(`
    select query, calls, round(total_exec_time::numeric,1) as total_ms, round(mean_exec_time::numeric,2) as mean_ms
    from pg_stat_statements where query ilike '%"Post"%' order by total_exec_time desc limit 12
  `).catch(() => ({ rows: [] }));
  console.log("[queries] top Post queries (pg_stat_statements):");
  for (const r of ss) console.log(`  calls=${r.calls} mean=${r.mean_ms}ms  ${r.query.slice(0, 120).replace(/\n/g, " ")}`);
  if (ss.length === 0) console.log("  (pg_stat_statements non disponibile)");

  // Index check: does the posts list query (workspaceId + status) use an index?
  const ws = await workspaceId();
  const plan = await db.query(`explain (costs off) select id from "Post" where "workspaceId"=$1 and status='IN_REVIEW' order by "publishAt" desc limit 50`, [ws]);
  console.log("[queries] EXPLAIN posts-list (workspaceId+status order by publishAt):");
  for (const r of plan.rows) console.log("  " + r["QUERY PLAN"]);
}

// ─────────────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const only = args.includes("--only") ? (args[args.indexOf("--only") + 1] ?? "all") : "all";
const run = (name) => only === "all" || only === name;

try {
  if (run("seed")) await seedBulk();
  if (run("pages")) await measurePages();
  if (run("api")) await apiTests();
  if (run("queue")) await queueTest();
  if (run("queries")) await queries();
} finally {
  await db.end();
}
