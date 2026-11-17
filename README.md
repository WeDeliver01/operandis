# Operandis platform

Website, sales and delivery infrastructure for **Operandis**, a South African software development studio (operandis.co.za).

One application covers the whole journey — **Discover → Explore → Configure → Estimate → Consult → Purchase → Develop → Deliver**:

| Area | What it does |
| --- | --- |
| Public site | Portfolio & case studies (CMS-driven), services, package catalogue with server-quoted tiers/add-ons, contact form, Cal.com booking |
| Configurator | 10-step guided brief with autosave and emailed resume links → deterministic, versioned, server-side indicative estimate with manual-review flags |
| Commerce | Package checkout (PayFast hosted checkout, Yoco, manual EFT), signed webhook reconciliation, orders, invoices, refunds, credit notes |
| CRM & proposals | Deduplicated leads, activity timeline, tasks/follow-ups, brief review, versioned proposals with PDF, client clarification, content-hash-bound acceptance |
| Client portal | Dashboard, projects & milestones, proposals, invoices & online payment, orders, briefs & estimates, files, change requests, notifications, profile/MFA |
| Operations console | Dashboard, leads, briefs, proposals, projects, requests, orders, invoices, payments/EFT verification/refunds, packages, pricing rules, portfolio/services/FAQ CMS, users & roles, audit log, email log, settings, funnel report |

## Workspace map

```
artifacts/
  operandi/        React 19 + Vite 7 + Tailwind 4 + Wouter web app (public site, portal, console)
  api-server/      Express 5 modular-monolith API (+ integration/security tests, scripts)
lib/
  domain/          Pure business logic: money, pricing engine, package pricing, state machines, permissions (unit-tested)
  db/              Drizzle ORM schema + SQL migrations (PostgreSQL)
  api-zod/         Zod request/response contracts shared by server validation, OpenAPI and the web client
  api-client-react/ fetch wrapper (ApiError, problem+json) used by the web app
tests/e2e/         Playwright end-to-end journeys
docs/              Architecture, data model, pricing, payments, security, deployment, environment, OpenAPI
```

## Quick start (local)

Prerequisites: Node 22+, pnpm 10, PostgreSQL 14+.

```bash
pnpm install
```

```bash
cp .env.example .env    # then edit DATABASE_URL / APP_SECRET
```

```bash
pnpm db:migrate
```

```bash
pnpm db:seed:demo       # reference content + DEMO pricing, packages published, EFT enabled
```

```bash
pnpm create-admin --email you@example.com --name "Your Name"   # prints a one-time password-setup link
```

```bash
pnpm dev                # API on :5000, web on :5173 (Vite proxies /api → API)
```

Open http://localhost:5173. In development, emails are captured by the `log` driver; read them at `GET /api/v1/dev/outbox` (never mounted in production).

`pnpm db:seed` (without `:demo`) loads the same content but leaves packages and pricing rules as **drafts** — the right choice for production, where the owner must approve prices first.

## Scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev` / `dev:api` / `dev:web` | Run API and/or web in watch mode |
| `pnpm typecheck` | Typecheck all libraries and apps |
| `pnpm build` | Typecheck + production builds (`artifacts/api-server/dist`, `artifacts/operandi/dist/public`) |
| `pnpm test` | Domain unit tests + API integration/security tests (needs Postgres DB `operandis_test`) |
| `pnpm test:e2e` | Playwright journeys (needs Postgres DB `operandis_e2e`; starts its own servers) |
| `pnpm db:generate` | Generate a new SQL migration from schema changes |
| `pnpm db:migrate` | Apply migrations |
| `pnpm db:seed` / `db:seed:demo` | Idempotent seed (draft vs demo mode) |
| `pnpm create-admin -- --email … [--role owner\|admin\|staff\|finance]` | Bootstrap staff accounts |
| `pnpm openapi` | Regenerate `docs/api/openapi.yaml` from the live route registry |
| `pnpm --filter @workspace/api-server run jobs` | One-shot maintenance (email outbox, expire checkouts/proposals) |

Test databases: create `operandis_test` and `operandis_e2e` owned by your DB user. Override with `TEST_DATABASE_URL` / `E2E_DATABASE_URL`. For E2E in sandboxes with a pre-installed Chromium, set `PW_CHROMIUM` to its path.

## Documentation

- [docs/implementation-audit.md](docs/implementation-audit.md) — baseline audit of the original MVP and what changed
- [docs/architecture.md](docs/architecture.md) — modules, request lifecycle, key flows
- [docs/data-model.md](docs/data-model.md) — entities and relationships
- [docs/pricing-engine.md](docs/pricing-engine.md) — estimate formula, rules, versioning
- [docs/payments.md](docs/payments.md) — providers, webhooks, reconciliation, refunds
- [docs/security.md](docs/security.md) — threat model, access matrix, controls
- [docs/deployment.md](docs/deployment.md) — build, migrate, release, rollback, backups
- [docs/environment.md](docs/environment.md) — every environment variable
- [docs/owner-decisions.md](docs/owner-decisions.md) — commercial/legal inputs and credentials still required
- [docs/api/openapi.yaml](docs/api/openapi.yaml) — API contract (also served at `/api/v1/openapi.json`)

## Troubleshooting

- **`PORT environment variable is required`** — the Vite config (unchanged from the MVP) needs `PORT` and `BASE_PATH`; the root scripts default them to `5173` and `/`.
- **403 `csrf_failed`** — non-GET API calls must send the `op_csrf` cookie value in `x-csrf-token` (the web client does this automatically).
- **Configurator shows no prices** — no pricing version is active. Activate one under Console → Pricing rules (owner approval required for non-demo versions).
- **Checkout says payment isn't available** — enable a provider in Console → Settings → Commerce *and* set its credentials in the server environment.
- **PayFast ITNs never arrive locally** — PayFast must reach `PUBLIC_API_URL`; use a tunnel in development.
