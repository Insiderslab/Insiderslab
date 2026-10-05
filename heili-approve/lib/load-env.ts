/**
 * Loads `.env` for the standalone Node processes (worker, seed). Next.js loads
 * it by itself, but `tsx worker/...` does not. In Docker the variables come
 * from `env_file` and there is no `.env` in the image, so this is a no-op
 * there. Variables already set in the environment always win.
 *
 * Import it first (`import "@/lib/load-env"`), before any module that reads
 * process.env at load time.
 */

import { existsSync } from "node:fs";
import path from "node:path";

const envPath = path.resolve(process.cwd(), ".env");

if (existsSync(envPath) && typeof process.loadEnvFile === "function") {
  const before = { ...process.env };
  process.loadEnvFile(envPath);
  // loadEnvFile overrides existing keys on some Node versions: restore them.
  for (const [key, value] of Object.entries(before)) {
    if (value !== undefined) process.env[key] = value;
  }
}
