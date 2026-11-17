import pino from "pino";

/** Keys whose values are always redacted from logs. */
export const REDACT_PATHS = [
  "req.headers.cookie",
  "req.headers.authorization",
  "req.headers['x-csrf-token']",
  'res.headers["set-cookie"]',
  "password",
  "*.password",
  "*.newPassword",
  "*.currentPassword",
  "*.token",
  "*.passphrase",
  "*.signature",
  "*.mfaSecret",
];

export function createLogger(level: string) {
  return pino({
    level,
    redact: { paths: REDACT_PATHS, censor: "[redacted]" },
    base: { service: "operandis-api" },
    timestamp: pino.stdTimeFunctions.isoTime,
  });
}

export type Logger = pino.Logger;
