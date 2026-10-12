/** "1 commento", "2 commenti": the Italian singular/plural pair for a count. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}
