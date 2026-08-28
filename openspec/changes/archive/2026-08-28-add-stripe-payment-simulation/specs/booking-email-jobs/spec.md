# booking-email-jobs (delta)

## MODIFIED Requirements

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
