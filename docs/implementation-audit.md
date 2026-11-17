# Implementation audit — baseline (pre-expansion)

Audit date: 17 November 2026. Source: `operandi-site-codebase.zip` (274 entries under `operandi-site/`).
This file records **what existed before the platform expansion**, so later changes can be compared against it.

## 1. Workspace

| Item | Observed |
| --- | --- |
| Package manager | pnpm 10 workspace (`pnpm-workspace.yaml`): `artifacts/*`, `lib/*`, `lib/integrations/*`, `scripts` |
| Supply-chain guard | `minimumReleaseAge: 1440` (1 day) — **retained** |
| Catalog | React 19.1.0, Vite ^7.3.2, Tailwind ^4.1.14, Wouter ^3.3.5, TanStack Query ^5.90, zod ^3.25.76, drizzle-orm ^0.45.2, tsx |
| TypeScript | 5.9, `tsconfig.base.json` (strict null checks, `noImplicitAny`), root `tsconfig.json` with project references to `lib/db`, `lib/api-client-react`, `lib/api-zod` |
| Packages present | `artifacts/operandi` (web), `lib/api-client-react` |
| Packages referenced but **missing** | `lib/db`, `lib/api-zod` (referenced from root `tsconfig.json`); `replit.md` also describes `@workspace/api-server` and `@workspace/api-spec` |
| CI / deployment files | None besides `artifacts/operandi/.replit-artifact/artifact.toml` (static SPA hosting with `/* → /index.html` rewrite, `PORT=20125`, `BASE_PATH=/`) |
| Tests | None |
| Shipped build output | `artifacts/operandi/dist/public` and partial `node_modules` were included in the ZIP (excluded from the working copy) |

`replit.md` (template notes) describes the intended stack: Express 5, PostgreSQL + Drizzle ORM, Zod (`zod/v4`), Orval codegen, esbuild bundling. None of that server code existed in the ZIP.

## 2. Frontend (`artifacts/operandi`)

- React 19 + TypeScript + Vite 7 + Tailwind CSS 4 (`@tailwindcss/vite`), Wouter routing, TanStack Query provider (no queries used), shadcn/Radix UI primitives in `src/components/ui`, Lucide icons, Framer Motion (installed, unused in pages).
- `vite.config.ts` **requires** `PORT` and `BASE_PATH` env vars; MDX via `@mdx-js/rollup`.
- Routes (`src/App.tsx`): `/`, `/products`, `/services`, `/process`, `/about`, `/contact`, `/privacy`, `/terms`, `/cookies`, and six case studies `/products/{the-bread,weship,denexus,airhouse,elegant-customise,route-planner}`; catch-all NotFound.
- Content: `src/content/products.ts` (static summary list, `featured` flag) and `src/content/products/*.mdx` (frontmatter-like `meta` export + long-form body using `<Screen>`, `<Detail>`, `<Stack>`).
- Scheduling: Cal.com embed (`@calcom/embed-react`), link `ashleybaloyi/30-minute-consultation`.
- Consent: `ConsentProvider` (localStorage `operandi.consent.v1`), `ConsentBanner`, `TagManager` loading GA4 / Google Ads / Meta Pixel / LinkedIn only after consent, IDs from `VITE_*` env vars.
- Design tokens (`src/index.css`): paper `#FAFAF7`, ink `#0F1115`, muted `#5B6271`, faint `#9AA0AC`, rule `#E5E7EB`, accent `#3A2E1F`; Inter (sans) + Fraunces (serif).
- Visible brand string: "Operandi" (the business trades as **Operandis**, operandis.co.za).

## 3. API client (`lib/api-client-react`)

- `custom-fetch.ts`: robust fetch wrapper (`ApiError`, problem+json parsing, optional base URL and bearer token getter).
- `generated/api.ts`: Orval output for a single endpoint `GET /api/healthz` → `{ status }`.
- **No real API existed** — nothing in the workspace served `/api/*`.

## 4. Backend, data, auth, payments

None present: no server application, database schema, ORM migrations, authentication, payment integration, email, file storage or tests.

## 5. Baseline command results (before any change)

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | ✅ succeeds |
| `pnpm run typecheck` | ❌ `TS5083: Cannot read file lib/db/tsconfig.json` and `lib/api-zod/tsconfig.json` (dangling references) |
| `pnpm --filter @workspace/operandi run typecheck` | ❌ 6× `TS2307: Cannot find module '*.mdx'` (no MDX module declaration) |
| `PORT=5173 BASE_PATH=/ pnpm --filter @workspace/operandi run build` | ✅ succeeds (405 kB JS) |

These are **pre-existing** failures; they are fixed as part of the expansion (the missing packages are created, an MDX type declaration is added).

## 6. Known gaps against the target specification

Everything in spec §§5–9 that needs a server: package catalogue and checkout, configurator persistence and estimates, CRM, proposals, orders, invoices, payments, client portal, admin console, notifications, audit, file storage, role-based access. The public site was entirely static and the only conversion path was a Cal.com booking.

## 7. Decisions taken from this audit

1. Keep React/Vite/Wouter/Tailwind and the visual identity; extend routes.
2. Re-create the backend the workspace was scaffolded for: **Express 5 + Drizzle ORM + PostgreSQL + Zod (`zod/v4`)**, as a modular monolith in `artifacts/api-server`.
3. Create the referenced `lib/db` and `lib/api-zod` packages (fixes the baseline typecheck), plus `lib/domain` for pure, unit-tested business logic (money, pricing, state machines, permissions).
4. Generate OpenAPI from the same Zod contracts used for runtime validation (no hand-maintained duplicate spec).
5. Preserve the six MDX case studies as long-form bodies; portfolio metadata moves to the database so it is admin-managed.
