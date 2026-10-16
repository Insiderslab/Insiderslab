import { z } from "zod";
import { AutomationError, type AutomationContext } from "./auth";
import { importPreparedDraft, prepareDraft } from "./drafts";

const envelope = z.object({
  externalId: z.string().trim().min(1).max(128).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:/-]*$/),
  post: z.object({ publishAt: z.iso.datetime({ offset: true }) }).passthrough(),
}).strict();

// Validation and creation live in ./drafts, shared with the agency panel's importer.
export async function prepareAutomationDraft(context: AutomationContext, body: unknown) {
  const outer = envelope.safeParse(body);
  if (!outer.success) throw new AutomationError("INVALID_INPUT", outer.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "));
  const { post, hash } = await prepareDraft(context.workspaceId, outer.data.post);
  // The panel importer and the MCP server both reject a date in the past;
  // the API must agree, otherwise it creates drafts that can never be scheduled.
  if (post.publishAt.getTime() <= Date.now()) {
    throw new AutomationError("INVALID_INPUT", "La data di pubblicazione è nel passato");
  }
  return { externalId: outer.data.externalId, post, hash };
}

export async function importAutomationDraft(context: AutomationContext, body: unknown) {
  const prepared = await prepareAutomationDraft(context, body);
  return importPreparedDraft(context, prepared, prepared.externalId);
}
