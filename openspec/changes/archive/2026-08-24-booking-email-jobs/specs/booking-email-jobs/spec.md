## Purpose

Mengirim email konfirmasi, pembatalan, dan reminder booking secara asinkron melalui background job berbasis queue, sehingga pengiriman email tidak pernah memperlambat atau menggagalkan respons API dan tetap terkirim meski sempat gagal.

## ADDED Requirements

### Requirement: Confirmation email on booking creation

The system SHALL enqueue a confirmation email whenever a booking is successfully created, addressed to the booking owner's registered email address, containing at least the resource name and the booking's start and end time.

#### Scenario: Confirmation email is enqueued

- **WHEN** a booking creation succeeds (HTTP 201)
- **THEN** a confirmation email job is queued for delivery to the booking owner's email with the resource name and the booking's start/end time included

#### Scenario: Queuing failure does not fail the request

- **WHEN** the confirmation email cannot be queued (e.g., queue infrastructure unavailable)
- **THEN** the booking creation response remains HTTP 201 and the failure is recorded in server logs only

### Requirement: Cancellation email on booking cancellation

The system SHALL enqueue a cancellation email whenever a booking is successfully cancelled, addressed to the booking owner's registered email address, containing at least the resource name and the cancelled start and end time.

#### Scenario: Cancellation email is enqueued

- **WHEN** a booking cancellation succeeds
- **THEN** a cancellation email job is queued for delivery to the booking owner's email with the resource name and the cancelled time slot included

### Requirement: Reminder email one hour before start

The system SHALL schedule a reminder email for every newly created booking, to be delivered approximately one hour before the booking's `startTime` and addressed to the booking owner. A reminder SHALL be delivered only if the booking is still confirmed at delivery time.

#### Scenario: Reminder delivered before an active booking

- **WHEN** a confirmed booking's start time is approximately one hour away
- **THEN** the reminder email is delivered to the booking owner containing at least the resource name and the booking's start/end time

#### Scenario: No reminder for cancelled bookings

- **WHEN** a booking is cancelled before its reminder delivery time
- **THEN** no reminder email is sent for that booking

#### Scenario: No past-due reminder for last-minute bookings

- **WHEN** a booking is created with a start time less than one hour in the future
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
