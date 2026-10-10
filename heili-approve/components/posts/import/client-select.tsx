"use client";

/** "Cambia cliente" on the import page: reloads it for another client (?clientId=). */

import { useRouter } from "next/navigation";
import { useId } from "react";

export default function ImportClientSelect({
  clients,
  value,
}: {
  clients: Array<{ id: string; name: string }>;
  value: string;
}) {
  const router = useRouter();
  const id = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <label htmlFor={id} className="label-caps">
        Cliente
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => router.push(`/posts/import?clientId=${encodeURIComponent(e.target.value)}`)}
        className="field min-h-11 w-auto max-w-full"
        data-testid="import-client-select"
      >
        {clients.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
