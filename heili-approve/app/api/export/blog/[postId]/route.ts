import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import {
  blogExportBaseName,
  buildBlogHtmlExport,
  buildBlogMarkdownExport,
  coerceBlogContent,
} from "@/lib/content/blog";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

/**
 * Article export for the agency (GET /api/export/blog/<postId>?format=md|html).
 *
 * - md: Markdown with YAML front matter (title, slug, date, SEO, categories,
 *   tags, featured image) for static-site generators;
 * - html: a clean page whose <article> (h1, featured image with alt, body
 *   sanitized by renderMarkdownSafe) can be pasted into WordPress.
 *
 * Workspace-scoped and BLOG_ARTICLE only. Once the client approved, the
 * approved version is exported; before that the latest version is exported
 * marked as not approved (front matter `approved: false`, a warning comment
 * in the HTML, "-non-approvato" in the file name and an X-Heili-Warning
 * header the UI can show).
 */

const querySchema = z.object({
  format: z.enum(["md", "html"]).default("md"),
});

type ExportParams = { params: Promise<{ postId: string }> };

const APPROVED_STATUSES = new Set(["APPROVED", "DELIVERED"]);

function errorResponse(error: string, status: number) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(request: NextRequest, { params }: ExportParams) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return errorResponse("Non autorizzato", 401);

  const { postId } = await params;
  if (!postId || postId.length > 64) return errorResponse("Articolo non trovato", 404);

  const query = querySchema.safeParse({ format: request.nextUrl.searchParams.get("format") ?? undefined });
  if (!query.success) return errorResponse("Formato non valido: usa md oppure html", 400);
  const { format } = query.data;

  const post = await prisma.post.findFirst({
    where: { id: postId, workspaceId: context.workspaceId },
    select: { id: true, title: true, kind: true, status: true, publishAt: true, currentVersionNumber: true },
  });
  if (!post) return errorResponse("Articolo non trovato", 404);
  if (post.kind !== "BLOG_ARTICLE") return errorResponse("Questo contenuto non è un articolo di blog", 400);

  const approved = APPROVED_STATUSES.has(post.status);
  let versionNumber = post.currentVersionNumber;
  if (approved) {
    const approval = await prisma.postEvent.findFirst({
      where: { postId: post.id, type: "APPROVED", versionNumber: { not: null } },
      orderBy: { createdAt: "desc" },
      select: { versionNumber: true },
    });
    versionNumber = approval?.versionNumber ?? post.currentVersionNumber;
  }

  const version = await prisma.postVersion.findUnique({
    where: { postId_number: { postId: post.id, number: versionNumber } },
    select: { number: true, content: true },
  });
  if (!version) return errorResponse("Versione dell'articolo non trovata", 404);

  const content = coerceBlogContent(version.content);
  const meta = { publishAt: post.publishAt, versionNumber: version.number, approved, postTitle: post.title };
  const baseName = `${blogExportBaseName(content, post.title)}${approved ? "" : "-non-approvato"}`;

  const body = format === "md" ? buildBlogMarkdownExport(content, meta) : buildBlogHtmlExport(content, meta);
  const fileName = `${baseName}.${format}`;

  const headers = new Headers({
    "Content-Type": format === "md" ? "text/markdown; charset=utf-8" : "text/html; charset=utf-8",
    // The base name is a slug (ASCII letters, digits, dashes): safe to quote as is.
    "Content-Disposition": `attachment; filename="${fileName}"`,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    // Opened by mistake instead of downloaded, the page still cannot run anything.
    "Content-Security-Policy": "default-src 'none'; img-src https: http:; style-src 'unsafe-inline'; sandbox",
  });
  if (!approved) headers.set("X-Heili-Warning", "Versione non ancora approvata dal cliente");

  return new NextResponse(body, { status: 200, headers });
}
