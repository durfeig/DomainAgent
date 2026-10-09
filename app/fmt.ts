export const usd = (n: number | null | undefined, d = 2) => (n === null || n === undefined ? "—" : `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d })}`);
export const k = (n: number | null | undefined) =>
  n === null || n === undefined ? "—" : n >= 1000 ? `$${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `$${Math.round(n)}`;
export const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-GB", { timeZone: "America/Argentina/Buenos_Aires", dateStyle: "short", timeStyle: "short" }) : "—");
