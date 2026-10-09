/**
 * Minimal table-store abstraction so the pipeline runs identically against
 * Supabase (production) and a local JSON file store (dev / tests / no credentials).
 */

export type Row = Record<string, unknown> & { id?: string };
// Generic methods accept any object type; implementations treat rows as `Row`.

export interface Query {
  eq?: Record<string, unknown>;
  in?: Record<string, unknown[]>;
  gte?: Record<string, string | number>;
  lte?: Record<string, string | number>;
  order?: { column: string; ascending?: boolean };
  limit?: number;
}

export const TABLES = [
  "runs",
  "run_events",
  "costs",
  "trend_signals",
  "concepts",
  "concept_signals",
  "assets",
  "availability_checks",
  "market_keyword_stats",
  "opportunities",
  "evaluations",
  "evidence",
  "decisions",
  "positions",
] as const;
export type Table = (typeof TABLES)[number];

export interface TableStore {
  readonly kind: "file" | "supabase";
  insert<T extends object>(table: Table, rows: T[]): Promise<T[]>;
  /** Insert or merge on the given conflict columns. Returns the stored rows (with ids). */
  upsert<T extends object>(table: Table, rows: T[], onConflict: string[]): Promise<T[]>;
  update<T extends object>(table: Table, id: string, patch: Partial<T>): Promise<T | null>;
  select<T extends object>(table: Table, query?: Query): Promise<T[]>;
  get<T extends object>(table: Table, id: string): Promise<T | null>;
  flush?(): Promise<void>;
}
