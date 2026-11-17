# Operandis

Software development studio platform: portfolio, package catalogue & checkout, project configurator with indicative estimates, CRM & proposals, client portal and operations console.

## Run & Operate

- `pnpm dev` — API (:5000) + web (:5173, proxies /api)
- `pnpm typecheck` / `pnpm build` / `pnpm test` / `pnpm test:e2e`
- `pnpm db:migrate`, `pnpm db:seed` (drafts) or `pnpm db:seed:demo`, `pnpm create-admin -- --email …`
- `pnpm openapi` — regenerate docs/api/openapi.yaml
- Required env: `DATABASE_URL`, `APP_SECRET` (see docs/environment.md)

## Stack

pnpm workspaces · Node 22 · TypeScript 5.9 · Express 5 · PostgreSQL + Drizzle · Zod (`zod/v4`) · React 19 + Vite 7 + Tailwind 4 + Wouter · TanStack Query · Vitest · Playwright

## Where things live

- `lib/domain` pricing engine, money, state machines, permissions · `lib/db` schema + migrations · `lib/api-zod` contracts
- `artifacts/api-server/src/modules/*` API modules · `services/*` integrations · `test/*` integration tests
- `artifacts/operandi/src/pages/{portal,admin,auth}` · `src/components/ui-kit` primitives · tokens in `src/index.css`
- Docs: `README.md`, `docs/*`

## Architecture decisions

- Modular monolith; OpenAPI generated from the same Zod schemas used for validation
- Money in integer minor units; immutable snapshots for estimates, proposals, orders, invoices
- Payment state only changes on verified provider events (or finance-confirmed EFT)
- Outbox notifications with dedupe keys; append-only audit log enforced in the DB

## Gotchas

- Vite needs `PORT` and `BASE_PATH` (root scripts default them)
- Non-GET API calls need the `x-csrf-token` header (= `op_csrf` cookie)
- Test DBs: `operandis_test`, `operandis_e2e`
