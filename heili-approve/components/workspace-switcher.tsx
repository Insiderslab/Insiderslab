"use client";

/**
 * Workspace ("profile") switcher.
 *
 * Shown at the bottom of the sidebar. A user who belongs to more than one
 * workspace (e.g. the 3Runes team, which is admin of every client profile)
 * can jump between profiles; a client belongs to a single workspace and just
 * sees their own profile name. Switching POSTs to /api/workspace/switch and
 * refreshes the server components so every page re-renders in the new context.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface WorkspaceListPayload {
  success: boolean;
  data?: {
    activeWorkspaceId: string | null;
    workspaces: Array<{ id: string; name: string; role: string }>;
  };
}

export default function WorkspaceSwitcher({
  fallbackName,
}: {
  fallbackName: string;
}) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<
    Array<{ id: string; name: string; role: string }>
  >([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/workspace/list")
      .then((res) => res.json())
      .then((payload: WorkspaceListPayload) => {
        if (payload.success && payload.data) {
          setWorkspaces(payload.data.workspaces);
          setActiveId(payload.data.activeWorkspaceId);
        }
      })
      .catch(() => {});
  }, []);

  async function switchWorkspace(workspaceId: string) {
    if (workspaceId === activeId || busy) return;
    setBusy(true);
    try {
      const res = await fetch("/api/workspace/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
      });
      if (res.ok) {
        setActiveId(workspaceId);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  if (workspaces.length <= 1) {
    return (
      <p className="text-sm text-foreground truncate">
        {workspaces[0]?.name ?? fallbackName}
      </p>
    );
  }

  return (
    <label className="block">
      <span className="sr-only">Cambia workspace</span>
      <select
        value={activeId ?? ""}
        disabled={busy}
        onChange={(event) => void switchWorkspace(event.target.value)}
        className="w-full cursor-pointer rounded border border-border bg-surface px-2 py-1.5 text-sm text-foreground transition hover:bg-surface-hover disabled:opacity-60"
      >
        {workspaces.map((workspace) => (
          <option key={workspace.id} value={workspace.id}>
            {workspace.name}
          </option>
        ))}
      </select>
    </label>
  );
}
