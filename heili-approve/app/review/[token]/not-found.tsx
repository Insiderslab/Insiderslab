"use client";

/**
 * A post the client cannot open: wrong id, another client's post, a draft or
 * a cancelled post. Same message for all of them, with a way back to the list.
 */

import Link from "next/link";
import { useParams } from "next/navigation";
import { portalPath } from "@/components/portal/helpers";

export default function ReviewNotFound() {
  const params = useParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : null;

  return (
    <main className="space-y-4 py-8">
      <h1 className="text-xl font-semibold">Questo post non è disponibile</h1>
      <p className="text-base text-muted">
        Forse l&apos;agenzia lo ha ritirato o lo sta ancora preparando. Trovi tutti i post da rivedere
        nell&apos;elenco.
      </p>
      {token && (
        <Link
          href={portalPath(token)}
          className="inline-flex min-h-12 items-center justify-center rounded-lg bg-accent px-5 text-base font-semibold text-white hover:bg-accent-hover"
        >
          Vai all&apos;elenco dei post
        </Link>
      )}
    </main>
  );
}
