/**
 * Import keyword sale statistics (e.g. NameBio's free keyword stats spreadsheet, exported as CSV)
 * into `market_keyword_stats`. These become FACTS for the underwriter, with source + as_of date.
 *
 *   npm run import:namebio-keywords -- ./keyword-stats.csv --as-of 2026-10-01 \
 *     [--col-keyword Keyword --col-count Sales --col-avg "Average Price" --col-median "Median Price" --col-max "Max Price"]
 *
 * Column names in NameBio's file could not be verified from this environment: pass the --col-*
 * flags to map them. Rows with an unparsable keyword are skipped; unparsable numbers become null.
 */
import { readFileSync } from "node:fs";
import { loadConfig } from "../config";
import { createStore } from "../adapters/store";
import { loadDotEnv } from "./env";

loadDotEnv();
const argv = process.argv.slice(2);
const flag = (name: string, def: string) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : def;
};
const file = argv.find((a) => !a.startsWith("--") && argv[argv.indexOf(a) - 1]?.startsWith("--") !== true);
if (!file) {
  console.error("usage: npm run import:namebio-keywords -- <file.csv> --as-of YYYY-MM-DD [--col-keyword ...]");
  process.exit(1);
}
const asOf = flag("as-of", "");
if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) {
  console.error("--as-of YYYY-MM-DD is required (date the statistics were downloaded)");
  process.exit(1);
}
const cols = {
  keyword: flag("col-keyword", "Keyword"),
  count: flag("col-count", "Sales"),
  avg: flag("col-avg", "Average Price"),
  median: flag("col-median", "Median Price"),
  max: flag("col-max", "Max Price"),
};

const rows = parseCsv(readFileSync(file, "utf8"));
const header = rows.shift() ?? [];
const idx = Object.fromEntries(Object.entries(cols).map(([k, name]) => [k, header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())]));
if (idx.keyword < 0) {
  console.error(`Keyword column "${cols.keyword}" not found. Header: ${header.join(" | ")}`);
  process.exit(1);
}
const num = (v: string | undefined) => {
  if (v === undefined) return null;
  const n = Number(v.replace(/[$,\s]/g, ""));
  return v.trim() !== "" && Number.isFinite(n) ? n : null;
};
const records = rows
  .map((r) => ({
    keyword: (r[idx.keyword] ?? "").trim().toLowerCase(),
    source: "namebio_keyword_stats",
    as_of: asOf,
    sales_count: idx.count >= 0 ? num(r[idx.count]) : null,
    avg_price: idx.avg >= 0 ? num(r[idx.avg]) : null,
    median_price: idx.median >= 0 ? num(r[idx.median]) : null,
    max_price: idx.max >= 0 ? num(r[idx.max]) : null,
    mock: false,
  }))
  .filter((r) => /^[a-z0-9-]{1,40}$/.test(r.keyword));

const store = createStore(loadConfig());
for (let i = 0; i < records.length; i += 1000) await store.upsert("market_keyword_stats", records.slice(i, i + 1000), ["keyword", "source"]);
console.log(`Imported ${records.length} keyword rows (missing columns: ${Object.entries(idx).filter(([, v]) => v < 0).map(([k]) => k).join(", ") || "none"})`);

function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') (cell += '"'), i++;
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") row.push(cell), (cell = "");
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((c) => c !== "")) out.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    out.push(row);
  }
  return out;
}
