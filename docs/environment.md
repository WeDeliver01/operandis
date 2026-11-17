# Environment variables

Validated at boot by `artifacts/api-server/src/config/env.ts` — the API refuses to start with invalid or unsafe values. Copy `.env.example` to `.env` for local work. **Never commit `.env`. Never give a server secret a `VITE_` prefix** (anything prefixed `VITE_` is compiled into public JavaScript).

## API server

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | | `development` | `production` enables secure cookies, strict checks, hides dev endpoints |
| `DATABASE_URL` | ✓ | | PostgreSQL connection string |
| `DATABASE_SSL` | | `false` | `true` for managed Postgres requiring TLS |
| `DATABASE_POOL_MAX` | | `10` | |
| `API_PORT` | | `5000` | |
| `PUBLIC_WEB_URL` | | `http://localhost:5173` | Public site origin — used in emails and payment return URLs |
| `PUBLIC_API_URL` | | = `PUBLIC_WEB_URL` | Origin providers use for webhooks (must be public HTTPS in production) |
| `APP_SECRET` | ✓ | | ≥32 chars random (`openssl rand -base64 48`). Signs file links / estimate & order access tokens, encrypts MFA secrets. Rotating it invalidates outstanding links and requires MFA re-enrolment |
| `CORS_ORIGINS` | | empty | Comma-separated origins allowed to call the API cross-origin with credentials. Leave empty for same-origin deploys |
| `TRUST_PROXY` | | `loopback` | Express trust-proxy setting (`true`, hop count, or subnet) so client IPs/rate limits are correct behind a proxy |
| `COOKIE_SECURE` | | auto | Forces `Secure` cookies (always on in production) |
| `SESSION_DAYS` | | `14` | Fallback; Settings → Security takes precedence |
| `LOG_LEVEL` | | `info` | |
| `SERVE_WEB_DIST` | | | Path to `artifacts/operandi/dist/public` to serve the SPA from the API (single-origin deploy) |
| `RATE_LIMIT_DISABLED` | | `false` | Tests only |
| `RUN_MIGRATIONS_ON_BOOT` | | `false` | Prefer running `migrate` as a release step |
| `MIGRATIONS_DIR` | | auto | Override migrations folder location |
| `EMAIL_DRIVER` | | `log` | `log` (dev/test only; rejected in production) or `smtp` |
| `EMAIL_FROM` | | `Operandis <hello@operandis.co.za>` | Must be a verified sending domain (SPF/DKIM/DMARC) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_SECURE` | with smtp | | Any transactional provider's SMTP relay |
| `STORAGE_DRIVER` | | `local` | `local` or `s3` |
| `STORAGE_LOCAL_DIR` | | `./.data/files` | Must be persistent & backed up if used in production |
| `S3_BUCKET` / `S3_REGION` / `S3_ENDPOINT` / `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` / `S3_FORCE_PATH_STYLE` | with s3 | | Any S3-compatible store (AWS, Cloudflare R2, MinIO…). Bucket must be private |
| `FILE_MAX_BYTES` | | `15728640` | Upload limit |
| `PAYFAST_MODE` | | `sandbox` | `sandbox` or `live` |
| `PAYFAST_MERCHANT_ID` / `PAYFAST_MERCHANT_KEY` / `PAYFAST_PASSPHRASE` | for PayFast | | Secrets |
| `PAYFAST_VERIFY_SOURCE_IP` | | `false` | Check ITN source IPs against PayFast hosts |
| `PAYFAST_SKIP_REMOTE_VALIDATION` | | `false` | **Sandbox/tests only** — rejected with `live` mode or in production |
| `YOCO_SECRET_KEY` / `YOCO_WEBHOOK_SECRET` | for Yoco | | Secrets |
| `YOCO_API_URL` | | `https://payments.yoco.com` | |

Test-only: `TEST_DATABASE_URL` (integration tests), `E2E_DATABASE_URL`, `PW_CHROMIUM` (E2E browser path).

## Web app (Vite, build-time)

| Variable | Required | Notes |
| --- | --- | --- |
| `PORT` | ✓ (dev/preview) | Existing MVP requirement, preserved |
| `BASE_PATH` | ✓ | Existing MVP requirement (`/` for root deploys) |
| `API_URL` | | Dev/preview proxy target for `/api` (default `http://localhost:5000`) |
| `VITE_GA4_ID`, `VITE_GOOGLE_ADS_ID`, `VITE_META_PIXEL_ID`, `VITE_LINKEDIN_PARTNER_ID` | | Public tag IDs, loaded only after consent (unchanged from MVP; see `artifacts/operandi/.env.example`) |

## Business configuration (not env)

Business details, commerce terms, enabled payment providers, EFT bank details, tax/VAT, security policy and configurator availability are **runtime settings** edited in Console → Settings (stored in the `settings` table, audited). Tax and security groups are owner-only.
