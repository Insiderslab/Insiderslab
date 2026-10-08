/**
 * Piani del mese
 *
 * The monthly social plans of the workspace, per client and month: status,
 * progress ("8 di 12 approvati"), when it was sent and the due date. The
 * client picked in the main menu scopes the list (an explicit ?clientId=
 * wins). "Apri il piano del mese" opens or creates the plan of a client's
 * month (?clientId=&mese=YYYY-MM prefill it, as linked from the calendar).
 */

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { PlanProgressBar, PlanStatusChip } from "@/components/plans/plan-bits";
import NewPlanForm from "@/components/plans/new-plan-form";
import { formatDateTime } from "@/components/posts/helpers";
import { getCurrentClientId, resolveClientScope } from "@/lib/current-client";
import { prisma } from "@/lib/db/client";
import { addPlanMonths, parsePlanMonth, planMonthOf, planMonthTitle, planProgress } from "@/lib/plan-rules";
import { listPlansForWorkspace } from "@/lib/plans";
import { isKindEnabled, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Piani del mese - ${productName()}` };
}

type SearchParams = { clientId?: string | string[]; mese?: string | string[]; nuovo?: string | string[] };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function PlansPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");
  if (!isKindEnabled("SOCIAL_POST")) notFound();

  const params = await searchParams;
  const clients = await prisma.client.findMany({
    where: { workspaceId: context.workspaceId },
    select: { id: true, name: true, archivedAt: true, services: true, timezone: true },
    orderBy: { name: "asc" },
  });
  const scopedId = resolveClientScope(
    first(params.clientId),
    clients.map((c) => c.id),
    await getCurrentClientId(context.workspaceId)
  );
  const scoped = clients.find((c) => c.id === scopedId) ?? null;
  const plans = await listPlansForWorkspace(context.workspaceId, { clientId: scoped?.id ?? null });

  const socialClients = clients.filter((c) => !c.archivedAt && c.services.includes("SOCIAL_POST"));
  const now = new Date();
  const defaultMonth = parsePlanMonth(first(params.mese)) ?? addPlanMonths(planMonthOf(now, scoped?.timezone), 1);
  const fromLink = Boolean(first(params.nuovo));

  return (
    <div className="space-y-6">
      <section className="panel space-y-4 p-4 sm:p-5" aria-labelledby="new-plan">
        <div className="space-y-1">
          <h2 id="new-plan" className="text-lg font-semibold">
            Prepara il piano del mese
          </h2>
          <p className="text-sm text-muted">
            Il piano raccoglie gli stessi post del calendario in un unico percorso di revisione. La griglia è solo una
            vista del risultato su Instagram: non crea copie e non invia nulla da sola.
          </p>
        </div>
        <ol className="grid gap-2 sm:grid-cols-3" aria-label="Come funziona il piano del mese">
          {[
            ["1", "Apri il mese", "Scegli cliente e mese: trovi i post già preparati."],
            ["2", "Completa i post", "Crea quelli mancanti e controlla calendario e griglia."],
            ["3", "Invia al cliente", "Un solo invio apre la revisione di tutti i post pronti."],
          ].map(([number, title, body]) => (
            <li key={number} className="inset flex gap-3 p-3">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent">
                {number}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{title}</span>
                <span className="block text-xs leading-relaxed text-muted">{body}</span>
              </span>
            </li>
          ))}
        </ol>
        <NewPlanForm
          clients={socialClients.map((c) => ({ id: c.id, name: c.name }))}
          clientId={scoped && socialClients.some((c) => c.id === scoped.id) ? scoped.id : ""}
          month={defaultMonth}
          highlight={fromLink}
        />
      </section>

      <section className="space-y-3" aria-labelledby="plans-list">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="plans-list" className="text-lg font-semibold">
            {scoped ? `Piani di ${scoped.name}` : "Tutti i piani"}
          </h2>
          <p className="text-sm text-muted">{plans.length === 1 ? "1 piano" : `${plans.length} piani`}</p>
        </div>

        {plans.length === 0 ? (
          <div className="panel p-8 text-center">
            <h3 className="mb-1 text-base font-semibold">Ancora nessun piano</h3>
            <p className="mx-auto max-w-md text-sm text-muted">
              Scegli cliente e mese qui sopra: il piano raccoglie i post social di quel mese e li manda al cliente con un
              solo invio.
            </p>
          </div>
        ) : (
          <ul className="panel divide-y divide-border overflow-hidden" data-testid="plans-list">
            {plans.map((plan) => {
              const progress = planProgress(plan.posts.map((p) => p.status));
              const zone = plan.client.timezone;
              return (
                <li key={plan.id}>
                  <Link
                    href={`/plans/${plan.id}`}
                    className="grid gap-3 p-4 hover:bg-surface-hover md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_minmax(0,1.2fr)] md:items-center"
                    data-testid="plan-row"
                  >
                    <span className="min-w-0 space-y-1">
                      <span className="label-caps block">{planMonthTitle(plan.month)}</span>
                      <span className="block truncate text-base font-semibold">{plan.title}</span>
                      <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                        {plan.client.name}
                        <PlanStatusChip status={plan.status} sent={Boolean(plan.sentAt)} />
                      </span>
                    </span>
                    <span className="min-w-0">
                      {progress.total === 0 ? (
                        <span className="text-sm text-muted">Nessun post nel mese</span>
                      ) : (
                        <PlanProgressBar progress={progress} size="sm" />
                      )}
                    </span>
                    <span className="space-y-0.5 text-sm text-muted md:text-right">
                      <span className="block">
                        {plan.sentAt ? `Inviato ${formatDateTime(plan.sentAt, zone, { year: false })}` : "Da preparare e inviare"}
                      </span>
                      {plan.reviewDueAt && (
                        <span className="block">Risposta entro {formatDateTime(plan.reviewDueAt, zone, { year: false })}</span>
                      )}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
