import { getConfig } from "./config";
import { createStore } from "./adapters/store";
import { Repo } from "./core/repo";

/** Server-only singletons for the Next.js dashboard/API. Never import from client components. */
let repo: Repo | null = null;
export function getRepo(): Repo {
  if (!repo) repo = new Repo(createStore(getConfig()));
  return repo;
}
export { getConfig };
