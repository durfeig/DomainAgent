import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import type { Query, Row, Table, TableStore } from "./types";

/**
 * Supabase/Postgres store. Uses the service-role key server-side only
 * (RLS is enabled on every table with no public policies — see supabase/migrations).
 */
export class SupabaseStore implements TableStore {
  readonly kind = "supabase" as const;
  private client: SupabaseClient;

  constructor(url: string, serviceRoleKey: string) {
    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private fail(op: string, table: Table, error: { message: string } | null): never {
    throw new Error(`Supabase ${op} ${table} failed: ${error?.message ?? "unknown error"}`);
  }

  async insert<T extends object>(table: Table, rows: T[]): Promise<T[]> {
    if (rows.length === 0) return [];
    const out: T[] = [];
    for (const chunk of chunks((rows as unknown as Row[]).map((r) => ({ ...r, id: r.id ?? randomUUID() })), 500)) {
      const { data, error } = await this.client.from(table).insert(chunk as Record<string, unknown>[]).select();
      if (error) this.fail("insert", table, error);
      out.push(...((data ?? []) as unknown as T[]));
    }
    return out;
  }

  async upsert<T extends object>(table: Table, rows: T[], onConflict: string[]): Promise<T[]> {
    if (rows.length === 0) return [];
    const out: T[] = [];
    // Never send `id` on upsert: on conflict Postgres would overwrite the primary key and
    // break foreign keys. New rows get their id from the column default (gen_random_uuid()).
    for (const chunk of chunks((rows as unknown as Row[]).map(({ id: _id, ...rest }) => rest), 500)) {
      const { data, error } = await this.client
        .from(table)
        .upsert(chunk as Record<string, unknown>[], { onConflict: onConflict.join(","), ignoreDuplicates: false, defaultToNull: false })
        .select();
      if (error) this.fail("upsert", table, error);
      out.push(...((data ?? []) as unknown as T[]));
    }
    return out;
  }

  async update<T extends object>(table: Table, id: string, patch: Partial<T>): Promise<T | null> {
    const { data, error } = await this.client.from(table).update(patch as Record<string, unknown>).eq("id", id).select().maybeSingle();
    if (error) this.fail("update", table, error);
    return (data as unknown as T) ?? null;
  }

  async get<T extends object>(table: Table, id: string): Promise<T | null> {
    const { data, error } = await this.client.from(table).select("*").eq("id", id).maybeSingle();
    if (error) this.fail("get", table, error);
    return (data as unknown as T) ?? null;
  }

  async select<T extends object>(table: Table, q: Query = {}): Promise<T[]> {
    let query = this.client.from(table).select("*");
    if (q.eq) for (const [c, v] of Object.entries(q.eq)) query = v === null ? query.is(c, null) : query.eq(c, v as string);
    if (q.in) for (const [c, vs] of Object.entries(q.in)) query = query.in(c, vs as string[]);
    if (q.gte) for (const [c, v] of Object.entries(q.gte)) query = query.gte(c, v);
    if (q.lte) for (const [c, v] of Object.entries(q.lte)) query = query.lte(c, v);
    if (q.order) query = query.order(q.order.column, { ascending: q.order.ascending ?? true });
    query = query.limit(q.limit ?? 5000);
    const { data, error } = await query;
    if (error) this.fail("select", table, error);
    return (data ?? []) as unknown as T[];
  }
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
