import { createDb, type Database, type DbHandle } from "@workspace/db";
import type { AppConfig } from "./config/env";
import { createLogger, type Logger } from "./lib/logger";
import { createEmailTransport, type EmailTransport } from "./services/email";
import { NotificationService } from "./services/notifications";
import { createPaymentRegistry, type PaymentRegistry, type PaymentProviderAdapter } from "./services/payments";
import { SettingsService } from "./services/settings";
import { createStorage, type StorageDriver } from "./services/storage";
import type { PaymentProvider } from "@workspace/db";

/** Everything a request handler may depend on. Constructed once at boot (or per test). */
export interface AppContext {
  config: AppConfig;
  db: Database;
  dbHandle: DbHandle;
  logger: Logger;
  settings: SettingsService;
  email: EmailTransport;
  notifications: NotificationService;
  storage: StorageDriver;
  payments: PaymentRegistry;
}

export interface ContextOverrides {
  logger?: Logger;
  email?: EmailTransport;
  storage?: StorageDriver;
  paymentAdapters?: Partial<Record<PaymentProvider, PaymentProviderAdapter>>;
}

export function createContext(config: AppConfig, overrides: ContextOverrides = {}): AppContext {
  const logger = overrides.logger ?? createLogger(config.LOG_LEVEL);
  const dbHandle = createDb(config.DATABASE_URL, { max: config.DATABASE_POOL_MAX, ssl: config.DATABASE_SSL });
  const settings = new SettingsService(dbHandle.db, config.isTest ? 0 : 5_000);
  const email = overrides.email ?? createEmailTransport(config, logger);
  return {
    config,
    db: dbHandle.db,
    dbHandle,
    logger,
    settings,
    email,
    notifications: new NotificationService(dbHandle.db, email, settings, config, logger),
    storage: overrides.storage ?? createStorage(config),
    payments: createPaymentRegistry(config, overrides.paymentAdapters),
  };
}
