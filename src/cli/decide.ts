/**
 * Record a human decision (feedback loop) from the command line:
 *   npm run decide -- <opportunity-id|domain> APPROVE "great exact match"
 *   npm run decide -- agentpassport.com REJECT "too long"
 *   npm run decide -- <id> BUY "bought manually at Cloudflare" --cost 10.44
 * BUY only RECORDS a purchase you executed yourself; the system never registers domains.
 */
import { loadConfig } from "../config";
import { createStore } from "../adapters/store";
import { Repo } from "../core/repo";
import { DecisionInputSchema } from "../core/schemas";
import type { Opportunity } from "../core/types";
import { loadDotEnv } from "./env";

loadDotEnv();
const argv = process.argv.slice(2);
const costIdx = argv.indexOf("--cost");
const cost = costIdx >= 0 ? Number(argv[costIdx + 1]) : undefined;
const [target, action, ...rest] = argv.filter((_, i) => costIdx < 0 || (i !== costIdx && i !== costIdx + 1));
if (!target || !action) {
  console.error('usage: npm run decide -- <opportunity-id|domain> <APPROVE|REJECT|WATCH|BUY> "reason" [--cost 10.44]');
  process.exit(1);
}
const cfg = loadConfig();
const repo = new Repo(createStore(cfg));
let opp: Opportunity | null = await repo.store.get<Opportunity>("opportunities", target);
if (!opp) opp = await repo.opportunityByIdentifier("domain", target.toLowerCase());
if (!opp) {
  console.error(`No opportunity found for "${target}"`);
  process.exit(1);
}
const input = DecisionInputSchema.parse({ action: action.toUpperCase(), reason: rest.join(" "), acquisition_cost: cost });
const d = await repo.recordDecision(opp.id, input, cfg.DECISION_ACTOR);
console.log(`${d.actor} ${d.action} ${opp.asset_identifier} (decision ${d.id})`);
