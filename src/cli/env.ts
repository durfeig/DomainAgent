import { existsSync } from "node:fs";

/** Load .env for CLI usage (Node >= 20.12). Never prints values. */
export function loadDotEnv(file = ".env") {
  if (existsSync(file) && typeof process.loadEnvFile === "function") process.loadEnvFile(file);
}
