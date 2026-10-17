/**
 * Client search of the "Per quale cliente?" pickers (QA-15): case and accent
 * insensitive, every word of the query must appear in the name. Pure.
 */

export function normalizeForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesClientQuery(name: string, query: string): boolean {
  const words = normalizeForSearch(query).split(" ").filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalizeForSearch(name);
  return words.every((word) => haystack.includes(word));
}

/** Clients whose name matches, in the given order. */
export function filterClients<T extends { name: string }>(clients: readonly T[], query: string): T[] {
  return clients.filter((client) => matchesClientQuery(client.name, query));
}

/** The recent ids that are still offered, in recency order, at most `limit`. */
export function recentClients<T extends { id: string }>(clients: readonly T[], recentIds: readonly string[], limit = 3): T[] {
  const byId = new Map(clients.map((client) => [client.id, client]));
  return recentIds.flatMap((id) => (byId.has(id) ? [byId.get(id) as T] : [])).slice(0, limit);
}
