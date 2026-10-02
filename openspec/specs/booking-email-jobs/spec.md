# booking-email-jobs Specification

## Purpose

Mengirim email konfirmasi, pembatalan, dan reminder booking secara asinkron melalui background job berbasis queue, sehingga pengiriman email tidak pernah memperlambat atau menggagalkan respons API dan tetap terkirim meski sempat gagal.

## Requirements

### Requirement: Confirmation email on booking creation

For a booking created on an unpriced (free) resource, the system SHALL enqueue a confirmation email whenever the booking is successfully created, addressed to the booking owner's registered email address, containing at least the resource name and the booking's start and end time. For a booking created on a priced resource, no confirmation email SHALL be enqueued at creation; instead the confirmation email SHALL be enqueued when payment for that booking succeeds.

#### Scenario: Confirmation email is enqueued

- **WHEN** a booking creation succeeds on a resource without a price (HTTP 201)
- **THEN** a confirmation email job is queued for delivery to the booking owner's email with the resource name and the booking's start/end time included

#### Scenario: No confirmation email at creation for a paid booking

- **WHEN** a booking is created on a priced resource and enters the pending-for-payment state
- **THEN** no confirmation email job is queued at that moment

#### Scenario: Confirmation email is enqueued on successful payment

- **WHEN** payment for a pending booking succeeds (checkout completion accepted)
- **THEN** a confirmation email job is queued for delivery to the booking owner's email with the resource name and the booking's start/end time included

#### Scenario: Queuing failure does not fail the request

- **WHEN** the confirmation email cannot be queued (e.g., queue infrastructure unavailable) at booking creation or at payment acceptance
- **THEN** the booking creation response remains HTTP 201 and the payment transition still completes, with the queuing failure recorded in server logs only

### Requirement: Cancellation email on booking cancellation

The system SHALL enqueue a cancellation email whenever a booking is successfully cancelled, addressed to the booking owner's registered email address, containing at least the resource name and the cancelled start and end time.

#### Scenario: Cancellation email is enqueued

- **WHEN** a booking cancellation succeeds
- **THEN** a cancellation email job is queued for delivery to the booking owner's email with the resource name and the cancelled time slot included

### Requirement: Reminder email one hour before start

The system SHALL schedule a reminder email approximately one hour before a booking's `startTime`, addressed to the booking owner: for bookings on unpriced resources at creation time, and for bookings on priced resources upon successful payment. A reminder SHALL be delivered only if the booking is still confirmed at delivery time.

#### Scenario: Reminder delivered before an active booking

- **WHEN** a confirmed booking on an unpriced resource has a start time approximately one hour away
- **THEN** the reminder email is delivered to the booking owner containing at least the resource name and the booking's start/end time

#### Scenario: Reminder scheduled at payment success for a paid booking

- **WHEN** payment succeeds for a pending booking whose start time is more than one hour away
- **THEN** a reminder is scheduled for approximately one hour before the booking's start time

#### Scenario: Late-paid booking gets no past-due reminder

- **WHEN** payment succeeds for a pending booking whose start time is less than one hour away
- **THEN** no reminder is scheduled or sent for that booking

#### Scenario: No reminder for cancelled bookings

- **WHEN** a booking is cancelled (manually, or by payment expiry) before its reminder delivery time
- **THEN** no reminder email is sent for that booking

#### Scenario: No past-due reminder for last-minute bookings

- **WHEN** a booking on an unpriced resource is created with a start time less than one hour in the future
- **THEN** no reminder is scheduled or sent for that booking

### Requirement: Asynchronous out-of-band delivery

Email delivery MUST happen outside the HTTP request lifecycle: booking create and cancel endpoints MUST NOT wait for email transmission, and email delivery problems MUST NOT change those endpoints' success responses.

#### Scenario: Unreachable mail transport does not affect the API

- **WHEN** the mail transport is unreachable or slow while a booking is being created or cancelled
- **THEN** the corresponding endpoint still completes normally with its usual success response, without waiting for any email outcome

### Requirement: Automatic retry with bounded attempts

A failed email delivery SHALL be retried automatically with increasing delay between attempts, up to a maximum of 3 total attempts; after the final failure the job SHALL be discarded and its failure logged, with no further user-visible effect.

#### Scenario: Transient failure is retried

- **WHEN** an email delivery attempt fails transiently (e.g., temporary SMTP error)
- **THEN** the same email is retried automatically until it succeeds or the 3-attempt maximum is reached

#### Scenario: Final failure is contained

- **WHEN** all 3 delivery attempts for an email have failed
- **THEN** the failure is logged and the job is discarded, and no API error surfaces to any client

### Requirement: Environment-driven mail provider selection

The system SHALL select its outbound mail transport from a `MAIL_PROVIDER` environment setting with two supported values: `smtp` for development and `mailgun` for production. When `MAIL_PROVIDER` is unset, the system SHALL default to `smtp`, so existing local development configuration continues to work unchanged.

In `smtp` mode the transport MUST be configured from `SMTP_HOST` and `SMTP_PORT` (defaulting to `localhost` and `1025` respectively), authenticating only when both `SMTP_USER` and `SMTP_PASS` are provided.

