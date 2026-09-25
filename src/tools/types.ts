import type { EnvConfig } from "../config/env.js";
import type { BackendClient } from "../http/downstream.js";
import type { ResolvedScope } from "../scope.js";

/** Deps without the resolved scope — built once at startup. */
export interface BaseDeps {
  config: EnvConfig;
  backend: BackendClient;
  ragAgent: BackendClient;
}

/** Full deps passed to tool handlers (scope resolved per-request or at startup). */
export interface HandlerDeps extends BaseDeps {
  scope: ResolvedScope;
}
