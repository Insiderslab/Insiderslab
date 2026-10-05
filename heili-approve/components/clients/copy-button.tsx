"use client";

/**
 * Copy Button
 *
 * Copies a value to the clipboard and confirms inline. Falls back to the
 * legacy execCommand path (older iOS Safari, non-secure origins in dev).
 */

import { useState } from "react";

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const field = document.createElement("textarea");
    field.value = value;
    field.setAttribute("readonly", "");
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(field);
    return ok;
  } catch {
    return false;
  }
}

interface CopyButtonProps {
  value: string;
  label?: string;
  className?: string;
}

export default function CopyButton({ value, label = "Copia link", className }: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function handleClick() {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    window.setTimeout(() => setState("idle"), 2000);
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className={
        className ??
        "rounded border border-border px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:border-border-hover hover:text-foreground"
      }
    >
      {state === "copied" ? "Copiato" : state === "failed" ? "Copia non riuscita" : label}
    </button>
  );
}
