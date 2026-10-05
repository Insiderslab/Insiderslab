"use client";

/**
 * Modal sheet for the portal's decisions (approve / request changes).
 * A native <dialog> opened with showModal(): focus trap, Esc and the
 * backdrop come from the browser. Docked to the bottom on phones, centered
 * on wider screens. While `busy`, it cannot be dismissed.
 */

import { useEffect, useId, useRef, type ReactNode } from "react";

export default function BottomSheet({
  open,
  title,
  onClose,
  busy = false,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  busy?: boolean;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(event) => {
        // Esc: keep the dialog while an action is running.
        event.preventDefault();
        if (!busy) onClose();
      }}
      onClick={(event) => {
        // A click on the backdrop lands on the <dialog> element itself.
        if (event.target === event.currentTarget && !busy) onClose();
      }}
      className="m-0 mt-auto max-h-[90dvh] w-full max-w-full overflow-y-auto rounded-t-2xl border border-border bg-background p-0 text-foreground backdrop:bg-black/50 sm:m-auto sm:max-w-md sm:rounded-2xl"
    >
      <div className="space-y-4 p-5" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
        <h2 id={titleId} className="text-lg font-semibold">
          {title}
        </h2>
        {children}
      </div>
    </dialog>
  );
}
