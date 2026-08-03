export type PostgrestPage<T> = {
  data: T[] | null;
  error: unknown;
};

export async function loadAllPostgrestPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PostgrestPage<T>>,
  pageSize = 1_000,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const page = await loadPage(from, from + pageSize - 1);
    if (page.error) throw page.error;
    const pageRows = page.data ?? [];
    rows.push(...pageRows);
    if (pageRows.length < pageSize) return rows;
  }
}
