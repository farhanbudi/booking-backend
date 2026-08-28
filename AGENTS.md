# AGENTS.md

Booking resource backend: Bun + ElysiaJS + Drizzle ORM + PostgreSQL. REST API focused on preventing double-booking (race conditions). Portfolio project; domain text (comments, errors, README) is in Indonesian — keep it consistent.

## Commands

All commands use Bun (`bun`), not npm.

- `bun install` — install deps
- `bun run dev` / `bun run start` — run server (watch / plain)
- `bun run db:generate` — generate Drizzle migration from `src/db/schema.ts`
- `bun run db:migrate` — apply Drizzle migrations
- `bun run db:seed` — insert 4 sample resources + admin user (`admin@example.com` / `admin12345`)
- `bun run db:studio` — Drizzle Studio
- Tests: `bun test` (built-in `bun:test`; `tests/setup.ts` is preloaded — see the `create-test-plan` change)

No lint script, no CI. For type checking use `bunx tsc --noEmit` — note `tsconfig.json` `include` is `src/**/*.ts` only, so it won't cover `tests/` or `openspec/`.

## Critical setup step

After `db:migrate` you MUST manually apply the PostgreSQL exclusion constraint (not tracked by Drizzle migrations):

```
psql $DATABASE_URL -f src/db/migrations/manual_0001_exclusion_constraint.sql
```

This `no_overlapping_bookings` constraint is the database-level layer of double-booking protection; skipping it silently disables that protection. `db:seed` is not idempotent — running it twice errors with `duplicate key` (normal; run once after migrating).

## Env & config

- `.env` is gitignored; copy `.env.example` (`DATABASE_URL`, `JWT_SECRET`, `PORT`).
- Bun auto-loads `.env` — no dotenv package or import exists.
- `src/db/client.ts` throws at import time if `DATABASE_URL` is unset; `auth.middleware.ts` reads `JWT_SECRET` at app build time (set it before building the app in tests).
- Tests use a dedicated env file `.env.test` (loaded automatically by `bun test` via `NODE_ENV=test`, and re-loaded explicitly by `tests/setup.ts`), pointing to a dedicated test DB (default `booking_test`), not the dev DB. `tests/setup.ts` is wired as preload both via CLI `--preload` and via `bunfig.toml` `[test] preload`, and guards that the effective `DATABASE_URL` points to a test DB (throws otherwise) — Bun does not override real environment variables with `.env` values, so the preload is what guarantees tests never touch the dev DB.

## Testing pitfalls (Bun)

- Do NOT use `await expect(promise).rejects.*` or `expect(promise).resolves.*` on service-level promises (anything that touches the DB / rejects after internal awaits). Under Bun 1.3.x these can hang forever: the per-test timeout fires while the promise never settles, cascading failures into later tests and stalling the whole `bun test` run. Assert manually with try/catch instead — see the `statusDari` helper in `tests/unit/bookings-payments.test.ts` and `tests/unit/payments-webhook-signature.test.ts`.
- When adding new exports to `src/jobs/producers.ts` (or any module that other services import statically), update EVERY existing `mock.module(...)` of that specifier across `tests/unit/` — an incomplete mock namespace breaks module linking with `Export named 'x' not found`, even in unrelated test files (all files share one process under `--parallel=1`).

## Architecture

- `src/index.ts` — Elysia app + global error handler (`AppError` → JSON status; TypeBox `VALIDATION` → 400).
- `src/routes/` — thin route definitions with TypeBox schemas; handlers delegate to service modules.
- `src/modules/{auth,resources,bookings}/` — business logic. Bookings double-booking protection lives in `bookings.service.ts` (`db.transaction` + `SELECT ... FOR UPDATE`, plus catching `PG_EXCLUSION_VIOLATION`).
- `src/middleware/auth.middleware.ts` — JWT + bearer; derives `getUser()`; `requireAdmin()` for admin-only routes.
- `src/db/` — `schema.ts` (users/resources/bookings), `client.ts` (shared `db` singleton + raw `client`), `migrate.ts`, `seed.ts`, `migrations/`.
- `src/utils/errors.ts` — `AppError` subclasses per status (Unauthorized 401, Forbidden 403, NotFound 404, Conflict 409) and `PG_EXCLUSION_VIOLATION = "23P01"`.

## Conventions

- All services import the singleton `db` from `src/db/client` directly (no DI) — code that needs to run against a test DB must set `DATABASE_URL` before these modules load.
- Errors are thrown as `AppError` subclasses and message text is Indonesian.
- Admins are the only role; guard with `requireAdmin(user)` after calling `getUser()`.