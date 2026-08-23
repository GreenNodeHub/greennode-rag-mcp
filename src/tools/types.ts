import type { EnvConfig } from "../config/env.js";
import type { BackendClient } from "../http/downstream.js";
export interface HandlerDeps {
  config: EnvConfig;
  backend: BackendClient;
}
