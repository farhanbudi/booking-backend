## Why

The project's core value proposition is preventing double-booking under concurrent requests (race condition),
but it has zero automated tests. There is no test framework, no test script, and no test database setup,
so the two-layer protection (transaction lock + exclusion constraint) is completely unverified.

## What Changes

- Add a test runner (Bun's built-in `bun:test`) and `test` npm script.
- Add a test database strategy so tests run against a real PostgreSQL with the exclusion constraint applied.
- Add unit tests for service-layer error behavior (auth, resources, bookings).
- Add API/integration tests covering every endpoint, auth flows, and role guards.
- Add concurrency tests that prove two simultaneous overlapping bookings cannot both succeed (race condition).
- Add test infrastructure files (test setup, fixtures/helpers) and documentation on running tests.

## Capabilities

### New Capabilities
- `testing`: Automated test suite for the booking backend, covering unit, integration,
  and concurrency behavior, including verification of the double-booking protection.

### Modified Capabilities
- None

## Impact

- Code: new `tests/` directory, new `package.json` scripts, no production code changes.
- Dependencies: no new runtime dependencies; Bun built-in test runner only.
- DBS: requires a PostgreSQL database (local or Testcontainers) for integration tests;
  exclusion constraint must be applied for concurrency tests to validate layer 2.
- Docs: README section on how to run tests.