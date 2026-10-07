/**
 * Post status chip (Heili StatusChip): tone soft background, tone text, a
 * small mark and always the word. Colors: neutral = offline, info = brand,
 * warning = stale, success = fresh, error = critical.
 */

import type { PostStatus } from "@/app/generated/prisma/client";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/domain";

type Tone = "neutral" | "info" | "warning" | "success" | "error";

export const TONE_CHIP: Record<Tone, string> = {
  neutral: "chip chip-offline",
  info: "chip chip-brand",
  warning: "chip chip-stale",
  success: "chip chip-fresh",
  error: "chip chip-critical",
};

/** The mark inside the chip: a ring for waiting states, a dot for done, a tick for success, "!" for problems. */
export function ToneMark({ tone }: { tone: Tone }) {
  return (
    <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {tone === "success" ? (
        <path d="m3.5 8.5 3 3 6-6.5" />
      ) : tone === "error" || tone === "warning" ? (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3.5M8 11h.01" />
        </>
      ) : tone === "info" ? (
        <>
          <circle cx="8" cy="8" r="6" />
          <path d="M8 5v3l2 1.5" />
        </>
      ) : (
        <circle cx="8" cy="8" r="5.5" />
      )}
    </svg>
  );
}

export function ToneChip({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  return (
    <span className={`${TONE_CHIP[tone]} shrink-0`}>
      <ToneMark tone={tone} />
      {children}
    </span>
  );
}

export default function StatusBadge({ status }: { status: PostStatus }) {
  return <ToneChip tone={STATUS_TONES[status]}>{STATUS_LABELS[status]}</ToneChip>;
}
