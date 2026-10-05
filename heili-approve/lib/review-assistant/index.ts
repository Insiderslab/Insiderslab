/**
 * Server entry point of the review assistant. Client components must import
 * from "@/lib/review-assistant/shared" instead (this module pulls in Prisma
 * and the provider SDKs).
 */

export { AssistantError, getAssistantProvider, isAssistantEnabled } from "./provider";
export type { AssistantProviderName, ReviewAssistantProvider } from "./provider";
export { finalizeSession, getAssistantState, sendAssistantMessage } from "./service";
export type { AssistantReviewer, FinalizeInput, SendMessageInput } from "./service";
export * from "./shared";
