# Payments

Code: `artifacts/api-server/src/services/payments/*`, `services/payment-processing.ts`, `modules/commerce.ts` · Tests: `test/payments.test.ts`, `test/proposals.test.ts`, E2E `tests/e2e/journey.spec.ts`.

## Status today

| Provider | Implementation | Activation requirement |
| --- | --- | --- |
| **PayFast** | Hosted checkout (signed form POST) + ITN verification (signature, merchant id, optional source-IP check, server-to-server `/eng/query/validate`) | Merchant ID/key/passphrase in env; enable in Console → Settings → Commerce |
| **Yoco** | Checkout API (redirect) + Standard-Webhooks HMAC verification (3-minute tolerance) + refunds API | Secret key + webhook secret in env; register the webhook URL with Yoco; enable in settings |
| **Manual EFT** | Bank details shown with a unique reference; client uploads proof; **finance confirms** after funds clear | Bank details in settings; enable in settings |

No real money has been processed by this build. Tests exercise PayFast's **public sandbox merchant** (10000100) with locally signed ITNs and `PAYFAST_SKIP_REMOTE_VALIDATION=true` (rejected by config validation outside sandbox and in production). Never enable that flag in staging/production.

## Principles (spec §3.2, §7.2)

1. **Hosted checkout only** — card data never touches our servers.
2. **Redirects prove nothing** — the return page polls `GET /checkout/orders/:ref` whose status changes only through a verified provider event or a finance-confirmed EFT.
3. **Reconcile** amount (minor units) and currency against the payment attempt; mismatches are rejected and audited.
4. **Idempotent** at three levels:
   - `webhook_events (provider, event_id)` unique — duplicate deliveries are acknowledged with `status: duplicate`;
   - payment attempts are row-locked (`SELECT … FOR UPDATE`) while applying an event;
   - `payment_transactions (provider, provider_transaction_id)` unique — a transaction can only be applied once.
   Notifications use dedupe keys, so duplicates never re-email.
5. **Out-of-order safe** — a `FAILED/CANCELLED` notice after `COMPLETE` is ignored; a late verified success after a failure is accepted (state machine allows `failed → succeeded`).
6. **Retry-safe checkout** — `POST /checkout/sessions` takes an idempotency key (one per checkout page load); retries for an unpaid order create a new attempt and cancel the stale one, never a second order.

## Flow

```
POST /checkout/sessions ─► order (pending_payment, immutable snapshot) ─► payment_attempt (PAY-…)
        │                                                                   │
        └─► provider checkout (PayFast form / Yoco redirect / EFT details) ◄─┘
                         │
     PayFast ITN / Yoco webhook ─► POST /api/v1/webhooks/payments/:provider (raw body, no CSRF)
                         │ verify signature → record webhook_event → lock attempt → reconcile
                         ▼
     applySuccessfulPayment: transaction → order confirmed → paid invoice (receipt)
                             → project + milestones → lead won → notifications (outbox)
```

Invoice payments (deposits, milestones) use the same machinery with `purpose = invoice`: the invoice's paid amount/status is updated; paying a project's deposit invoice moves the project from `awaiting_deposit` to `not_started`.

Webhook responses: `200` for processed/duplicate/ignored/rejected-after-verification (so providers stop retrying), `400` for failed verification, `500` on internal errors (so providers retry).

## Refunds

`POST /admin/payments/:transactionId/refunds` (permission `payments.refund`, reason required, idempotency key):

1. lock the transaction, check `amount ≤ paid − refunded − pending refunds`, insert the refund (`pending`) and audit;
2. call the provider refund API when supported (Yoco); PayFast and EFT refunds are recorded as `manual_pending`;
3. on success (or when finance marks a manual refund paid out via `POST /admin/refunds/:id/complete`): update transaction/invoice refunded amounts and statuses, issue a **credit note**, update the order status (`partially_refunded`/`refunded`), notify the client, audit.

PayFast offers a refunds API for some merchant accounts; it is intentionally not automated here (manual-pending with an auditable payout reference) until the merchant confirms availability.

## EFT verification

Clients see bank details and the `PAY-…` reference; uploading proof moves the attempt to `pending_verification` and alerts staff. Finance confirms in the invoice/payments screens with the bank statement reference. The amount must match the expected amount exactly; the bank reference is the provider transaction id (`eft:<reference>`), so it cannot be recorded twice.

## Configuration checklist (production)

1. Choose the provider(s) with the business (spec §15): merchant eligibility, fees, settlement times, refund support.
2. Set credentials as server secrets (`PAYFAST_*` with `PAYFAST_MODE=live`, or `YOCO_*`). Never prefix with `VITE_`.
3. Set `PUBLIC_API_URL` to the public HTTPS origin providers can reach; for PayFast set `PAYFAST_VERIFY_SOURCE_IP=true` once DNS/IP checks are confirmed from the host.
4. For Yoco, register `https://<host>/api/v1/webhooks/payments/yoco` and store its signing secret.
5. Enable the provider(s) and default in Console → Settings → Commerce; fill EFT bank details.
6. Do a live low-value test purchase and refund; verify the webhook log (Console → Payments → Webhook log).
