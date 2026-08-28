# Design: add-stripe-payment-simulation

## Context

See proposal.md for motivation. Current state that shapes this design:

- `booking_status` enum already contains `"pending"` but nothing uses it (default is `"confirmed"`).
- The `no_overlapping_bookings` exclusion constraint applies to every booking whose status is not `'cancelled'` — so a pending booking automatically holds its slot, and cancelling frees it. **No constraint migration is needed.**
- Background-job infrastructure exists (`src/jobs/` BullMQ queue `booking-emails`, single Worker in `src/worker.ts` dispatching by `job.name`) and email processors already implement a stale-status guard (only send if booking still in expected state).

## Goals / Non-Goals

**Goals:**

- Pay-before-confirm lifecycle for priced resources using Stripe Checkout Session in test mode only.
- Single-transition guarantee (pending → confirmed) that is safe against duplicate/racing webhook events and the expiry job.
- Reuse existing queue/worker/email-processor patterns instead of adding new infrastructure.
- Unit-testable without network: Stripe calls hidden behind an injectable dependency, same pattern as `BookingEmailDeps`.

**Non-Goals:**

- Real money / live mode, refunds, invoices or receipts, payment-method management.
- Frontend checkout pages (hosted Stripe page is used; success/cancel URLs are configurable pointers).
- Multi-currency support beyond one configured currency.
- Storing card data of any kind (Checkout keeps PCI surface out of our backend).

## Decisions

### D1. Payment state: separate `payments` table, not columns on `bookings`

One row per Checkout Session attempt: `payments(id, booking_id FK, stripe_session_id unique, amount bigint, currency varchar(3), status enum('open','completed','expired'), created_at)`.

- *Why*: retries create a new session per attempt, so session identity does not belong on the booking row; keeping attempts as rows preserves history cheaply and leaves `bookings.status` as the single lifecycle source of truth.
- *Alternative rejected*: nullable `stripeSessionId` column on `bookings` — simpler but conflates "current attempt" with lifecycle and loses attempt history.
- Webhook lookup path: event → `stripe_session_id` (or `client_reference_id` = bookingId set as metadata) → payment row → booking. Latest payment row wins for retry lookups.

### D2. Amount calculation: whole-hour ceiling, zero-decimal currency

`amount = pricePerHour × ceil(durationMinutes / 60)` sent directly as the Checkout `unit_amount`. Default currency `idr`, which is zero-decimal in Stripe, so no minor-unit conversion. Currency overridable via `PAYMENT_CURRENCY`; if a non-zero-decimal currency is configured, amounts MUST be converted to minor units at creation time (single conversion point, tested).

### D3. Webhook endpoint: raw-body signature verification, unauthenticated

New `POST /payments/webhook` route mounted without auth middleware. Elysia must hand the handler the **raw request body text** because Stripe signatures are computed over raw bytes; parsing JSON first breaks verification. Flow: verify with `STRIPE_WEBHOOK_SECRET` via the SDK → dispatch on event type → respond 2xx quickly. Only two events handled: `checkout.session.completed`, `checkout.session.expired`; anything else acks 2xx as no-op.

- *Alternative rejected*: polling Checkout Session status on a timer — more moving parts and slower confirmation; webhooks are also required by Stripe best practice.

### D4. Exactly-once transition via conditional UPDATE

Every state-changing path (webhook completed, webhook expired, auto-expiry job) performs:

```
UPDATE bookings SET status = $next
WHERE id = $id AND status = 'pending' RETURNING id
```

Zero rows returned ⇒ someone else already transitioned it ⇒ skip all side effects (no second email, no double reminder). This one gate covers duplicate deliveries, the webhook/expiry race, and completion-after-expiry. The existing stale-status check in the email processor remains as defense-in-depth but is not the mechanism.

- *Alternative rejected*: distributed locks or checking-then-setting in application code — racy under concurrent delivery.

### D5. Auto-expiry reuses the existing queue with job-name dispatch

Expiry is a delayed job added to the existing `booking-emails` queue with a deterministic id `expire-{bookingId}` and delay = TTL. The processor's `job.name` switch gains an `expire-payment` branch that runs the conditional cancel (D4). On successful payment the job is removed by its deterministic id (same mechanism as `removeReminder`).

- *Why*: the worker already dispatches purely by `job.name`; adding a second queue would force a second `Worker` in `src/worker.ts` for no behavioral gain.
- *Accepted trade-off*: the queue name becomes semantically broader than "emails"; renaming it would orphan existing Redis jobs and is not worth it — documented here instead.
- If a delayed job fires late (clock/Redis lag), the conditional update makes it harmless.

### D6. Branching free vs paid lives in `createBooking`

`bookings.service.createBooking`: after the overlap check, read `resources.pricePerHour`. Free → current path verbatim (insert confirmed, enqueue confirmation + reminder). Paid → insert `pending`, compute amount (D2), create Checkout Session through the injected Stripe port, persist a `payments` row, schedule the expiry job, return `{ booking, payment: { checkoutUrl, expiresAt } }`. `cancelBooking` additionally removes any scheduled expire job. Confirmation-email and reminder producers move behind the payment-success path for paid bookings (see booking-email-jobs delta).

### D7. Stripe access via an injectable port

A thin module wraps the `stripe` SDK (create session, construct event). Services receive it through a deps object defaulting to the real implementation — mirroring `BookingEmailDeps` — so unit tests mock it and never touch network. The SDK is constructed lazily from `STRIPE_SECRET_KEY`; missing key raises an Indonesian-language `AppError` (500) only when a paid flow actually executes, keeping free-resource flows and tests runnable without Stripe config. Webhook route returns 503 when `STRIPE_WEBHOOK_SECRET` is unset.

### D8. Configuration additions

`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_CURRENCY=idr`, `PAYMENT_EXPIRY_MINUTES=15`, `PAYMENT_SUCCESS_URL`, `PAYMENT_CANCEL_URL` (success/cancel defaulted to frontend base URL placeholders; recorded assumption — exact landing pages belong to the frontend project).

## Risks / Trade-offs

- [Webhook races the expiry job] → single-gate conditional UPDATE (D4); loser of the race is a logged no-op.
- [Local dev has no public URL for webhooks] → TTL expiry doubles as fallback so flows remain testable; document `stripe listen` for local forwarding; retry endpoint lets users recover.
- [Raw-body requirement trips up framework JSON parsing] → webhook route reads raw text before parse; unit test crafts payload + valid signature to lock the contract.
- [Duplicate confirmation emails] → D4 gate plus processor stale-check; both layers independently prevent it.
- [Queue semantics broaden beyond emails] → accepted, documented in D5; no runtime impact.
- [Test-mode keys leak into prod config] → startup warning if key doesn't start with `sk_test_` when `NODE_ENV=production`.

## Migration Plan

1. `bun run db:generate` + `bun run db:migrate` (additive: `resources.price_per_hour`, `payments` table; exclusion constraint untouched).
2. Add new env vars to `.env`; restart API and worker together (worker gains the `expire-payment` branch).
3. Rollback: revert code; additive schema objects are inert for the old code path. No data backfill needed (existing bookings stay confirmed).

## Open Questions

None blocking. Landing-page URLs for checkout success/cancel are assumed configurable env pointers (D8) and owned by the frontend project.
