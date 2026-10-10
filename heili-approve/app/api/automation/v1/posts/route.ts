import { authenticateAutomation } from "@/lib/automation/auth";
import { automationFailure, automationJson, readAutomationJson } from "@/lib/automation/http";
import { importAutomationDraft } from "@/lib/automation/posts";

export async function POST(request: Request) {
  try {
    const context = await authenticateAutomation(request);
    const result = await importAutomationDraft(context, await readAutomationJson(request));
    return automationJson(result, result.replayed ? 200 : 201);
  } catch (error) { return automationFailure(error); }
}
