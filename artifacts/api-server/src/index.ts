import { loadConfig } from "./config/env";
import { createContext } from "./context";
import { createApp } from "./app";
import { runMigrations } from "@workspace/db";
import { expireStaleAttempts } from "./services/payment-processing";

async function main() {
  const config = loadConfig();
  const app = createContext(config);
  if (config.RUN_MIGRATIONS_ON_BOOT) {
    app.logger.info("running migrations");
    await runMigrations(app.db);
  }
  const server = createApp(app);
  const http = server.listen(config.API_PORT, () => {
    app.logger.info({ port: config.API_PORT, env: config.NODE_ENV, email: app.notifications.transportName, storage: app.storage.name }, "Operandis API listening");
  });

  // Lightweight in-process background work. For multiple instances, run `jobs` as a single scheduled task instead.
  const timers = [
    setInterval(() => app.notifications.kick(), 15_000),
    setInterval(() => void expireStaleAttempts(app).catch((err) => app.logger.warn({ err }, "expire attempts failed")), 60 * 60_000),
  ];

  const shutdown = (signal: string) => {
    app.logger.info({ signal }, "shutting down");
    timers.forEach(clearInterval);
    http.close(async () => {
      await app.notifications.idle();
      await app.dbHandle.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
