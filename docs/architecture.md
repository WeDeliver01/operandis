# Architecture

## Shape

A **modular monolith**: one TypeScript API process plus one PostgreSQL database, with the React SPA either served by the API (same origin, simplest) or by a static host behind a reverse proxy that forwards `/api`. No microservices — module boundaries are code boundaries.

```
Browser (public site · configurator · checkout · client portal · console)
   │  same-origin HTTPS JSON (/api/v1), cookie session + CSRF header
   ▼
Express 5 API (artifacts/api-server)
   ├─ middleware: request id + structured logs → helmet/CSP → CORS allow-list → raw body (webhooks)
   │              → JSON → cookies → rate limits → session → CSRF → typed routes → problem+json errors
   ├─ modules: auth · content · catalogue · configurator · pricing · crm · proposals
   │           · commerce (checkout, webhooks, finance) · projects · files · portal · system · openapi
   ├─ services: accounts · leads · invoicing · payment-processing · notifications (outbox) · email
   │            · storage (local/S3) · payments (PayFast/Yoco/EFT adapters) · pdf · settings · audit
   ▼
PostgreSQL (system of record; Drizzle migrations; DB-level integrity guards)
   + private object storage (local disk or S3-compatible) + SMTP + payment gateways
```

## Packages and boundaries

| Package | Responsibility | Depends on |
| --- | --- | --- |
| `lib/domain` | Pure functions: money (integer minor units, basis points, half-up rounding, exact allocation), estimate engine, package quoting & compatibility, state machines, RBAC matrix, analytics taxonomy. No I/O. | zod |
| `lib/db` | Drizzle schema, migrations, pool factory, migrator | domain (types) |
| `lib/api-zod` | Request/response contracts | domain |
| `artifacts/api-server` | HTTP, persistence, integrations | all libs |
| `artifacts/operandi` | UI | api-zod (types), domain (constants, client-side validation preview), api-client-react |

The browser may run the same domain functions for instant feedback (configurator step validation, proposal editor preview, pricing-rule preview), but **every price, total, deposit, permission and state transition is recomputed and enforced on the server**.

## Typed routes → validation → OpenAPI

Each module exports `RouteDef[]` built with `defineRoute({ method, path, auth, permission, body, query, params, response, handler })`. `mountRoutes`:

1. enforces auth level / permission (staff routes also enforce the MFA policy),
2. validates params, query and body with the Zod schemas,
3. runs the handler, and in non-production validates the response against `response` (tests fail on contract drift),
4. records the definition in a registry from which `/api/v1/openapi.json` and `docs/api/openapi.yaml` are generated.

A contract test asserts every mounted route is documented and every `/admin/*` route declares a permission.

## Key flows

**Configurator** — `POST /configurator/drafts` returns a secret resume token (stored hashed); `PATCH` autosaves (debounced + on step change) and can email a resume link. `POST /configurator/submissions` (idempotency key) runs in one transaction: find-or-create client account → deduplicated lead → immutable brief → estimate snapshot (active rule version id + full engine output) → notifications (outbox). If no rule version is active, the brief is still captured with `status: pending_rules`.

**Package checkout** — server quote → pending order with immutable snapshot (package version, selection, quote, terms version) → payment attempt with unique reference → provider checkout (PayFast signed form POST / Yoco redirect / EFT instructions). Nothing is marked paid by a redirect. A verified provider event (or finance-confirmed EFT) runs `applySuccessfulPayment` in a transaction holding a row lock on the attempt: transaction (unique per provider id) → order confirmed → paid invoice/receipt (gapless number) → project + milestones → lead won → notifications with dedupe keys.

**Proposal → project** — staff draft (server computes totals from line items, tax snapshot and milestone percentages) → send (freezes content, computes SHA-256 content hash, emails a magic link to passwordless clients) → client views/asks questions → edits after sending create a new version and supersede the old → acceptance requires the current version and the exact hash; one transaction creates order, project (`awaiting_deposit`), milestones and a deposit invoice. Projects cannot move to `in_progress` until the deposit is paid or an audited exception is recorded.

**Notifications** — rows are inserted inside the business transaction (outbox); a dispatcher sends queued email after commit (in-process every 15 s, or `jobs` script), with per-row claiming, retries and a `dedupe_key` so duplicate webhooks never send duplicate emails. In-app notifications are rows read by the portal.

## Data & time conventions

- Money: integer minor units (ZAR cents) + currency; ratios in basis points; BigInt intermediate maths.
- Timestamps stored `timestamptz` (UTC); displayed in `Africa/Johannesburg`.
- Public identifiers are UUIDs; human references are generated with a row-locked counter (`INV-2026-00001`, `ORD-…`, `PRO-…`, `BRF-…`, `EST-…`, `PRJ-…`, `CR-…`, `LD-…`, `PAY-…`, `CN-…`).
- Financial rows are never hard-deleted (DB triggers); the audit log is append-only (DB trigger).

## Frontend structure

- `src/lib`: `api.ts` (CSRF-aware fetch, problem+json helpers), `auth.tsx` (session context + route guard), `queries.ts`, `format.ts`, `settings.tsx`, `analytics.ts` (consent-gated first-party funnel events).
- `src/components/ui-kit`: accessible primitives on the existing tokens (buttons, fields with labels/errors, choice cards, badges, alerts, modal/confirm, loading/empty/error states).
- Pages: public (`pages/*`), auth (`pages/auth`), portal (`pages/portal`), console (`pages/admin`). Portal and console are code-split.
- The six original MDX case studies are preserved verbatim; any other portfolio slug renders from the CMS (`CaseStudy.tsx`). Portfolio cards, ordering, status labels and publication come from the database for all projects.

## Background work

`src/index.ts` runs light intervals (email outbox every 15 s, expire abandoned gateway attempts hourly). For multiple API instances, disable reliance on these by scheduling `node dist/jobs.mjs` once every few minutes (it also expires proposals past their validity date); outbox claiming is safe to run concurrently.
