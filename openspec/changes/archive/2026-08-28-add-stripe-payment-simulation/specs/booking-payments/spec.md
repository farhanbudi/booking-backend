# booking-payments (delta)

## Purpose

Menambahkan simulasi pembayaran Stripe (test mode) untuk booking berbayar: resource dengan harga memicu alur bayar-dulu-baru-konfirmasi melalui Stripe Checkout, dengan slot tetap terkunci selama menunggu pembayaran dan kadaluarsa otomatis bila tidak dibayar.

## ADDED Requirements

### Requirement: Resource pricing determines the booking flow

The system SHALL support an optional hourly price on each resource. Creating a booking on a resource without a price (or with price 0) SHALL preserve the existing immediate-confirmation flow; creating a booking on a priced resource SHALL require payment before the booking becomes confirmed.

#### Scenario: Priced resource triggers the payment flow

- **WHEN** a user creates a booking on a resource whose hourly price is greater than 0
- **THEN** the booking is created in a pending-for-payment state instead of being immediately confirmed, and the response includes everything needed to pay

#### Scenario: Unpriced resource keeps instant confirmation

- **WHEN** a user creates a booking on a resource without a price
- **THEN** the booking behaves exactly as before this capability existed: it is immediately confirmed and no payment artifact is produced

### Requirement: Pending payment holds the time slot

A booking awaiting payment SHALL occupy its requested time slot: overlapping bookings on the same resource SHALL be rejected while the pending booking exists, and the slot SHALL become available again once the pending booking is cancelled (manually or by expiry).

#### Scenario: Pending booking blocks overlapping bookings

- **WHEN** another booking is attempted for the same resource and overlapping time range while a payment-pending booking exists
- **THEN** the second booking is rejected with a conflict response

#### Scenario: Freed slot after expiry

- **WHEN** a payment-pending booking has been cancelled due to non-payment
- **THEN** the same time slot can be booked again successfully

### Requirement: Booking creation on a priced resource returns a checkout URL

When a booking is created on a priced resource, the system SHALL create a Stripe Checkout Session (test mode) whose amount equals the resource's hourly price multiplied by the booked duration (partial hours rounded up), in the configured currency, linked to the booking via metadata, and the create response SHALL include the session's hosted checkout URL alongside the pending booking.

#### Scenario: Create booking on priced resource returns checkout URL

- **WHEN** a booking is created on a resource priced above 0
- **THEN** the response contains the pending booking and a valid Stripe Checkout URL for the computed amount

#### Scenario: Amount reflects duration and hourly price

- **WHEN** a booking spans a duration that is not a whole number of hours on a resource with an hourly price
- **THEN** the checkout amount equals the hourly price times the duration rounded up to whole hours

#### Scenario: Checkout creation failure fails the request cleanly

- **WHEN** the checkout session cannot be created (e.g., Stripe unreachable or credentials invalid)
- **THEN** the booking is not left behind in pending state and the client receives an informative error response

### Requirement: Owner can retrieve a fresh checkout URL

The booking owner SHALL be able to request a current checkout URL for their own payment-pending booking (e.g., after losing the original link). The system SHALL return a usable checkout URL for that booking's outstanding amount.

#### Scenario: Owner retries payment

- **WHEN** the owner of a payment-pending booking requests its checkout URL
- **THEN** a working checkout URL for the same booking and amount is returned

#### Scenario: Non-owner cannot retrieve the checkout URL

- **WHEN** a user who does not own the booking requests its checkout URL
- **THEN** the request is rejected with a forbidden response

#### Scenario: Checkout URL unavailable for non-pending bookings

- **WHEN** a checkout URL is requested for a booking that is not awaiting payment
- **THEN** the request is rejected with a conflict response

### Requirement: Webhook confirms successful payment

The system SHALL expose a publicly reachable webhook endpoint that verifies the Stripe signature before processing. Upon receiving a valid checkout completion event whose session matches a payment-pending booking, the system SHALL transition that booking to confirmed.

#### Scenario: Valid completion event confirms the booking

- **WHEN** a correctly signed checkout completion event arrives for a payment-pending booking
- **THEN** the booking becomes confirmed and subsequent reads show it as a normal active booking

#### Scenario: Invalid signature is rejected

- **WHEN** the webhook receives a request whose Stripe signature does not verify against the configured secret
- **THEN** the request is rejected without any state change

#### Scenario: Unknown booking reference is ignored safely

- **WHEN** a validly signed completion event references a booking that does not exist
- **THEN** the webhook responds successfully and only logs the mismatch, changing nothing

### Requirement: Webhook processing is idempotent

Processing a payment event SHALL be safe to repeat: a booking may transition from pending to confirmed at most once, and repeated or racing events SHALL NOT produce duplicate side effects such as extra confirmation emails or errors.

#### Scenario: Duplicate completion events cause a single transition

- **WHEN** the same checkout completion event (or an equivalent retry of it) is delivered more than once
- **THEN** the first delivery transitions the booking to confirmed with its associated notifications, and subsequent deliveries change nothing

#### Scenario: Event for a no-longer-pending booking is a no-op

- **WHEN** a completion event arrives for a booking that has already been cancelled (e.g., by expiry)
- **THEN** the booking remains cancelled and no notification is sent

### Requirement: Expired checkout sessions cancel the booking

Upon receiving a valid checkout expiration event for a payment-pending booking, the system SHALL cancel that booking.

#### Scenario: Expiration event cancels the pending booking

- **WHEN** a correctly signed checkout expiration event arrives for a payment-pending booking
- **THEN** the booking becomes cancelled and its slot is released

### Requirement: Unpaid pending bookings expire automatically

A booking that remains pending for payment longer than a configured TTL SHALL be cancelled automatically without requiring any external event. Automatic expiry SHALL NOT send any email notification.

#### Scenario: Stale pending booking is auto-cancelled

- **WHEN** a booking has remained pending for payment beyond the configured TTL
- **THEN** the system cancels it automatically and its slot becomes bookable again

#### Scenario: Timely payment prevents expiry

- **WHEN** payment for a pending booking completes before the TTL elapses
- **THEN** the booking remains confirmed and is never auto-cancelled afterwards

#### Scenario: No email on automatic expiry

- **WHEN** a pending booking is auto-cancelled due to non-payment
- **THEN** no cancellation or other email is enqueued for that booking

### Requirement: Test-mode-only simulation

All payment operations SHALL run against Stripe's test mode using test credentials; the capability MUST NOT perform live charges.

#### Scenario: Simulation uses test credentials only

- **WHEN** the application creates checkout sessions or processes webhook events
- **THEN** only Stripe test-mode keys are used and no real payment can be captured
