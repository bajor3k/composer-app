const DEFAULT_BATCH = 1000;

/**
 * Paginate a Supabase query that may exceed the 1000-row default limit.
 *
 * Accepts a callback that receives (from, to) range bounds and must return
 * the query with `.range(from, to)` applied. This lets callers add any
 * filters, ordering, or column selection before pagination kicks in.
 *
 * @example
 *   const rows = await paginateQuery<Account>((from, to) =>
 *     supabase.from("Account").select("id, name").eq("isManaged", true).range(from, to)
 *   );
 */
export async function paginateQuery<T = Record<string, unknown>>(
  buildQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null }>,
  batchSize: number = DEFAULT_BATCH,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  while (true) {
    const { data } = await buildQuery(from, from + batchSize - 1);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < batchSize) break;
    from += batchSize;
  }

  return all;
}
