"use client";

/**
 * Body of the portal's not-found page (app/review/[token]/not-found.tsx):
 * the token comes from the URL, the wording from the instance's kinds
 * ("post", "articolo" or "contenuto", all masculine in Italian).
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { portalPath, type PortalNoun } from "@/components/portal/helpers";

export default function ReviewNotFoundView({ noun }: { noun: PortalNoun }) {
  const params = useParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : null;

  return (
    <main className="space-y-4 py-8">
      <h1 className="text-xl font-semibold">Questo {noun.one} non è disponibile</h1>
      <p className="text-base text-muted">
        Forse l&apos;agenzia lo ha ritirato o lo sta ancora preparando. Trovi tutti {noun.theMany} da rivedere
        nell&apos;elenco.
      </p>
      {token && (
        <Link
          href={portalPath(token)}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover"
        >
          Vai all&apos;elenco {noun.ofMany}
        </Link>
      )}
    </main>
  );
}
