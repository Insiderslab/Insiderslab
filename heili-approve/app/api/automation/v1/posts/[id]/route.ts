import { prisma } from "@/lib/db/client";
import { authenticateAutomation, AutomationError } from "@/lib/automation/auth";
import { automationFailure, automationJson } from "@/lib/automation/http";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const context = await authenticateAutomation(request);
    const { id } = await params;
    if (id.length > 64) throw new AutomationError("NOT_FOUND", "Post non trovato", 404);
    const post = await prisma.post.findFirst({
      where: { id, workspaceId: context.workspaceId },
      select: { id: true, clientId: true, title: true, status: true, kind: true, publishAt: true, networks: true, currentVersionNumber: true, importKey: true,
        versions: { orderBy: { number: "desc" }, take: 1, select: { number: true, text: true, firstCommentText: true, media: true } } },
    });
    if (!post) throw new AutomationError("NOT_FOUND", "Post non trovato", 404);
    return automationJson({ post });
  } catch (error) { return automationFailure(error); }
}
