/**
 * Structured logging. Every event is a JSON line on stdout AND (when attached to a run)
 * buffered into `run_events` so a run can be audited stage by stage from the dashboard/SQL.
 * Never pass secrets in `data` — `redact()` is a last line of defence, not the primary control.
 */

export type Level = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  ts: string;
  level: Level;
  run_id: string | null;
  stage: string;
  event: string;
  data?: Record<string, unknown>;
}

const SECRET_KEY = /(api[_-]?key|token|secret|password|authorization|service[_-]?role)/i;

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = SECRET_KEY.test(k) ? "[redacted]" : redact(v, depth + 1);
  }
  return out;
}

export class Logger {
  readonly events: LogEvent[] = [];
  constructor(
    private runId: string | null = null,
    private readonly opts: { quiet?: boolean; minLevel?: Level } = {},
  ) {}

  setRun(runId: string) {
    this.runId = runId;
  }

  private emit(level: Level, stage: string, event: string, data?: Record<string, unknown>) {
    const e: LogEvent = {
      ts: new Date().toISOString(),
      level,
      run_id: this.runId,
      stage,
      event,
      data: data ? (redact(data) as Record<string, unknown>) : undefined,
    };
    this.events.push(e);
    const order: Level[] = ["debug", "info", "warn", "error"];
    if (!this.opts.quiet && order.indexOf(level) >= order.indexOf(this.opts.minLevel ?? "info")) {
      const line = JSON.stringify(e);
      if (level === "error" || level === "warn") console.error(line);
      else console.log(line);
    }
  }

  debug(stage: string, event: string, data?: Record<string, unknown>) {
    this.emit("debug", stage, event, data);
  }
  info(stage: string, event: string, data?: Record<string, unknown>) {
    this.emit("info", stage, event, data);
  }
  warn(stage: string, event: string, data?: Record<string, unknown>) {
    this.emit("warn", stage, event, data);
  }
  error(stage: string, event: string, data?: Record<string, unknown>) {
    this.emit("error", stage, event, data);
  }

  /** Drain buffered events (used to persist them in batches). */
  drain(): LogEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
