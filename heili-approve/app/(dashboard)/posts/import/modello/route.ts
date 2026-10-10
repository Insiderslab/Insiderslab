import { NextRequest, NextResponse } from "next/server";
import { buildTemplateCsv, buildTemplateXlsx } from "@/lib/post-import/template";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

/**
 * The template of "Importa post": `?formato=xlsx` (default) or `?formato=csv`.
 * Agency only. The example row has a date a week from now, so it imports as it is.
 */
export async function GET(request: NextRequest) {
  const context = await getCurrentWorkspaceContext();
  if (!context) return NextResponse.json({ success: false, error: "Non autorizzato" }, { status: 401 });

  const exampleDate = new Intl.DateTimeFormat("it-IT", {
    timeZone: "Europe/Rome",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(Date.now() + 7 * 86_400_000));

  const csv = request.nextUrl.searchParams.get("formato") === "csv";
  const body = csv ? buildTemplateCsv({ exampleDate }) : new Uint8Array(await buildTemplateXlsx({ exampleDate }));
  return new NextResponse(body, {
    headers: {
      "Content-Type": csv ? "text/csv; charset=utf-8" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="modello-importa-post.${csv ? "csv" : "xlsx"}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
