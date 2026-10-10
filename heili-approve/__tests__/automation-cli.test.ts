import { spawn } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mockPrisma = vi.hoisted(() => ({
  automationToken: { findUnique: vi.fn() },
  workspaceMember: { findUnique: vi.fn() },
  client: { findMany: vi.fn(), findFirst: vi.fn() },
  mediaAsset: { findMany: vi.fn() },
  post: { findUnique: vi.fn(), count: vi.fn(), create: vi.fn() },
  postEvent: { create: vi.fn() },
  $executeRaw: vi.fn(),
  $transaction: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ prisma: mockPrisma }));

import { GET as listClients } from "@/app/api/automation/v1/clients/route";
import { POST as createPostRoute } from "@/app/api/automation/v1/posts/route";
import { POST as validatePostRoute } from "@/app/api/automation/v1/posts/validate/route";
import { hashAutomationToken } from "@/lib/automation/auth";

type StoredPost = { id: string; status: "DRAFT"; importHash: string; networks: string[] };
type CliResult = { code: number | null; stdout: string; stderr: string };

const token = `approve_auto_${"c".repeat(64)}`;
const posts = new Map<string, StoredPost>();
const projectRoot = path.resolve(__dirname, "..");
const cliPath = path.join(projectRoot, "scripts", "approve_import.py");
let baseUrl = "";
let server: ReturnType<typeof createServer>;

function incomingHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

async function bodyBytes(request: IncomingMessage): Promise<ArrayBuffer | undefined> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  if (chunks.length === 0) return undefined;
  const body = Buffer.concat(chunks);
  return body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
}

async function bridge(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const url = new URL(request.url ?? "/", baseUrl);
    const fetchRequest = new Request(url, {
      method: request.method,
      headers: incomingHeaders(request),
      body: request.method === "GET" || request.method === "HEAD" ? undefined : await bodyBytes(request),
    });
    let result: Response;
    if (request.method === "GET" && url.pathname === "/api/automation/v1/clients") {
      result = await listClients(fetchRequest);
    } else if (request.method === "POST" && url.pathname === "/api/automation/v1/posts/validate") {
      result = await validatePostRoute(fetchRequest);
    } else if (request.method === "POST" && url.pathname === "/api/automation/v1/posts") {
      result = await createPostRoute(fetchRequest);
    } else {
      result = new Response("Not found", { status: 404 });
    }
    response.statusCode = result.status;
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(Buffer.from(await result.arrayBuffer()));
  } catch (error) {
    response.statusCode = 500;
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ success: false, error: String(error) }));
  }
}

function runCli(cwd: string, args: string[]): Promise<CliResult> {
  const executable = process.platform === "win32" ? "python" : "python3";
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [cliPath, ...args], {
      cwd,
      env: { ...process.env, APPROVE_BASE_URL: baseUrl, APPROVE_API_TOKEN: token },
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

function parseOutput(result: CliResult): Record<string, unknown> {
  expect(result.stderr).toBe("");
  return JSON.parse(result.stdout) as Record<string, unknown>;
}

beforeAll(async () => {
  server = createServer((request, response) => void bridge(request, response));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  vi.clearAllMocks();
  posts.clear();
  vi.stubEnv("PUBLIC_BASE_URL", baseUrl);
  vi.stubEnv("APP_VARIANT", "social");
  mockPrisma.automationToken.findUnique.mockResolvedValue({
    id: "token-1",
    workspaceId: "workspace-1",
    userId: "user-1",
    tokenHash: hashAutomationToken(token),
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
  });
  mockPrisma.workspaceMember.findUnique.mockResolvedValue({ id: "member-1" });
  mockPrisma.client.findMany.mockResolvedValue([
    {
      id: "client-1",
      name: "Aurora",
      timezone: "Europe/Rome",
      services: ["SOCIAL_POST"],
      networks: ["instagram"],
    },
  ]);
  mockPrisma.client.findFirst.mockResolvedValue({
    id: "client-1",
    workspaceId: "workspace-1",
    name: "Aurora",
    archivedAt: null,
    services: ["SOCIAL_POST"],
    networks: ["instagram"],
  });
  mockPrisma.mediaAsset.findMany.mockResolvedValue([]);
  mockPrisma.post.count.mockResolvedValue(0);
  mockPrisma.$executeRaw.mockResolvedValue(1);
  mockPrisma.post.findUnique.mockImplementation(async ({ where }: { where: { workspaceId_importKey: { importKey: string } } }) =>
    posts.get(where.workspaceId_importKey.importKey) ?? null
  );
  mockPrisma.post.create.mockImplementation(async ({ data }: { data: { importKey: string; importHash: string; networks: string[] } }) => {
    const stored: StoredPost = {
      id: `post-${posts.size + 1}`,
      status: "DRAFT",
      importHash: data.importHash,
      networks: data.networks,
    };
    posts.set(data.importKey, stored);
    return stored;
  });
  mockPrisma.postEvent.create.mockResolvedValue({ id: "event-1" });
  mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
});

describe("portable Python importer against the real automation routes", () => {
  it("dry-runs, creates once, replays, and reports a changed-payload conflict", async () => {
    const temp = await mkdtemp(path.join(tmpdir(), "approve-cli-contract-"));
    const csv = path.join(temp, "posts.csv");
    const writeCsv = (text: string) =>
      writeFile(
        csv,
        [
          "source_id,client_id,title,publish_at,networks,text",
          `excel-001,client-1,Post da Excel,2026-10-15T10:30:00+02:00,INSTAGRAM,${text}`,
        ].join("\n"),
        "utf8"
      );
    await writeCsv("Testo originale");

    const clientsResult = await runCli(temp, ["clients", "--limit", "10"]);
    expect(clientsResult.code).toBe(0);
    expect(parseOutput(clientsResult)).toMatchObject({
      success: true,
      data: { workspaceId: "workspace-1", clients: [{ id: "client-1" }] },
    });

    const dryRun = await runCli(temp, ["import", csv, "--dry-run"]);
    expect(dryRun.code).toBe(0);
    expect(parseOutput(dryRun)).toMatchObject({
      success: true,
      data: { mode: "dry-run", ok: true, summary: { total: 1, valid: 1, errors: 0, writes: 0 } },
    });
    expect(posts.size).toBe(0);

    const created = await runCli(temp, ["import", csv, "--commit"]);
    expect(created.code).toBe(0);
    expect(parseOutput(created)).toMatchObject({
      success: true,
      data: {
        mode: "commit",
        ok: true,
        rows: [{ externalId: "excel-001", status: "DRAFT", replayed: false }],
      },
    });
    expect(posts.size).toBe(1);
    expect(posts.get("excel-001")?.networks).toEqual(["instagram"]);

    const replayed = await runCli(temp, ["import", csv, "--commit"]);
    expect(replayed.code).toBe(0);
    expect(parseOutput(replayed)).toMatchObject({
      success: true,
      data: { rows: [{ externalId: "excel-001", status: "DRAFT", replayed: true }] },
    });
    expect(posts.size).toBe(1);

    await writeCsv("Testo cambiato");
    const conflict = await runCli(temp, ["import", csv, "--commit"]);
    expect(conflict.code).toBe(2);
    const conflictOutput = parseOutput(conflict);
    expect(conflictOutput).toMatchObject({
      success: false,
      data: { ok: false, rows: [{ externalId: "excel-001", ok: false }] },
    });
    expect(JSON.stringify(conflictOutput)).toContain("externalId");
    expect(posts.size).toBe(1);
  }, 30_000);
});
