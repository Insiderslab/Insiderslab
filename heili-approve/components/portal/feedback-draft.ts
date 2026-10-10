import type { CommentDraft } from "./comment-composer";

/** Stable 128-bit digest: the review token never appears in storage keys. */
export function feedbackDraftKey(scope: string, draft: CommentDraft): string {
  const identity = JSON.stringify({ scope, draft });
  let hash = BigInt("0x6c62272e07bb014262b821756295c58d");
  const prime = BigInt("0x1000000000000000000013");
  const mask = (BigInt(1) << BigInt(128)) - BigInt(1);
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= BigInt(identity.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return `approve-feedback-draft:v1:${hash.toString(16).padStart(32, "0")}`;
}

export interface StoredFeedbackDraft {
  body: string;
  start: string;
  end: string;
  withEnd: boolean;
}

/** Some privacy modes throw while the storage property itself is being read. */
export function feedbackStorage(source: { readonly localStorage: Storage }): Storage | null {
  try {
    return source.localStorage;
  } catch {
    return null;
  }
}

export function parseStoredFeedbackDraft(value: string | null): StoredFeedbackDraft | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<StoredFeedbackDraft>;
    if (typeof parsed.body !== "string" || parsed.body.length > 5000) return null;
    return {
      body: parsed.body,
      start: typeof parsed.start === "string" ? parsed.start.slice(0, 20) : "",
      end: typeof parsed.end === "string" ? parsed.end.slice(0, 20) : "",
      withEnd: parsed.withEnd === true,
    };
  } catch {
    return null;
  }
}

export function readFeedbackDraft(storage: Pick<Storage, "getItem">, key: string): StoredFeedbackDraft | null {
  try {
    return parseStoredFeedbackDraft(storage.getItem(key));
  } catch {
    return null;
  }
}

export function writeFeedbackDraft(storage: Pick<Storage, "setItem">, key: string, draft: StoredFeedbackDraft): void {
  try {
    storage.setItem(key, JSON.stringify(draft));
  } catch {
    // Storage can be disabled or full; the in-memory draft still remains usable.
  }
}

export function removeFeedbackDraft(storage: Pick<Storage, "removeItem">, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // The user can still clear and submit the in-memory draft.
  }
}
