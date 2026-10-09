import type { Config } from "../../config";
import { CloudflareRegistrar } from "./cloudflare";
import { MockRegistrar } from "./mock";
import type { RegistrarProvider } from "./types";

export * from "./types";

export function createRegistrar(cfg: Config): RegistrarProvider {
  if (cfg.REGISTRAR_PROVIDER === "mock") return new MockRegistrar();
  if (!cfg.CLOUDFLARE_ACCOUNT_ID || !cfg.CLOUDFLARE_API_TOKEN) {
    throw new Error(`REGISTRAR_PROVIDER=${cfg.REGISTRAR_PROVIDER} requires CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN`);
  }
  return new CloudflareRegistrar(cfg.CLOUDFLARE_ACCOUNT_ID, cfg.CLOUDFLARE_API_TOKEN, cfg.REGISTRAR_PROVIDER === "cloudflare_sandbox");
}
