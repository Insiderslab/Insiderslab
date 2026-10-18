"use client";

/**
 * Client filter of the Attività page: a select that navigates to the same
 * page with ?clientId= (removing it when "Tutti i clienti" is chosen, and
 * resetting the "completed" view).
 */

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export default function ClientFilter({
  clients,
  current,
}: {
  clients: Array<{ id: string; name: string }>;
  current: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function change(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set("clientId", value);
    else params.delete("clientId");
    params.delete("chiuse");
    params.delete("dopo");
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname);
  }

  return (
    <select
      value={current ?? ""}
      onChange={(event) => change(event.target.value)}
      aria-label="Filtra per cliente"
      className="field !w-auto min-w-[160px] text-sm"
    >
      <option value="">Tutti i clienti</option>
      {clients.map((client) => (
        <option key={client.id} value={client.id}>
          {client.name}
        </option>
      ))}
    </select>
  );
}
