## Why

The booking backend currently logs with ad-hoc `console.log` / `console.error` calls scattered across `src/index.ts`, `src/modules/bookings/bookings.service.ts`, and other services. There is no consistent log format, no level control, no redaction of sensitive data (passwords, JWT tokens, `Authorization` headers), and no machine-readable file output. This makes post-incident debugging and any future log aggregation tooling impossible without a rewrite.

We will introduce a single structured logger based on `pino`, wrapped into the Elysia lifecycle via `@bogeychan/elysia-logger`, that emits newline-delimited JSON (NDJSON) to both stdout and a rolling `logs/app.log` file, redacts sensitive fields, and is used consistently for request, error, and business-event logging — without changing any externally observable API behavior.

## What Changes

- Add runtime dependencies `@bogeychan/elysia-logger` and `pino`, plus dev dependency `pino-pretty` for human-readable dev output.
- Add a new module `src/utils/logger.ts` that owns a single `pino` instance configured with:
  - ISO timestamps,
  - log level from `LOG_LEVEL` (default `info` in production, `debug` in development),
  - `pino.multistream()` writing to stdout AND `logs/app.log` (NDJSON; pretty-printing only on stdout in dev),
  - `redact` covering `password`, `passwordHash`, `*.password`, `*.passwordHash`, `req.headers.authorization`, and `token`.
- Export `elysiaLogger` from that module by passing the pino instance through `wrap()` from `@bogeychan/elysia-logger` with `autoLogging: true`. (The `wrap()` signature is verified against the installed package's `.d.ts` before writing the final code.)
- Mount `.use(elysiaLogger)` as early as possible in the Elysia chain in `src/index.ts` so every request is auto-logged. No manual `onRequest` / `onAfterResponse` hooks for request logging are added.
- Augment the existing `.onError(...)` handler in `src/index.ts` (do not rewrite it) with a single `ctx.log[level]({ err, statusCode }, "request error")` call. Whether error logging is already covered by the package's own `autoLogging` is verified at implementation time; the manual log is added only if needed and never changes the response body or status code.
- Add business-event logs inside existing service modules (no refactor, no new files except the logger):
  - `src/modules/bookings/bookings.service.ts` — `warn` on double-booking conflict (both the `FOR UPDATE` overlap path and the `PG_EXCLUSION_VIOLATION` fallback) with `resourceId` and the conflicting `startTime`/`endTime`; `info` on booking created with `bookingId`, `resourceId`, `userId` only.
  - `src/modules/auth/auth.service.ts` — `warn` on failed login attempt with the attempted `email` (never the password).
- Add `logs/` to `.gitignore` (already has `*.log`; we add the explicit directory to make intent obvious).
- Add `package.json` script `logs:tail` that runs `tail -f logs/app.log | bunx pino-pretty` for live human-readable tailing while the file itself stays raw NDJSON.
- A `logs/` directory is created at runtime if missing; the file format is NDJSON (one JSON object per line), not a wrapping array — documented in code comments.

## Capabilities

### New Capabilities

- `observability/structured-logging`: a centralized pino-based logger with NDJSON file output, redaction of sensitive fields, request/error auto-logging via `@bogeychan/elysia-logger`, and structured business-event logs for booking conflicts, successful bookings, and failed logins.

### Modified Capabilities

None. No existing requirement changes; this change adds observability without altering API behavior, error responses, or any contract documented in existing specs.

## Impact

- **New dependencies**: `@bogeychan/elysia-logger`, `pino` (runtime); `pino-pretty` (dev).
- **New file**: `src/utils/logger.ts` (one new file, per the project's "no refactor, no rename" rule).
- **Edited files** (additions only, no renames or relocations):
  - `package.json` — dependencies + `logs:tail` script.
  - `.gitignore` — add `logs/` directory entry.
  - `src/index.ts` — `.use(elysiaLogger)` and (if needed) one line inside the existing `onError`.
  - `src/modules/bookings/bookings.service.ts` — `warn`/`info` logs around double-booking detection and successful creation.
  - `src/modules/auth/auth.service.ts` — `warn` log on failed login.
- **API behavior**: unchanged. No response body, status code, header, or route signature changes.
- **Filesystem**: a `logs/app.log` file will be written at runtime; ignored by git.
- **Tests**: no behavioral test changes required; existing tests continue to work because the logger writes to file streams and does not affect HTTP outputs. `tests/setup.ts` is unaffected (it does not mock the new logger module).
- **Domain text**: log messages and comments remain in Indonesian, consistent with the project's convention.