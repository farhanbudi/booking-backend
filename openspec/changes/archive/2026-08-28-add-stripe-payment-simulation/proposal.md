# Proposal: add-stripe-payment-simulation

## Why

The booking API currently only supports free reservations, so the project cannot demonstrate an end-to-end payment lifecycle (checkout handoff, webhook-driven state transitions, slot holds while awaiting payment, expiry handling). Adding a Stripe **test mode** simulation gives paid resources a realistic pay-before-confirm flow using test cards, with zero real money involved.

## What Changes

- **Resource pricing**: new nullable `pricePerHour` column on `resources`. `NULL` (or 0) keeps today's free flow untouched (instantly `confirmed`, emails at create time).
- **Paid booking flow**: creating a booking on a priced resource now produces a `pending` booking plus a Stripe Checkout Session (test mode); the API returns a `checkoutUrl`. The pending booking holds its slot through the existing `no_overlapping_bookings` exclusion constraint.
- **Webhook-driven confirmation**: a public `POST /payments/webhook` endpoint verifies the Stripe signature and handles `checkout.session.completed` (→ booking becomes `confirmed`) and `checkout.session.expired`.
- **Auto-expiry of unpaid holds**: a delayed BullMQ job cancels bookings that remain `pending` past a configurable TTL (default 15 minutes), freeing the slot. Expiry sends no email.
- **Email timing shift for paid bookings**: the confirmation email and reminder for a *paid* booking are enqueued on payment success (webhook), not at booking creation. Free-resource behavior is unchanged.
- **Payment retry**: owner can re-fetch the checkout URL for their own still-pending booking instead of losing the hold.
- New dependency: official `stripe` SDK. New env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_CURRENCY` (default `idr`), `PAYMENT_EXPIRY_MINUTES` (default 15).

No breaking change for existing clients: free-resource responses keep their current shape; paid bookings only add fields.

## Capabilities

### New Capabilities

- `booking-payments`: Stripe test-mode payment simulation for paid bookings — pricing model, pending-payment booking lifecycle (hold → confirm/expiry), Checkout Session creation and retry, webhook processing with signature verification and idempotency, amount calculation, and auto-expiry of unpaid holds.

### Modified Capabilities

- `booking-email-jobs`: the "Confirmation email on booking creation" and "Reminder email one hour before start" requirements now scope their trigger to *free* bookings; paid bookings enqueue these emails upon successful payment instead of at creation.

## Impact

- **Code**: `src/db/schema.ts` (+ migration: `resources.pricePerHour`, payment columns/table on bookings side); new `src/modules/payments/` (service, Stripe client, webhook handler); `src/modules/bookings/bookings.service.ts` (branching free vs paid, pending status, expiry job scheduling); `src/routes/` (webhook route mounted without auth; optional payment retry endpoint); `src/jobs/` (new expire job name/producer/processor branch); `src/mailer/templates.ts` (optional payment-received wording stays out of scope — reuse confirmation template).
- **API surface**: `POST /bookings` response gains payment payload for priced resources; new public webhook endpoint; new owner-facing endpoint to retrieve/recreate the checkout URL for a pending booking.
- **Infra/config**: Redis + BullMQ reused from `booking-email-jobs`; no new infrastructure besides Stripe test keys in `.env`.
- **Tests**: unit tests with a mocked Stripe client (no network): amount math, webhook event handling (completed/expired/duplicate/idempotent), expiry processor, free-vs-paid branching, signature verification failure path.
