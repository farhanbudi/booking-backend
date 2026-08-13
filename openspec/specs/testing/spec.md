# testing Specification

## Purpose

Automated test suite for the booking backend that verifies auth, resource, and booking
behavior, and proves the double-booking race-condition protection works.

## Requirements

### Requirement: Test runner and script
The project SHALL provide automated tests runnable with a single command, using a
build-in test runner so no extra runtime dependency is added.

#### Scenario: Run all tests
- **WHEN** developer runs `bun run test`
- **THEN** all tests execute and the command exits non-zero if any test fails

### Requirement: Auth service tests
The test suite SHALL verify registration, login, and profile behavior of the auth service.

#### Scenario: Register a new user succeeds
- **WHEN** registering with a new unique email and password of at least 8 characters
- **THEN** a user is created and returned without exposing the password hash

#### Scenario: Register duplicate email is rejected
- **WHEN** registering with an email that already exists
- **THEN** a conflict error is raised

#### Scenario: Login with valid credentials succeeds
- **WHEN** logging in with the correct email and password
- **THEN** the user is returned

#### Scenario: Login with wrong password is rejected
- **WHEN** logging in with a wrong password
- **THEN** an unauthorized error is raised

### Requirement: Resource service tests
The test suite SHALL verify resource listing, filtering, and admin CRUD behavior.

#### Scenario: List active resources
- **WHEN** listing resources without filters
- **THEN** only active resources are returned

#### Scenario: Filter resources by minimum capacity
- **WHEN** listing resources with a minimum capacity
- **THEN** only active resources with capacity equal or greater are returned

#### Scenario: Get a missing resource raises not-found
- **WHEN** requesting a resource id that does not exist
- **THEN** a not-found error is raised

### Requirement: Booking service tests
The test suite SHALL verify availability checks, booking creation, listing, and cancellation.

#### Scenario: Availability returns overlapping active bookings
- **WHEN** requesting availability for a resource and date that has active bookings
- **THEN** the overlapping time ranges are returned and cancelled bookings are excluded

#### Scenario: Create booking with end before start is rejected
- **WHEN** creating a booking whose endTime is not after startTime
- **THEN** a conflict error is raised

#### Scenario: Create booking on an occupied slot is rejected
- **WHEN** creating a booking overlapping an existing active booking on the same resource
- **THEN** a conflict error is raised

#### Scenario: Create booking on a free slot succeeds
- **WHEN** creating a booking that does not overlap any active booking
- **THEN** a confirmed booking is returned

#### Scenario: Cancel a booking the user does not own is forbidden
- **WHEN** a non-admin user cancels a booking owned by another user
- **THEN** a forbidden error is raised

### Requirement: API integration tests
The test suite SHALL exercise the HTTP API, including authentication and role guards.

#### Scenario: Unauthenticated request is rejected
- **WHEN** calling a protected endpoint without a bearer token
- **THEN** an unauthorized response is returned

#### Scenario: Non-admin is forbidden from admin endpoints
- **WHEN** a non-admin user calls an admin-only endpoint, such as creating a resource
- **THEN** a forbidden response is returned

#### Scenario: Admin can access admin endpoints
- **WHEN** an admin user calls an admin-only endpoint with a valid token
- **THEN** the operation succeeds

#### Scenario: Input validation is enforced
- **WHEN** sending an invalid payload, such as a short password or non-date time string
- **THEN** a validation error response is returned

### Requirement: Concurrency tests for double-booking protection
The test suite SHALL verify that two simultaneous overlapping booking requests on the same
resource cannot both succeed, validating both the application-level lock and the database
exclusion constraint.

#### Scenario: Concurrent overlapping bookings conflict
- **WHEN** two booking requests for the same resource with overlapping times are fired concurrently
- **THEN** at most one succeeds and each failure raises a conflict error

#### Scenario: Concurrent non-overlapping bookings both succeed
- **WHEN** two booking requests for the same resource with non-overlapping times are fired concurrently
- **THEN** both succeed

### Requirement: Test isolation and clean state
The test suite SHALL run against a database whose schema includes the exclusion constraint,
and each test run SHALL start from a known, clean state so tests are repeatable and
independent.

#### Scenario: Tests reset database state
- **WHEN** the test suite starts
- **THEN** tables are truncated and reseeded to a deterministic baseline

#### Scenario: Exclusion constraint is present
- **WHEN** integration or concurrency tests run
- **THEN** the `no_overlapping_bookings` exclusion constraint is applied on the bookings table
