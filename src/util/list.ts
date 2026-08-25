/**
 * Extract the row array from a backend list response.
 *
 * The platform's list endpoints return `ListResponse<T>` with the rows in
 * `listData` (a custom wrapper — not a Spring `Page`, so no `content`).
 * The remaining keys are defensive fallbacks for bare arrays or any future
 * endpoint using a different envelope.
 */
export function itemsOf(body: unknown): any[] {
  const b = body as any;
  if (Array.isArray(b)) return b;
  if (b && Array.isArray(b.listData)) return b.listData;
  if (b && Array.isArray(b.items)) return b.items;
  if (b && Array.isArray(b.content)) return b.content;
  if (b && Array.isArray(b.data)) return b.data;
  return [];
}
