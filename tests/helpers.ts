import { mkdtempSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, type Config } from "../src/config";

/** Config with every adapter mocked and an isolated temp file store. */
export function testConfig(overrides: Record<string, unknown> = {}): Config {
  const dir = mkdtempSync(path.join(os.tmpdir(), "arbos-"));
  return loadConfig({
    STORE_PROVIDER: "file",
    DATA_DIR: dir,
    LLM_PROVIDER: "mock",
    REGISTRAR_PROVIDER: "mock",
    MARKET_PROVIDER: "mock",
    TREND_SOURCES: "mock",
    AUTO_BUY_ENABLED: "false",
    ...overrides,
  });
}
