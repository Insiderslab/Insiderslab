/**
 * A tiny in-memory stand-in for the Prisma client, just rich enough for the MCP
 * tools: it really evaluates `where` filters (equality, in, not, gt/gte/lt/lte,
 * AND/OR, relation `some`), orderBy, take and per-relation where/orderBy/take, so
 * the workspace-isolation tests check what a query returns, not only how it was written.
 * Relations are stored on the rows themselves (post.client, post.versions…).
 */

import { vi } from "vitest";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const OPERATORS = ["in", "not", "gt", "gte", "lt", "lte", "equals", "mode", "some", "contains"];

function norm(value: unknown): unknown {
  return value instanceof Date ? value.getTime() : (value ?? null);
}

function isPlain(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

export function matches(row: Row | undefined | null, where: Row | undefined): boolean {
  if (!where) return true;
  if (!row) return false;
  for (const [key, cond] of Object.entries(where)) {
    if (key === "AND") {
      if (!(cond as Row[]).every((part) => matches(row, part))) return false;
    } else if (key === "OR") {
      if (!(cond as Row[]).some((part) => matches(row, part))) return false;
    } else if (key === "NOT") {
      if (matches(row, cond as Row)) return false;
    } else if (isPlain(cond) && Object.keys(cond).some((k) => OPERATORS.includes(k))) {
      const value = row[key];
      const insensitive = cond.mode === "insensitive";
      const fix = (v: unknown) => (insensitive && typeof v === "string" ? v.toLowerCase() : norm(v));
      if ("in" in cond && !(cond.in as unknown[]).map(norm).includes(norm(value))) return false;
      if ("equals" in cond && fix(value) !== fix(cond.equals)) return false;
      if ("not" in cond && norm(value) === norm(cond.not)) return false;
      if ("gt" in cond && !((norm(value) as number) > (norm(cond.gt) as number))) return false;
      if ("gte" in cond && !((norm(value) as number) >= (norm(cond.gte) as number))) return false;
      if ("lt" in cond && !((norm(value) as number) < (norm(cond.lt) as number))) return false;
      if ("lte" in cond && !((norm(value) as number) <= (norm(cond.lte) as number))) return false;
      if ("some" in cond && !((value ?? []) as Row[]).some((item) => matches(item, cond.some as Row))) return false;
    } else if (isPlain(cond)) {
      if (!matches(row[key] as Row, cond)) return false;
    } else if (norm(row[key]) !== norm(cond)) {
      return false;
    }
  }
  return true;
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const specs = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Array<Record<string, unknown>>;
  if (specs.length === 0) return rows;
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [field, dirRaw] = Object.entries(spec)[0];
      const dir = (isPlain(dirRaw) ? (dirRaw.sort as string) : (dirRaw as string)) === "desc" ? -1 : 1;
      const nullsFirst = isPlain(dirRaw) ? dirRaw.nulls === "first" : dir === -1;
      const av = norm(a[field]) as number | string | null;
      const bv = norm(b[field]) as number | string | null;
      if (av === bv) continue;
      if (av === null) return nullsFirst ? -1 : 1;
      if (bv === null) return nullsFirst ? 1 : -1;
      return av < bv ? -dir : dir;
    }
    return 0;
  });
}

/** Applies per-relation where / orderBy / take of an include or select (one level + nested). */
function shape(row: Row, args: Row | undefined): Row {
  const rel = { ...(args?.include as Row | undefined), ...(args?.select as Row | undefined) };
  const out: Row = { ...row };
  for (const [key, spec] of Object.entries(rel)) {
    if (!isPlain(spec) || !Array.isArray(row[key])) continue;
    let list = (row[key] as Row[]).filter((item) => matches(item, spec.where as Row | undefined));
    list = sortRows(list, spec.orderBy);
    if (typeof spec.take === "number") list = list.slice(0, spec.take);
    out[key] = list.map((item) => shape(item, spec));
  }
  return out;
}

let counter = 0;

export class Table {
  rows: Row[] = [];
  created: Row[] = [];

  constructor(private readonly uniques: string[][] = []) {}

  reset(rows: Row[] = []) {
    this.rows = rows.map((row) => ({ ...row }));
    this.created = [];
  }

  private resolveWhere(where: Row): Row {
    // Composite unique selectors: { workspaceId_userId: { workspaceId, userId } } → flat where.
    const flat: Row = {};
    for (const [key, value] of Object.entries(where ?? {})) {
      if (isPlain(value) && key.includes("_") && !OPERATORS.some((op) => op in value)) Object.assign(flat, value);
      else flat[key] = value;
    }
    return flat;
  }

  findFirst = vi.fn(async (args: Row = {}) => {
    const list = sortRows(this.rows.filter((row) => matches(row, args.where)), args.orderBy);
    return list[0] ? shape(list[0], args) : null;
  });

  findMany = vi.fn(async (args: Row = {}) => {
    let list = sortRows(this.rows.filter((row) => matches(row, args.where)), args.orderBy);
    if (typeof args.take === "number") list = list.slice(0, args.take);
    return list.map((row) => shape(row, args));
  });

  findUnique = vi.fn(async (args: Row) => {
    const where = this.resolveWhere(args.where);
    const row = this.rows.find((candidate) => matches(candidate, where));
    return row ? shape(row, args) : null;
  });

  count = vi.fn(async (args: Row = {}) => this.rows.filter((row) => matches(row, args.where)).length);

  create = vi.fn(async (args: Row) => {
    const data = args.data as Row;
    const nested = Object.fromEntries(Object.entries(data).filter(([, value]) => isPlain(value) && "create" in value));
    const plain = Object.fromEntries(Object.entries(data).filter(([key]) => !(key in nested)));
    const row: Row = { id: plain.id ?? `new-${++counter}`, status: "DRAFT", createdAt: new Date(), ...plain };
    this.rows.push(row);
    this.created.push({ ...data, id: row.id });
    return row;
  });

  aggregate = vi.fn(async (args: Row = {}) => {
    const rows = this.rows.filter((row) => matches(row, args.where));
    return { _sum: { sizeBytes: rows.reduce((total, row) => total + Number(row.sizeBytes ?? 0), 0) } };
  });

  deleteMany = vi.fn(async (args: Row = {}) => {
    const before = this.rows.length;
    this.rows = this.rows.filter((row) => !matches(row, args.where));
    return { count: before - this.rows.length };
  });

  updateMany = vi.fn(async (args: Row) => {
    let count = 0;
    for (const row of this.rows) if (matches(row, args.where)) { Object.assign(row, args.data); count += 1; }
    return { count };
  });
}

export function createFakeDb() {
  const db = {
    user: new Table(),
    workspaceMember: new Table(),
    automationToken: new Table(),
    client: new Table(),
    post: new Table(),
    postEvent: new Table(),
    mediaAsset: new Table(),
    contentPlan: new Table(),
    automationUploadReservation: new Table(),
    $executeRaw: vi.fn(async () => 1),
    $transaction: vi.fn(),
  };
  db.$transaction.mockImplementation(async (fn: (tx: typeof db) => unknown) => fn(db));
  return db;
}

export type FakeDb = ReturnType<typeof createFakeDb>;
