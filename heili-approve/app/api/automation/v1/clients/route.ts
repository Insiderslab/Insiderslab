import { prisma } from "@/lib/db/client";
import { authenticateAutomation, AutomationError } from "@/lib/automation/auth";
import { automationFailure, automationJson } from "@/lib/automation/http";

export async function GET(request: Request) {
  try {
    const context = await authenticateAutomation(request);
    const query = new URL(request.url).searchParams;
    const q = query.get("q")?.trim() ?? "";
    const limit = Number(query.get("limit") ?? 50);
    const cursor = query.get("cursor");
    if (q.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 100 || (cursor?.length ?? 0) > 64) {
      throw new AutomationError("INVALID_QUERY", "Ricerca non valida; limit deve essere compreso tra 1 e 100");
    }
    const rows = await prisma.client.findMany({
      where: { workspaceId: context.workspaceId, archivedAt: null, ...(q ? { name: { contains: q, mode: "insensitive" } } : {}), ...(cursor ? { id: { gt: cursor } } : {}) },
      orderBy: { id: "asc" }, take: limit + 1,
      select: { id: true, name: true, timezone: true, services: true, networks: true },
    });
    return automationJson({ clients: rows.slice(0, limit), nextCursor: rows.length > limit ? rows[limit - 1].id : null, workspaceId: context.workspaceId });
  } catch (error) { return automationFailure(error); }
}
