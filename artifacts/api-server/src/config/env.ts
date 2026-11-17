import { z } from "zod/v4";

const bool = z
  .enum(["true", "false", "1", "0", ""])
  .optional()
  .transform((v) => v === "true" || v === "1");

/**
 * Environment validation. The process refuses to start with an invalid or
 * unsafe configuration (e.g. production without a strong APP_SECRET).
 */
const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    API_PORT: z.coerce.number().int().positive().default(5000),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DATABASE_SSL: bool,
    DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
    /** Public URL of the website (used in emails and payment return URLs). */
    PUBLIC_WEB_URL: z.url().default("http://localhost:5173"),
    /** Public URL of the API as reachable by payment providers (webhooks). Defaults to PUBLIC_WEB_URL (same-origin proxy). */
    PUBLIC_API_URL: z.url().optional(),
    /** 32+ random bytes; signs file links/cookies and encrypts MFA secrets. */
    APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
    CORS_ORIGINS: z.string().default(""),
    TRUST_PROXY: z.string().default("loopback"),
    COOKIE_SECURE: bool,
    SESSION_DAYS: z.coerce.number().int().min(1).max(90).default(14),
    LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
    SERVE_WEB_DIST: z.string().optional(),
    RATE_LIMIT_DISABLED: bool,
    RUN_MIGRATIONS_ON_BOOT: bool,

    // Email
    EMAIL_DRIVER: z.enum(["log", "smtp"]).default("log"),
    EMAIL_FROM: z.string().default("Operandis <hello@operandis.co.za>"),
    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),
    SMTP_SECURE: bool,

    // File storage
    STORAGE_DRIVER: z.enum(["local", "s3"]).default("local"),
    STORAGE_LOCAL_DIR: z.string().default("./.data/files"),
    S3_BUCKET: z.string().optional(),
    S3_REGION: z.string().optional(),
    S3_ENDPOINT: z.string().optional(),
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: bool,
    FILE_MAX_BYTES: z.coerce.number().int().positive().default(15 * 1024 * 1024),

    // Payments — PayFast
    PAYFAST_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
    PAYFAST_MERCHANT_ID: z.string().optional(),
    PAYFAST_MERCHANT_KEY: z.string().optional(),
    PAYFAST_PASSPHRASE: z.string().optional(),
    /** Only honoured in sandbox mode: skip the server-to-server ITN validation call (offline tests). */
    PAYFAST_SKIP_REMOTE_VALIDATION: bool,
    PAYFAST_VERIFY_SOURCE_IP: bool,

    // Payments — Yoco
    YOCO_SECRET_KEY: z.string().optional(),
    YOCO_WEBHOOK_SECRET: z.string().optional(),
    YOCO_API_URL: z.url().default("https://payments.yoco.com"),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV === "production") {
      if (/change-me|dev-secret|test-secret/i.test(env.APP_SECRET)) {
        ctx.addIssue({ code: "custom", path: ["APP_SECRET"], message: "use a unique random secret in production" });
      }
      if (env.EMAIL_DRIVER === "log") {
        ctx.addIssue({ code: "custom", path: ["EMAIL_DRIVER"], message: "configure a real email driver in production" });
      }
      if (env.PAYFAST_SKIP_REMOTE_VALIDATION) {
        ctx.addIssue({ code: "custom", path: ["PAYFAST_SKIP_REMOTE_VALIDATION"], message: "not allowed in production" });
      }
    }
    if (env.PAYFAST_MODE === "live" && env.PAYFAST_SKIP_REMOTE_VALIDATION) {
      ctx.addIssue({ code: "custom", path: ["PAYFAST_SKIP_REMOTE_VALIDATION"], message: "only allowed in sandbox mode" });
    }
    if (env.EMAIL_DRIVER === "smtp" && !env.SMTP_HOST) {
      ctx.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "required when EMAIL_DRIVER=smtp" });
    }
    if (env.STORAGE_DRIVER === "s3" && !env.S3_BUCKET) {
      ctx.addIssue({ code: "custom", path: ["S3_BUCKET"], message: "required when STORAGE_DRIVER=s3" });
    }
  });

export type Env = z.infer<typeof envSchema>;

export interface AppConfig extends Env {
  publicApiUrl: string;
  corsOrigins: string[];
  cookieSecure: boolean;
  isProd: boolean;
  isTest: boolean;
}

export function loadConfig(source: Record<string, string | undefined> = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  - ${i.path.join(".")}: ${i.message}`).join("\n");
    throw new Error(`Invalid environment configuration:\n${lines}`);
  }
  const env = parsed.data;
  return {
    ...env,
    publicApiUrl: (env.PUBLIC_API_URL ?? env.PUBLIC_WEB_URL).replace(/\/$/, ""),
    PUBLIC_WEB_URL: env.PUBLIC_WEB_URL.replace(/\/$/, ""),
    corsOrigins: env.CORS_ORIGINS.split(",").map((s) => s.trim()).filter(Boolean),
    cookieSecure: env.COOKIE_SECURE || env.NODE_ENV === "production",
    isProd: env.NODE_ENV === "production",
    isTest: env.NODE_ENV === "test",
  };
}
