export type TestRow = Record<string, unknown>;

export type QueryTrace = {
  table: string;
  filters: Array<{ operation: "eq" | "gte" | "lte" | "lt"; column: string; value: unknown }>;
  orders: string[];
  range: [number, number] | null;
};

type QueryResult = {
  data: TestRow[];
  error: null;
};

class PagedPostgrestQuery implements PromiseLike<QueryResult> {
  private readonly filters: QueryTrace["filters"] = [];
  private readonly orders: string[] = [];
  private requestedRange: [number, number] | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: TestRow[],
    private readonly traces: QueryTrace[],
  ) {}

  select(): this {
    return this;
  }

  eq(column: string, value: unknown): this {
    this.filters.push({ operation: "eq", column, value });
    return this;
  }

  gte(column: string, value: unknown): this {
    this.filters.push({ operation: "gte", column, value });
    return this;
  }

  lte(column: string, value: unknown): this {
    this.filters.push({ operation: "lte", column, value });
    return this;
  }

  lt(column: string, value: unknown): this {
    this.filters.push({ operation: "lt", column, value });
    return this;
  }

  order(column: string): this {
    this.orders.push(column);
    return this;
  }

  range(from: number, to: number): this {
    this.requestedRange = [from, to];
    return this;
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return Promise.resolve(this.result()).then(onfulfilled, onrejected);
  }

  private result(): QueryResult {
    const trace: QueryTrace = {
      table: this.table,
      filters: [...this.filters],
      orders: [...this.orders],
      range: this.requestedRange,
    };
    this.traces.push(trace);

    const filtered = this.rows.filter((row) => this.filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.operation === "eq") return actual === filter.value;
      if (filter.operation === "gte") return String(actual) >= String(filter.value);
      if (filter.operation === "lte") return String(actual) <= String(filter.value);
      return String(actual) < String(filter.value);
    }));
    const ordered = [...filtered].sort((left, right) => {
      for (const column of this.orders) {
        const comparison = String(left[column]).localeCompare(String(right[column]));
        if (comparison !== 0) return comparison;
      }
      return 0;
    });
    const [from, to] = this.requestedRange ?? [0, 999];
    return { data: ordered.slice(from, to + 1), error: null };
  }
}

export class PagedPostgrestClient {
  readonly traces: QueryTrace[] = [];

  constructor(private readonly data: Record<string, TestRow[]>) {}

  from(table: string): PagedPostgrestQuery {
    return new PagedPostgrestQuery(table, this.data[table] ?? [], this.traces);
  }

  rangesFor(table: string): Array<[number, number] | null> {
    return this.traces
      .filter((trace) => trace.table === table)
      .map((trace) => trace.range);
  }

  ordersFor(table: string): string[][] {
    return this.traces
      .filter((trace) => trace.table === table)
      .map((trace) => trace.orders);
  }

  filtersFor(table: string): QueryTrace["filters"][] {
    return this.traces
      .filter((trace) => trace.table === table)
      .map((trace) => trace.filters);
  }
}
