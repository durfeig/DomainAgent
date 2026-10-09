import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { Query, Row, Table, TableStore } from "./types";

/**
 * JSON-file store for local development and tests. One file per table under DATA_DIR.
 * Not for production (no concurrency control) — use Supabase there.
 */
export class FileStore implements TableStore {
  readonly kind = "file" as const;
  private cache = new Map<Table, { rows: Row[]; mtimeMs: number }>();
  private dirty = new Set<Table>();

  constructor(private readonly dir: string) {}

  private file(table: Table) {
    return path.join(this.dir, `${table}.json`);
  }

  /** Reads through an mtime-validated cache so several processes (CLI, Next workers) stay consistent. */
  private async load(table: Table): Promise<Row[]> {
    let mtimeMs = -1;
    try {
      mtimeMs = (await fs.stat(this.file(table))).mtimeMs;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const hit = this.cache.get(table);
    if (hit && (hit.mtimeMs === mtimeMs || this.dirty.has(table))) return hit.rows;
    let rows: Row[] = [];
    if (mtimeMs >= 0) rows = JSON.parse(await fs.readFile(this.file(table), "utf8")) as Row[];
    this.cache.set(table, { rows, mtimeMs });
    return rows;
  }

  private markDirty(table: Table) {
    this.dirty.add(table);
  }

  async flush() {
    await fs.mkdir(this.dir, { recursive: true });
    for (const table of this.dirty) {
      const entry = this.cache.get(table);
      const rows = entry?.rows ?? [];
      const tmp = `${this.file(table)}.${process.pid}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(rows, null, 1));
      await fs.rename(tmp, this.file(table));
      if (entry) entry.mtimeMs = (await fs.stat(this.file(table))).mtimeMs;
    }
    this.dirty.clear();
  }

  async insert<T extends object>(table: Table, input: T[]): Promise<T[]> {
    const rows = input as unknown as Row[];
    const all = await this.load(table);
    const out = rows.map((r) => ({ ...r, id: r.id ?? randomUUID() }) as Row);
    all.push(...out);
    this.markDirty(table);
    await this.flush();
    return out as unknown as T[];
  }

  async upsert<T extends object>(table: Table, input: T[], onConflict: string[]): Promise<T[]> {
    const rows = input as unknown as Row[];
    const all = await this.load(table);
    const key = (r: Row) => onConflict.map((c) => JSON.stringify(r[c] ?? null)).join("|");
    const index = new Map<string, number>();
    all.forEach((r, i) => index.set(key(r), i));
    const out: Row[] = [];
    for (const r of rows) {
      const k = key(r);
      const i = index.get(k);
      if (i !== undefined) {
        const merged: Row = { ...all[i], ...r, id: all[i].id };
        all[i] = merged;
        out.push(merged);
      } else {
        const created: Row = { ...r, id: r.id ?? randomUUID() };
        all.push(created);
        index.set(k, all.length - 1);
        out.push(created);
      }
    }
    this.markDirty(table);
    await this.flush();
    return out as unknown as T[];
  }

  async update<T extends object>(table: Table, id: string, patch: Partial<T>): Promise<T | null> {
    const all = await this.load(table);
    const i = all.findIndex((r) => r.id === id);
    if (i < 0) return null;
    all[i] = { ...all[i], ...(patch as Row), id };
    this.markDirty(table);
    await this.flush();
    return all[i] as unknown as T;
  }

  async get<T extends object>(table: Table, id: string): Promise<T | null> {
    const all = await this.load(table);
    return (all.find((r) => r.id === id) as unknown as T) ?? null;
  }

  async select<T extends object>(table: Table, q: Query = {}): Promise<T[]> {
    let rows = [...(await this.load(table))];
    if (q.eq) for (const [c, v] of Object.entries(q.eq)) rows = rows.filter((r) => r[c] === v);
    if (q.in) for (const [c, vs] of Object.entries(q.in)) rows = rows.filter((r) => vs.includes(r[c]));
    if (q.gte) for (const [c, v] of Object.entries(q.gte)) rows = rows.filter((r) => (r[c] as string | number) >= v);
    if (q.lte) for (const [c, v] of Object.entries(q.lte)) rows = rows.filter((r) => (r[c] as string | number) <= v);
    if (q.order) {
      const { column, ascending = true } = q.order;
      rows.sort((a, b) => {
        const av = a[column] as string | number | null;
        const bv = b[column] as string | number | null;
        if (av === bv) return 0;
        if (av === null || av === undefined) return 1;
        if (bv === null || bv === undefined) return -1;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    if (q.limit !== undefined) rows = rows.slice(0, q.limit);
    return rows as unknown as T[];
  }
}
