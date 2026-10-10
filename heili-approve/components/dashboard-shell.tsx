"use client";

import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import HelpGuide from "@/components/help/help-guide";
import type { SwitcherClient } from "@/components/client-switcher";
import type { AppVariant } from "@/lib/variant";
import { enabledKinds } from "@/lib/variant";
import type { ContentKind } from "@/app/generated/prisma/client";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  metricoolConnected: boolean;
  needsAttention: number;
  /** Product variant of this instance (read on the server, see lib/variant.ts). */
  variant: AppVariant;
  /** Clients for the selector in the menu (not archived), and the one picked. */
  clients: SwitcherClient[];
  currentClientId: string | null;
  /** Active services of the selected client; all variant kinds when viewing every client. */
  currentClientServices?: readonly ContentKind[];
}

export default function DashboardShell({
  children,
  workspaceName,
  metricoolConnected,
  needsAttention,
  variant,
  clients,
  currentClientId,
  currentClientServices,
}: DashboardShellProps) {
  const currentClient = clients.find((c) => c.id === currentClientId) ?? null;
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
        variant={variant}
        clients={clients}
        currentClientId={currentClientId}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          metricoolConnected={metricoolConnected}
          needsAttention={needsAttention}
          variant={variant}
          currentClientName={currentClient?.name ?? null}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden scroll-smooth">
          <div className="mx-auto w-full max-w-[1500px] px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-8">
            <div className="mb-5 flex justify-end">
              <HelpGuide
                audience="agency"
                services={currentClientId ? (currentClientServices ?? enabledKinds(variant)) : enabledKinds(variant)}
              />
            </div>
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
