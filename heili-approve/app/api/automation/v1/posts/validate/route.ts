import { authenticateAutomation } from "@/lib/automation/auth";
import { automationFailure, automationJson, readAutomationJson } from "@/lib/automation/http";
import { prepareAutomationDraft } from "@/lib/automation/posts";

export async function POST(request: Request) {
  try {
    const context = await authenticateAutomation(request);
    const draft = await prepareAutomationDraft(context, await readAutomationJson(request));
    return automationJson({ valid: true, externalId: draft.externalId, post: draft.post });
  } catch (error) { return automationFailure(error); }
}
