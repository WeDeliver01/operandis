# Deployment

> **Production (operandis.co.za on web01): follow [vps-deployment.md](vps-deployment.md)** — Docker Compose + `deploy/deploy.sh`, the same pattern as AirHouse. This page covers the general model and non-Docker options.

## Topology options

**A. Single origin (recommended, simplest)** — one Node process serves `/api/*` and the built SPA (`SERVE_WEB_DIST`), behind a TLS-terminating proxy or platform router. Cookies are first-party, no CORS.

**B. Split** — static host/CDN serves `artifacts/operandi/dist/public` (rewrite `/* → /index.html`, as in the original `artifact.toml`) and proxies `/api/*` to the API. Keep it same-origin through the proxy; only use `CORS_ORIGINS` if the API must live on a different origin (cookies then need same-site domains).

Both need: managed PostgreSQL (14+), private object storage (or a persistent, backed-up disk for `local`), SMTP, payment-provider credentials, HTTPS.

## Build

```bash
pnpm install --frozen-lockfile
```

```bash
PORT=5173 BASE_PATH=/ pnpm build
```

Outputs: `artifacts/api-server/dist/{index,migrate,seed,jobs,create-admin}.mjs` (+ `dist/migrations`) and `artifacts/operandi/dist/public`. The API bundle externalises npm dependencies; ship it with production `node_modules` for the api-server package, e.g.:

```bash
pnpm --filter @workspace/api-server deploy --prod /srv/operandis-api
```

then copy `artifacts/api-server/dist` into `/srv/operandis-api/dist` (and `artifacts/operandi/dist/public` if using option A). The root `Dockerfile` and `docker-compose.yml` (used on web01 by `deploy/deploy.sh`) do exactly this; the stack was built and exercised end to end, including rollback.

## Release procedure

1. **Backup** the database (or confirm the latest automated snapshot) — see *Backups*.
2. **Migrate** (release step, before switching traffic):
   ```bash
   DATABASE_URL=… node dist/migrate.mjs
   ```
   Migrations are forward-only SQL in `lib/db/migrations`, applied in order and recorded in the `drizzle` schema. Never edit production schema by hand.
3. **First deploy only**: seed reference content and create the owner:
   ```bash
   node dist/seed.mjs
   ```
   ```bash
   node dist/create-admin.mjs --email owner@your-domain --name "Owner Name"
   ```
   The second command prints a 7-day password-setup link. Then in the console: approve pricing, publish packages, configure providers, tax, business details (see `owner-decisions.md`).
4. **Start/restart** the API:
   ```bash
   NODE_ENV=production node --enable-source-maps dist/index.mjs
   ```
5. **Smoke test**: `GET /api/v1/ready` is `200 ready`; home, `/packages`, `/configure` load; sign in to `/admin`; Console → Payments → Webhook log shows provider pings after a test payment.
6. **Schedule** `node dist/jobs.mjs` every 5 minutes (email outbox, expiring abandoned checkouts and proposals) — required when running more than one instance; harmless otherwise.

Health endpoints: `GET /api/v1/health` (liveness), `GET /api/v1/ready` (DB check; `503` when degraded), legacy `GET /api/healthz`.

## Rollback

- **Code**: redeploy the previous build. All migrations so far are additive; if a future migration is destructive, ship it in two releases (expand → migrate data → contract) so the previous build keeps working.
- **Data**: restore from backup only for data corruption; payment state can be re-derived from provider dashboards + the `webhook_events` log.
- **Pricing**: activate the previous pricing version in the console (versions are immutable, so rollback is a click).
- **Packages**: pause or unpublish; existing orders are unaffected (snapshots).

## Backups & restore

- Enable automated daily PostgreSQL backups with point-in-time recovery on the managed provider; retain ≥30 days (owner to define RPO/RTO).
- Back up object storage (bucket versioning or replication). With `STORAGE_DRIVER=local`, include `STORAGE_LOCAL_DIR` in backups.
- **Restore rehearsal** (quarterly): restore the latest backup to a scratch database, run `node dist/migrate.mjs` against it (should be a no-op), start an API instance pointed at it with `EMAIL_DRIVER=smtp` to a sink and payments disabled, and verify `/api/v1/ready`, a portal login and an invoice PDF.

## Environments

Use separate databases, buckets, SMTP credentials and payment credentials for development, staging and production. Staging should use PayFast/Yoco sandbox credentials and `seed:demo` data; production uses `seed` (drafts) and live credentials.

## Scaling notes

- Stateless API: run N instances behind a load balancer; sessions live in Postgres.
- Replace the in-memory rate limiter with a shared store before N > 1.
- Run `jobs.mjs` from exactly one scheduler.
- Postgres indexes cover lead status/owner/follow-up, invoice status/due date, payment references, project status and all foreign keys used in lists.

## Replit artifact

`artifacts/operandi/.replit-artifact/artifact.toml` still describes the static web artifact (unchanged). To run the full platform on Replit, add a service that runs the API (`pnpm --filter @workspace/api-server run start` after build) with `SERVE_WEB_DIST` set, or proxy `/api` to it, plus a Postgres database (`DATABASE_URL`).
