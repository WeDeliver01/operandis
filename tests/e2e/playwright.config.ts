import { defineConfig, devices } from "@playwright/test";

const API_PORT = 5055;
const WEB_PORT = 5175;
export const env = {
  NODE_ENV: "development",
  DATABASE_URL: process.env.E2E_DATABASE_URL ?? "postgres://operandis:operandis@localhost:5432/operandis_e2e",
  APP_SECRET: "e2e-only-secret-not-for-production-0123456789",
  API_PORT: String(API_PORT),
  PUBLIC_WEB_URL: `http://localhost:${WEB_PORT}`,
  EMAIL_DRIVER: "log",
  LOG_LEVEL: "warn",
  RATE_LIMIT_DISABLED: "true",
  STORAGE_LOCAL_DIR: "/tmp/operandis-e2e-files",
  PAYFAST_MODE: "sandbox",
  PAYFAST_MERCHANT_ID: "10000100",
  PAYFAST_MERCHANT_KEY: "46f0cd694581a",
  PAYFAST_PASSPHRASE: "jt7NOE43FZPn",
  // ITNs can't reach localhost from PayFast; the test posts signed sandbox ITNs itself.
  PAYFAST_SKIP_REMOTE_VALIDATION: "true",
};

export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  globalSetup: "./global-setup.ts",
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: "off", launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {} },
  projects: [{ name: "desktop", use: { ...devices["Desktop Chrome"] } }],
  webServer: [
    { command: "pnpm --dir ../../artifacts/api-server exec tsx src/index.ts", port: API_PORT, env, reuseExistingServer: false, timeout: 60_000 },
    { command: `pnpm --dir ../../artifacts/operandi exec vite --config vite.config.ts --port ${WEB_PORT} --strictPort`, port: WEB_PORT, env: { PORT: String(WEB_PORT), BASE_PATH: "/", API_URL: `http://localhost:${API_PORT}` }, reuseExistingServer: false, timeout: 60_000 },
  ],
});
