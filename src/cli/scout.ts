/**
 * RUN SCOUT from the command line:
 *   npm run scout                 # uses .env (defaults: all mocks + local file store)
 *   npm run scout -- --quiet      # only the digest
 *   npm run scout -- --slack      # also post the digest to SLACK_WEBHOOK_URL
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { loadConfig } from "../config";
import { runScout } from "../pipeline/run";
import { loadDotEnv } from "./env";

loadDotEnv();
const args = new Set(process.argv.slice(2));
const cfg = loadConfig();

const result = await runScout(cfg, { trigger: "cli", quiet: args.has("--quiet") });
mkdirSync("out", { recursive: true });
const file = `out/digest-${result.run.started_at.slice(0, 16).replace(/[:T]/g, "-")}.md`;
writeFileSync(file, result.digest.text);

console.log("\n" + "=".repeat(72));
console.log(result.digest.text);
console.log("=".repeat(72));
console.log(`Digest saved to ${file}`);

if (args.has("--slack")) {
  if (!cfg.SLACK_WEBHOOK_URL) {
    console.error("--slack given but SLACK_WEBHOOK_URL is not set");
    process.exitCode = 1;
  } else {
    const res = await fetch(cfg.SLACK_WEBHOOK_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: result.digest.text }) });
    console.log(`Slack: HTTP ${res.status}`);
  }
}
