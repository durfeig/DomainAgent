/** Print the digest of the latest run (or a given run id): npm run digest [-- <run-id>] */
import { loadConfig } from "../config";
import { createStore } from "../adapters/store";
import { Repo } from "../core/repo";
import { loadDotEnv } from "./env";

loadDotEnv();
const repo = new Repo(createStore(loadConfig()));
const id = process.argv[2];
const run = id ? await repo.getRun(id) : (await repo.listRuns(1))[0];
if (!run) {
  console.error("No runs found. Run `npm run scout` first.");
  process.exit(1);
}
console.log(run.digest_text ?? "(run has no digest)");
