import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// src/version.ts and dist/version.js both live one level below the repo root
// (in src/ and dist/ respectively), so one ".." reaches the repo-root
// package.json identically in dev (tsx) and prod (compiled dist).
const here = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(here, "..", "package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };

export const VERSION: string = pkg.version ?? "0.0.0";
