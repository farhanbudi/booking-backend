## Context

See proposal.md — Why. The backend is Bun + ElysiaJS + Drizzle + PostgreSQL with two-layer
double-booking protection (`bookings.service.ts` transaction + `FOR UPDATE`, and the
`no_overlapping_bookings` exclusion constraint in `manual_0001_exclusion_constraint.sql`).

Key constraints that shape the test design:
- Bun ships a built-in test runner (`bun:test`) — no new runtime test dependency needed.
- `src/db/client.ts` reads `process.env.DATABASE_URL` and opens a `postgres` connection at module load.
- `auth.middleware.ts` reads `process.env.JWT_SECRET` at app-build time.
- The exclusion constraint exists only as a manual SQL file; drizzle-kit migrations do not include it.
- Production code must not change — only addition of test infra and scripts.

## Goals / Non-Goals

**Goals:**
- Single command (`bun run test`) runs unit, API integration, and concurrency tests.
- Concurrency tests actually prove both layers: application-level lock and exclusion constraint.
- Tests are repeatable and independent via a clean database baseline per run.

**Non-Goals:**
- Changing production code to make it testable (no DI refactor of `db` client).
- Testcontainers/Docker-based DB provisioning.
- Frontend or E2E tests — API-level only.
- Coverage thresholds or CI integration.

## Decisions

### 1. Test runner: `bun:test`
Use Bun's built-in runner via `bun test`. No new dependency, zero config.

- Alternative considered: `vitest` — unnecessary extra dependency for this scope.

### 2. Dedicated test database via env, defaulting to `booking_test`
Tests use a separate PostgreSQL database so the dev database is never touched. Configured
through `DATABASE_URL_TEST` (default `postgres://postgres:postgres@localhost:5432/booking_test`).
A `tests/setup.ts` preload file sets `DATABASE_URL` and `JWT_SECRET` before any app module loads.

- Alternative considered: Testcontainers (Docker) — heavier, requires Docker daemon; not portable
  for a portfolio repo. A local/dedicated test DB keeps it simple.

### 3. Database reset in `tests/helpers/test-db.ts`
Single helper owning connect/reset/teardown:
- Uses `neon`-style `postgres` client bound to `DATABASE_URL_TEST`.
- Apply drizzle migrations (`migrate()`), then executes the exclusion constraint
  idempotently using `ADD CONSTRAINT IF NOT EXISTS` (the shipped manual file is not idempotent).
- `resetDb()` truncates `users`, `resources`, `bookings` (RESTART IDENTITY CASCADE) before each
  test file/run to guarantee isolation.
- `closeDb()` ends the connection at `afterAll`.

### 4. Service/unit tests hit the real DB
The services import a singleton `db` from `client.ts`, so unit tests run against the test DB
(light integration). This is accepted: it exercises Drizzle query builder and real errors
(`ConflictError`, `NotFoundError`) verifiably.

### 5. API tests drive the Elysia app without listening on a port
Build the app from `src/index.ts`'s app factory but call handlers via `app.handle(new Request(...))`.
This avoids port conflicts while exercising full routing, validation (TypeBox), middleware,
JWT/bearer, and the global error handler.

- `helpers/test-app.ts` builds the app and clears a shared module-level instance between runs
  to avoid JWT secret/route accumulation with Elysia CLI-scoped apps.

### 6. Auth in API tests
Helper methods `registerUser()`, `loginAs()`, `adminToken()` create users through the API and
return bearer tokens. Admin user is created directly via the DB (faster than seeding through the
API). Tokens are signed with the same test `JWT_SECRET`.

### 7. Concurrency test shape
Fire both booking requests with `Promise.all` against the running handlers so they truly overlap:
- Overlapping times on the same resource → assert total success count is exactly 1 and the loser
  gets a 409.
- Non-overlapping times → both succeed.
Uses unique resources per case to avoid cross-test interference and to keep the exclusion
constraint meaningful.

## Risks / Trade-offs

- [Tests require a running PostgreSQL] → Document `bun run test` prerequisites (local Postgres +
  dedicated `booking_test` DB) in README; the test script fails fast with a clear error if unreachable.
- [Test app build order / JWT secret captured at build time] → `test-app.ts` forces `JWT_SECRET`
  from setup env and rebuilds the app, never importing side-effectful state from a stale build.
- [Applying exclusion constraint idempotently] → use `ADD CONSTRAINT IF NOT EXISTS`; the constraint
  must exist for concurrency tests to be meaningful, which the helper guarantees.
- [Concurrency tests can be flaky if the DB connection pool serializes requests] → default `postgres`
  pool allows concurrent connections; keep concurrency test separate from reset timing so truncates
  don't race.

## Migration Plan

No production migration. Steps to enable tests:
1. Add `test`, `test:watch` scripts and `tests/` tree.
2. Create `booking_test` database (documented; helper also attempts if missing and prereqs exist).
3. Run `bun run test`.

Rollback: delete `tests/`, revert package.json scripts.