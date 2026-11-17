import { execFileSync } from "node:child_process";
import path from "node:path";
import { env } from "./playwright.config";

export default function globalSetup() {
  execFileSync("pnpm", ["--dir", path.resolve(import.meta.dirname, "../../artifacts/api-server"), "exec", "tsx", "test/e2e-reset.ts"], { env: { ...process.env, ...env }, stdio: "inherit" });
}
