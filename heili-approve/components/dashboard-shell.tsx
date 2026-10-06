"use client";

import { useState } from "react";
import Sidebar from "@/components/sidebar";
import TopBar from "@/components/top-bar";
import type { AppVariant } from "@/lib/variant";

interface DashboardShellProps {
  children: React.ReactNode;
  workspaceName: string;
  metricoolConnected: boolean;
  needsAttention: number;
  /** Product variant of this instance (read on the server, see lib/variant.ts). */
  variant: AppVariant;
}

export default function DashboardShell({
  children,
  workspaceName,
  metricoolConnected,
  needsAttention,
  variant,
}: DashboardShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    // h-dvh, not h-screen: on mobile browsers the URL bar eats into 100vh.
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        workspaceName={workspaceName}
        variant={variant}
      />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <TopBar
          onMenuClick={() => setSidebarOpen(true)}
          metricoolConnected={metricoolConnected}
          needsAttention={needsAttention}
          variant={variant}
        />

        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <div className="px-4 lg:px-8 py-5 sm:py-6 max-w-7xl mx-auto">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
