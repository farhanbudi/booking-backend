# Tasks: add-stripe-payment-simulation

## 1. Schema & setup

- [x] 1.1 Add `stripe` dependency (`bun add stripe`) and new env vars to `.env.example`: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PAYMENT_CURRENCY=idr`, `PAYMENT_EXPIRY_MINUTES=15`, `PAYMENT_SUCCESS_URL`, `PAYMENT_CANCEL_URL`
- [x] 1.2 Extend `src/db/schema.ts`: nullable `pricePerHour` integer on `resources`; `payments` table (`bookingId` FK, `stripeSessionId` unique, `amount` bigint, `currency` varchar(3), `status` enum `open/completed/expired`, `createdAt`)
- [x] 1.3 Run `bun run db:generate` + `bun run db:migrate`; verify exclusion constraint still applies to `pending` bookings (no constraint change expected)

## 2. Stripe port & config

- [x] 2.1 Create thin Stripe wrapper module (`src/modules/payments/stripe.port.ts` or similar): lazy client construction from `STRIPE_SECRET_KEY`, functions `createCheckoutSession(...)` and `constructWebhookEvent(rawBody, signature)`; Indonesian-language `AppError` when key missing at first paid use
- [x] 2.2 Add config helpers for currency, expiry TTL, success/cancel URLs; webhook secret absent → webhook route responds 503; warn at startup if live-mode key detected in production

## 3. Payment core logic (`src/modules/payments/`)

- [x] 3.1 Amount calculation: `pricePerHour × ceil(durationMinutes / 60)`, zero-decimal passthrough for `idr`, minor-unit conversion point for non-zero-decimal configured currencies (unit-tested pure function)
- [x] 3.2 Implement `createPendingPayment(booking, resource)`: build Checkout Session (metadata carries bookingId, `client_reference_id` set), persist `payments` row, return `{ checkoutUrl, expiresAt }`
- [x] 3.3 Implement single-transition gate: conditional `UPDATE bookings SET status=$next WHERE id=$id AND status='pending' RETURNING id`; zero rows ⇒ logged no-op side-effect skip
- [x] 3.4 Implement `handleCheckoutCompleted(session)` and `handleCheckoutExpired(session)` on top of the gate (completed → confirmed + enqueue confirmation email/schedule reminder via producers; expired → cancelled; unknown booking reference → log + ack)

## 4. Booking flow integration

- [x] 4.1 Branch `createBooking` on `resources.pricePerHour`: free → existing behavior untouched; priced → insert `pending`, call `createPendingPayment`, respond `{ booking, payment }`; if Checkout creation fails, delete the pending row and return informative error
- [x] 4.2 `cancelBooking`: additionally remove scheduled expiry job for the booking
- [x] 4.3 Owner-only retry endpoint returning a fresh checkout URL for a pending booking: 403 non-owner, 409 not pending, reuses latest `payments` attempt or creates a new one

## 5. Expiry background job

- [x] 5.1 Producers: `scheduleExpiry(bookingId, ttlMs)` with deterministic jobId `expire-{bookingId}` added as delayed job to the existing queue; `removeExpiry(bookingId)`
- [x] 5.2 Processor: extend `job.name` dispatch with `expire-payment` branch running the conditional cancel; no email enqueued on expiry

## 6. Webhook route

- [x] 6.1 Mount public unauthenticated `POST /payments/webhook` reading the **raw request body**, verifying signature before JSON parse, dispatching completed/expired, acking other event types as 2xx no-ops

## 7. Email timing shift (paid vs free)

- [x] 7.1 In the paid path ensure confirmation email + reminder are enqueued only from `handleCheckoutCompleted` (respecting the <1h no-reminder rule); verify free path still enqueues at creation and `cancelBooking` still sends cancellation email but expiry does not

## 8. Unit tests (`tests/unit/`, mocked Stripe port, no network)

- [x] 8.1 Amount math: whole hours, fractional-hour ceiling, zero-decimal IDR, non-zero-decimal conversion
- [x] 8.2 Webhook handling: valid completion confirms pending booking and enqueues exactly one confirmation; duplicate delivery is a no-op; completion after cancellation is a no-op; expiration cancels; unknown booking logs without error
- [x] 8.3 Signature verification failure rejects without state change; unset webhook secret yields 503
- [x] 8.4 Expiry: stale pending auto-cancelled with no email job; paid-before-TTL booking stays confirmed; late-firing job on confirmed booking is a no-op
- [x] 8.5 Service branching: free resource → instantly confirmed, no payment artifacts; priced resource → pending + checkoutUrl; checkout failure leaves no orphan pending booking; retry endpoint ownership/conflict rules
- [x] 8.6 Run full suite `bun test`

## 9. Docs & validation

- [x] 9.1 README: payment section (env vars, Docker Redis unchanged, `stripe listen --forward-to localhost:3000/payments/webhook` for local dev, test card `4242 4242 4242 4242`)
- [x] 9.2 Run `bunx tsc --noEmit` and `openspec validate --change add-stripe-payment-simulation`
