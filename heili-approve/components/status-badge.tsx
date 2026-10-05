/**
 * Post status label. Plain text; color carries the state (DM by Heili style).
 */

import type { PostStatus } from "@/app/generated/prisma/client";
import { STATUS_LABELS, STATUS_TONES } from "@/lib/domain";

const toneClass = {
  neutral: "text-muted",
  info: "text-accent",
  warning: "text-warning",
  success: "text-success",
  error: "text-error",
} as const;

export default function StatusBadge({ status }: { status: PostStatus }) {
  return (
    <span
      className={`shrink-0 whitespace-nowrap text-sm font-medium ${toneClass[STATUS_TONES[status]]}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
