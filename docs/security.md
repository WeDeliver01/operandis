# Security

Engineering guidance, not legal advice. POPIA and consumer-protection obligations need review by qualified counsel.

## Threat model (summary)

| Asset | Threats | Controls |
| --- | --- | --- |
| Client records (proposals, invoices, projects, files) | IDOR, enumeration | Org-membership check on every object (`assertOrgAccess`), 404 for foreign/missing records, UUID ids, verified-email requirement for portal data |
| Money & payment state | Forged/replayed webhooks, amount tampering, double processing | Signature verification, amount/currency reconciliation, unique event & transaction ids, row locks, server-side pricing |
| Staff console | Privilege escalation, credential stuffing | RBAC matrix, role-grant rules (`canAssignRole`), last-owner protection, session revocation on role change/disable, lockout, rate limits, optional mandatory staff MFA |
| Accounts | Takeover of guest-created accounts, session theft | Registration never sets a password on an existing account (sign-in link to the mailbox instead); HttpOnly SameSite=Lax Secure cookies; hashed session tokens; password change/reset revokes sessions |
| Browser | CSRF, XSS | Double-submit CSRF header on all writes; React escaping; CMS Markdown rendered without HTML; CSP when serving the SPA; email HTML escaped |
| Files | Malware/HTML disguised uploads, link sharing | Extension + magic-byte allow-list (no SVG/HTML), 15 MB limit, private storage, random object keys, 5-minute signed links, `Content-Disposition: attachment`, `nosniff` |
| Secrets | Leakage | Env-only, Zod-validated config (prod refuses weak `APP_SECRET`, log email driver, sandbox shortcuts); log redaction; audit snapshots scrub password/token/secret fields; MFA secrets AES-256-GCM encrypted |

## Access matrix

Permissions are defined in `lib/domain/src/permissions.ts` and enforced server-side on every route (`permission` in the route definition; staff routes additionally require staff role and, when configured, MFA).

| Capability | client | staff | finance | admin | owner |
| --- | :-: | :-: | :-: | :-: | :-: |
| Own portal records | ✓ | — | — | — | — |
| Console access, dashboard | | ✓ | ✓ | ✓ | ✓ |
| Leads (assigned) / briefs / proposals / projects (managed) / requests | | ✓ | | ✓ | ✓ |
| All leads, assign leads, all projects | | | (projects read) | ✓ | ✓ |
| Orders & invoices read | | ✓ | ✓ | ✓ | ✓ |
| Issue/void invoices, cancel orders | | | ✓ | ✓ | ✓ |
| Confirm EFT, refunds, payment logs | | | ✓ | ✓ | ✓ |
| Packages, portfolio & content CMS | | | | ✓ | ✓ |
| Edit pricing drafts | | | | ✓ | ✓ |
| **Approve production pricing** | | | | | ✓ |
| Deposit exceptions | | | | ✓ | ✓ |
| Users (client/staff/finance) | | | (read) | ✓ | ✓ |
| Grant admin/owner, tax & security settings | | | | | ✓ |
| Audit log, general settings, email log | | | | ✓ | ✓ |

Automated tests (`test/security.test.ts`, `test/auth.test.ts`) cover IDOR across every portal resource, internal-note/file hiding, staff lead scoping, escalation attempts, webhook spoofing/replay, upload validation, signed-link tampering/expiry, audit immutability, financial no-delete, CSRF, lockout and MFA.

## Authentication

- Local accounts: scrypt (N=2¹⁷, r=8, p=1) password hashing; ≥10 chars with letters and a digit; lockout for 15 min after 8 failures; constant-time comparisons; identical errors for unknown users.
- Passwordless magic links (30 min) and invites (7 days); email verification (48 h); password reset (1 h). All tokens are single-use, stored hashed.
- Sessions: 256-bit random token in `op_session` (HttpOnly, SameSite=Lax, Secure in production), stored as SHA-256, server-side expiry (configurable days) and revocation (“sign out everywhere”).
- TOTP MFA (RFC 6238) for any user; `security.requireStaffMfa` forces staff enrolment before console access.

## Rate limits (per IP, in-memory)

auth 20/15 min · password reset/magic link 6/h · contact & enquiries 5/10 min · configurator submissions 10/h · drafts 300/h · checkout 20/h · uploads 60/h · webhooks 300/min · analytics 120/min · general 600/min. Use a shared store (e.g. Redis) when running more than one instance.

Spam controls: honeypot fields on public forms, consent required, deduplicated leads.

## Privacy & consent

- Non-essential tags (GA4, Google Ads, Meta, LinkedIn) load only after consent; withdrawal sends Google consent-mode “denied”, removes tracking cookies and the first-party anonymous id.
- First-party funnel events from the browser are sent only after analytics consent; server-side business events (payments, acceptance) are operational records.
- Consent for processing and optional marketing consent are captured on configurator/contact/enquiry forms and stored on the lead.
- Data subject requests: currently handled manually via the legal email (owner decision: retention schedule and deletion procedure — see `owner-decisions.md`). Financial records are retained (not hard-deleted) for statutory purposes.

## Operational controls

- Separate dev/staging/production databases and credentials (`.env` is git-ignored; `.env.example` holds safe values only).
- Structured JSON logs with request ids; secrets redacted.
- Audit log: auth events, role changes, pricing changes, proposal send/accept/decline, payments, refunds, voids, deposit exceptions, settings changes, file events.
- pnpm `minimumReleaseAge: 1440` supply-chain guard retained.

## Known residual risks / follow-ups

- Rate limiting is per process; add a shared store before scaling horizontally.
- No malware scanning of uploads (types are restricted; add ClamAV or a storage-provider scanner if clients upload third-party files).
- Registration reveals whether an email has a password-protected account only indirectly (both paths respond; one signs in) — acceptable trade-off, rate-limited.
- Error monitoring (e.g. Sentry) is not wired; logs are structured for ingestion.