In `mailgun` mode the transport MUST be configured entirely from the SMTP credentials issued by the provider: `MAILGUN_SMTP_HOST`, `MAILGUN_SMTP_PORT`, `MAILGUN_SMTP_LOGIN` as the username, and `MAILGUN_SMTP_PASSWORD` as the credential. All four settings MUST be present, and the worker MUST refuse to start when any is missing. `MAILGUN_SMTP_PASSWORD` MUST NOT be written to logs.

The mail transport's transport-security setting MUST be derived from the configured port rather than hardcoded, so that a TLS-required port is negotiated correctly while a plaintext development port is not.

#### Scenario: Unset provider falls back to the local SMTP transport

- **WHEN** the mail configuration is resolved with no `MAIL_PROVIDER` set
- **THEN** the local SMTP transport is selected, defaulting to host `localhost` on port `1025`, with no authentication

#### Scenario: Production selects the provider's issued SMTP endpoint

- **WHEN** the mail configuration is resolved with `MAIL_PROVIDER=mailgun` and all four `MAILGUN_SMTP_*` settings supplied
- **THEN** the transport targets the configured host and port, authenticated with the configured login and password, and the transport-security setting is enabled exactly when the port requires implicit TLS

#### Scenario: No authentication without a complete credential pair

- **WHEN** the mail configuration is resolved in `smtp` mode and only one of `SMTP_USER` or `SMTP_PASS` is provided
- **THEN** the transport is configured without authentication rather than with a half-filled credential

#### Scenario: Unknown provider value halts the worker

- **WHEN** `MAIL_PROVIDER` holds a value other than `smtp` or `mailgun`
- **THEN** the worker refuses to start, reports the unrecognized value, and exits with a non-zero status instead of falling back to any default provider

#### Scenario: Missing provider credential halts the worker

- **WHEN** `MAIL_PROVIDER=mailgun` and any of `MAILGUN_SMTP_HOST`, `MAILGUN_SMTP_PORT`, `MAILGUN_SMTP_LOGIN`, `MAILGUN_SMTP_PASSWORD` is absent or empty
- **THEN** the worker refuses to start, reports the missing settings, and exits with a non-zero status

#### Scenario: Malformed port halts the worker for the active provider only

- **WHEN** the mail configuration is resolved in `smtp` mode and `SMTP_PORT` is set to a non-numeric value
- **THEN** the worker refuses to start and reports that the port must be a number
- **AND WHEN** `MAILGUN_SMTP_PORT` is set to a non-numeric value in `mailgun` mode
- **THEN** the worker refuses to start and reports that the port must be a number
- **AND WHEN** the same non-numeric `SMTP_PORT` is present while `MAIL_PROVIDER=mailgun`
- **THEN** the worker starts normally, because that setting is not consulted in `mailgun` mode

#### Scenario: API-only run mode is unaffected by mail misconfiguration

- **WHEN** the process is started in API-only mode, which never sends email, with an invalid or incomplete mail configuration
- **THEN** the process starts and serves requests normally, since mail configuration is only validated by the worker

#### Scenario: Active provider is reported at worker startup

- **WHEN** the worker starts successfully
- **THEN** it logs which mail provider is active, so the effective configuration is visible in production logs without inspecting environment variables

### Requirement: Demo-mode email recipient restriction

When the system is running in `mailgun` mode, it SHALL deliver email only to the single recipient address configured in `DEMO_EMAIL`, and SHALL skip delivery for every other recipient. Skipped deliveries MUST be treated as successful outcomes: the job MUST NOT be retried and MUST NOT be recorded as a failure.

This restriction governs delivery only. Email jobs MUST still be enqueued and processed for all users in every mode, so queuing, booking-status checks, and template rendering are unaffected by the restriction.

`DEMO_EMAIL` SHALL be required when running in `mailgun` mode; its absence SHALL be treated as a configuration error.

Recipient matching against `DEMO_EMAIL` SHALL be case-insensitive and ignore surrounding whitespace, so that a stored address differing in letter case from the configured value still matches.

The restriction MUST NOT apply in `smtp` mode, where the development mail capture server has no delivery quota and every recipient is expected to receive mail.

#### Scenario: The configured demo recipient receives mail

- **WHEN** an email job for a booking owned by the address configured in `DEMO_EMAIL` is processed in `mailgun` mode
- **THEN** the email is delivered through the configured provider

#### Scenario: Other recipients are skipped

- **WHEN** an email job for a booking owned by any other address is processed in `mailgun` mode
- **THEN** no mail is transmitted for that recipient and the skip is recorded in worker logs

#### Scenario: A skipped delivery completes successfully

- **WHEN** an email job is skipped because its recipient is not the configured demo address
- **THEN** the job is reported as completed without being retried, and no failure is recorded against it

#### Scenario: Jobs are enqueued for every user regardless of the restriction

- **WHEN** a booking is created by an account whose address is not the configured demo address
- **THEN** an email job is still enqueued for that booking owner and is still processed by the worker, exactly as in the unrestricted mode

#### Scenario: Demo recipient matching ignores letter case

- **WHEN** the demo owner is stored with an address whose letter case differs from `DEMO_EMAIL`
- **THEN** the email is still delivered, rather than being skipped because of a case mismatch

#### Scenario: Missing demo address halts the worker

- **WHEN** `MAIL_PROVIDER=mailgun` and `DEMO_EMAIL` is absent or empty
- **THEN** the worker refuses to start, reports the missing setting, and exits with a non-zero status rather than delivering to every recipient or no recipient
