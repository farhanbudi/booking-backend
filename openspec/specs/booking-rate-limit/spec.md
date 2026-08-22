## Purpose

Membatasi frekuensi pembuatan booking per kombinasi akun (JWT `sub`) dan alamat IP untuk mencegah spam serta pengiriman ganda (double-submit) dari frontend.

## Requirements

### Requirement: Rate limit on booking creation

The system SHALL reject requests to `POST /bookings` that exceed 10 requests within any rolling 60-second window, measured per combination of authenticated user (JWT `sub`) and client IP address.

#### Scenario: Requests within the limit are allowed

- **WHEN** an authenticated user (sub + IP) sends 10 or fewer `POST /bookings` requests within a 60-second window
- **THEN** each request is processed normally (status 201) and the response includes `X-RateLimit-Limit: 10` and `X-RateLimit-Remaining` reflecting the remaining quota for that key

#### Scenario: Requests over the limit are rejected

- **WHEN** the same user (sub + IP) sends an 11th `POST /bookings` request within the same 60-second window
- **THEN** the system returns HTTP `429 Too Many Requests` with an Indonesian error message and a `Retry-After` header indicating the number of seconds until the window resets

#### Scenario: Limit is scoped per user + IP, not global

- **WHEN** user A (sub + IP) has exhausted the limit but user B (different `sub`, or different IP) sends a request within the same window
- **THEN** user B's request is processed normally because the counter is keyed by the user + IP combination

#### Scenario: Window resets after 60 seconds

- **WHEN** more than 60 seconds have elapsed since the oldest counted request for a given user + IP key
- **THEN** a new request is allowed and the oldest entries no longer count toward the limit

### Requirement: Rate limit headers

The system SHALL include `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` headers on every `POST /bookings` response (whether allowed or throttled), and a `Retry-After` header on throttled (429) responses.

#### Scenario: Headers present on a normal response

- **WHEN** a `POST /bookings` request is within the limit
- **THEN** the response includes `X-RateLimit-Limit: 10`, `X-RateLimit-Remaining` (integer >= 0), and `X-RateLimit-Reset` (epoch seconds when the oldest entry expires)

#### Scenario: Retry-After on a throttled response

- **WHEN** a `POST /bookings` request is throttled (429)
- **THEN** the response includes a `Retry-After` header with the number of seconds until the oldest entry expires

### Requirement: Only POST /bookings is rate-limited

The rate limiting SHALL apply only to `POST /bookings` and MUST NOT affect other endpoints (such as `GET /bookings/availability`, `GET /bookings`, or `PATCH /bookings/:id/cancel`) or other HTTP methods.

#### Scenario: GET endpoints are not throttled

- **WHEN** a client makes many rapid `GET /bookings/availability` or `GET /bookings` requests
- **THEN** those requests are not subject to the booking-creation rate limit and are processed normally
