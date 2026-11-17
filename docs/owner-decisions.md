# Owner decisions and external dependencies

Everything below is built and configurable; these items need a business, legal or credential input before going live. Nothing here blocks local development or staging.

| # | Decision / input | Where it plugs in | Current placeholder |
| --- | --- | --- | --- |
| 1 | **Rate card** — approve configurator coefficients | Console → Pricing rules → new version → owner approves | Demo rules (flagged "demonstration pricing"); `pnpm db:seed` leaves them as draft |
| 2 | **Package prices, inclusions, exclusions, delivery windows, add-on rates** | Console → Packages | Seeded as drafts with placeholder prices (demo seed publishes them) |
| 3 | **Discovery offer** — free intro call vs paid discovery, fee, outputs, terms | Package `discovery-sprint` + `discovery` block in pricing rules | Placeholder R7 500, full payment |
| 4 | **Deposit policy & milestone schedule** | Per package (deposit rule), pricing rules (`deposit`, `milestoneSchedule`), Settings → Commerce default | 50% deposit; 50/30/20 schedule |
| 5 | **Payment provider** — PayFast, Yoco or both; merchant credentials; webhook registration | Env secrets + Settings → Commerce | PayFast public sandbox in `.env.example`; EFT enabled in demo |
| 6 | **EFT bank details** | Settings → Commerce | "DEMO BANK" placeholder in demo seed only |
| 7 | **VAT status & invoice treatment** (accountant) | Settings → Tax (owner-only; requires explicit confirmation) | Off |
| 8 | **Legal review**: Terms (packages, proposals, refunds, IP, warranty, support), Privacy (POPIA, retention periods, data-subject request process, operators/cross-border), Cookie notice | `pages/Terms.tsx`, `Privacy.tsx`, `Cookies.tsx`; Settings → Commerce terms version & summaries | Engineering draft updated 17 Nov 2026 — **must be reviewed by counsel** |
| 9 | **Brand & contact details** — trading/legal name, registration number, contact emails on the operandis.co.za domain, phone, LinkedIn | Settings → Business | Original site values (`hello@operandi.studio`, Pretoria address) with trading name "Operandis" |
| 10 | **Transactional email provider & verified sending domain** (SPF/DKIM/DMARC) | `EMAIL_DRIVER=smtp`, `SMTP_*`, `EMAIL_FROM` | Log driver (dev) |
| 11 | **Hosting**: production host, managed Postgres, object storage, backup destination, RPO/RTO | `docs/deployment.md` | — |
| 12 | **Initial admin users & MFA policy** | `create-admin`; Settings → Security (`requireStaffMfa`) | MFA optional |
| 13 | **Canonical domain & redirects** (operandis.co.za vs www, legacy operandi.studio) | Proxy/DNS; `PUBLIC_WEB_URL` | — |
| 14 | **Cal.com booking link** | Settings → Business (`calLink`)  | `ashleybaloyi/30-minute-consultation` (now read from settings by the booking button and contact page) |
| 15 | **Data retention schedule** (leads, drafts, files, logs) | Not yet automated beyond 30-day draft expiry | — |

Portfolio content was preserved exactly; any new claims (outcomes, testimonials) should only be added once verified.
