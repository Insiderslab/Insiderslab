/**
 * Guida
 *
 * How to use Approve, learnable in a few minutes: the agency's path from the
 * first client to the scheduled post (lib/help/agency-guide.ts), each step
 * with a link to the page where it is done, the client's three steps and a
 * short FAQ. Static text, no data: the dashboard's «Per iniziare» is the part
 * that follows the workspace's progress.
 */

import Link from "next/link";
import { redirect } from "next/navigation";
import { agencyGuideQuestions, agencyGuideSteps } from "@/lib/help/agency-guide";
import { PORTAL_INTRO_STEPS } from "@/lib/help/portal-intro";
import { enabledKinds, productName } from "@/lib/variant";
import { getCurrentWorkspaceContext } from "@/lib/workspace-access";

export async function generateMetadata() {
  return { title: `Guida - ${productName()}` };
}

export default async function GuidePage() {
  const context = await getCurrentWorkspaceContext();
  if (!context) redirect("/login");

  const kinds = enabledKinds();
  const steps = agencyGuideSteps(kinds);
  const numbered = steps.filter((step) => step.id !== "mcp");
  const extra = steps.find((step) => step.id === "mcp");
  const questions = agencyGuideQuestions(kinds);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header className="space-y-2">
        <p className="label-caps">Come usare {productName()}</p>
        <h2 className="text-2xl font-semibold leading-tight">Dal primo cliente all&apos;approvazione, in pochi minuti</h2>
        <p className="text-muted">
          {numbered.length} passi brevi: ognuno ti porta alla pagina giusta. Il cliente non installa nulla e non ha
          password: apre il suo link e risponde dal telefono.
        </p>
      </header>

      <section aria-labelledby="guida-passi" className="space-y-3">
        <h2 id="guida-passi" className="sr-only">
          I passi
        </h2>
        <ol className="space-y-3">
          {numbered.map((step, index) => (
            <GuideStepCard key={step.id} step={step} number={index + 1} />
          ))}
        </ol>
        {extra && (
          <div className="pt-2">
            <p className="label-caps mb-2">In più</p>
            <GuideStepCard step={extra} />
          </div>
        )}
      </section>

      <section aria-labelledby="guida-cliente" className="panel space-y-3 p-4 sm:p-5">
        <h2 id="guida-cliente" className="text-lg font-semibold">
          Il percorso del cliente
        </h2>
        <p className="text-sm text-muted">
          La prima volta che apre il suo link il cliente legge questi tre passi. Dopo li ritrova con «Come funziona?» e
          nella Guida di Heili.
        </p>
        <ol className="grid gap-2 sm:grid-cols-3">
          {PORTAL_INTRO_STEPS.map((step, index) => (
            <li key={step.title} className="inset flex gap-2.5 p-3 text-sm">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-soft text-xs font-semibold text-accent">
                {index + 1}
              </span>
              <span className="min-w-0">
                <span className="block font-semibold">{step.title}</span>
                <span className="text-muted">{step.text}</span>
              </span>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="guida-domande" className="space-y-3">
        <h2 id="guida-domande" className="text-lg font-semibold">
          Domande frequenti
        </h2>
        <ul className="space-y-2">
          {questions.map((item) => (
            <li key={item.id}>
              <details className="panel group !rounded-xl" data-testid={`guida-faq-${item.id}`}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 font-semibold [&::-webkit-details-marker]:hidden">
                  {item.question}
                  <svg viewBox="0 0 24 24" className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <p className="border-t border-border px-4 py-3 text-sm leading-6 text-muted">{item.answer}</p>
              </details>
            </li>
          ))}
        </ul>
        <p className="text-sm text-muted">
          Un&apos;altra domanda? «Guida e aiuto», in alto in ogni pagina, cerca tra tutti gli argomenti e ti suggerisce
          quelli della pagina in cui sei.
        </p>
      </section>
    </div>
  );
}

function GuideStepCard({ step, number }: { step: ReturnType<typeof agencyGuideSteps>[number]; number?: number }) {
  const Wrapper = number ? "li" : "div";
  return (
    <Wrapper className="panel p-4 sm:p-5" data-testid={`guida-passo-${step.id}`}>
      <h3 className="text-lg font-semibold leading-snug">
        {number && <span className="tabular text-muted">{number}. </span>}
        {step.title}
      </h3>
      <p className="mt-1.5 text-[15px] leading-6 text-muted">{step.body}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {step.links.map((link) => (
          <Link key={link.href} href={link.href} className="btn !min-h-11">
            {link.label}
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
          </Link>
        ))}
      </div>
    </Wrapper>
  );
}
