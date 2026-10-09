import path from "node:path";
import type { Config } from "../../config";
import { FileStore } from "./file";
import { SupabaseStore } from "./supabase";
import type { TableStore } from "./types";

export * from "./types";

export function createStore(cfg: Config): TableStore {
  if (cfg.STORE_PROVIDER === "supabase") {
    if (!cfg.SUPABASE_URL || !cfg.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("STORE_PROVIDER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
    }
    return new SupabaseStore(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY);
  }
  return new FileStore(path.resolve(cfg.DATA_DIR));
}
