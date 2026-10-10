/**
 * Import from Metricool
 *
 * Every brand of the connected Metricool account, with a choice per brand:
 * create a client, link an existing one, ignore. Owners and admins only, on
 * instances with social posts. The brands are read here, on the server: the
 * Metricool token never reaches the browser.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import MetricoolImport from "@/components/clients/metricool-import";
import { MetricoolError } from "@/lib/metricool/client";
import { loadImportRows, type ImportPageData } from "@/lib/metricool/import-service";
import { isMetricoolEnabled, productName } from "@/lib/variant";
import { canManageWorkspace, getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Importa da Metricool - ${productName()}` };
}

function Notice({ children }: { children: React.ReactNode }) {
  return <div className="panel rounded p-4 text-sm sm:p-6">{children}</div>;
}

export default async function ImportFromMetricoolPage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  if (!isMetricoolEnabled()) redirect("/clients");

  let data: ImportPageData | null = null;
  let problem: "not_configured" | { message: string } | null = null;
  if (canManageWorkspace(context.role)) {
    try {
      data = await loadImportRows(context.workspaceId);
    } catch (error) {
      if (error instanceof MetricoolError && error.code === "not_configured") problem = "not_configured";
      else if (error instanceof MetricoolError) problem = { message: error.message };
      else {
        console.error("[import] Failed to load Metricool brands:", error instanceof Error ? error.name : "unknown");
        problem = { message: "Impossibile leggere i brand da Metricool in questo momento." };
      }
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <Link href="/clients" className="text-sm text-muted hover:text-foreground">
        ← Clienti
      </Link>

      <div>
        <h2 className="text-base font-semibold">Importa da Metricool</h2>
        <p className="mt-1 text-sm text-muted">
          Ogni brand di Metricool diventa un cliente. Scegli cosa fare con ciascuno: crearlo, collegarlo a un
          cliente che hai già, oppure lasciarlo fuori.
        </p>
      </div>

      {!canManageWorkspace(context.role) && (
        <Notice>
          <p className="text-muted">Solo titolari e amministratori possono importare i clienti da Metricool.</p>
        </Notice>
      )}

      {problem === "not_configured" && (
        <Notice>
          <p className="text-muted">
            Metricool non è collegato.{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Collegalo nelle Impostazioni
            </Link>{" "}
            e torna qui: bastano il token e l&apos;ID utente.
          </p>
        </Notice>
      )}

      {problem && problem !== "not_configured" && (
        <Notice>
          <p className="text-warning">
            {problem.message}{" "}
            <Link href="/settings" className="text-accent hover:underline">
              Controlla le Impostazioni
            </Link>
            .
          </p>
        </Notice>
      )}

      {data && data.rows.length === 0 && (
        <Notice>
          <p className="text-muted">Nessun brand trovato sull&apos;account Metricool collegato.</p>
        </Notice>
      )}

      {data && data.rows.length > 0 && (
        <MetricoolImport rows={data.rows} candidates={data.candidates} fake={data.fake} />
      )}
    </div>
  );
}
