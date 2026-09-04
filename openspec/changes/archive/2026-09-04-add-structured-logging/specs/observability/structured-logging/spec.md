## Purpose

Memberikan observabilitas terstruktur pada backend booking: satu logger terpusat
berbasis pino yang menulis log dalam format NDJSON ke stdout dan file, dengan
penyaringan data sensitif dan event bisnis penting yang konsisten di seluruh
request, error, dan layanan inti (auth, bookings).

## ADDED Requirements

### Requirement: Centralized structured logger

The system SHALL provide a single logger instance based on `pino`, exposed from
`src/utils/logger.ts`, that emits structured log entries as JSON objects.

#### Scenario: Logger emits JSON-shaped entries
- **WHEN** any code in the project calls the logger with a level (`info`,
  `warn`, `error`, `debug`)
- **THEN** each emitted entry is a single JSON object containing at minimum
  `level`, `time` in ISO 8601 format, and `msg`

### Requirement: NDJSON file output

The logger SHALL write to a file at `logs/app.log` relative to the project root,
in newline-delimited JSON (NDJSON) format — one JSON object per line — independent
of the runtime environment.

#### Scenario: File receives one JSON object per line
- **WHEN** log entries are emitted
- **THEN** `logs/app.log` grows by one line per entry, where each line is a
  parseable JSON object and the file as a whole is NOT a single wrapping JSON
  array

#### Scenario: `logs/` directory is created on demand
- **WHEN** the logger initializes and `logs/` does not yet exist
- **THEN** the directory is created automatically before the first write

#### Scenario: `logs/` is gitignored
- **WHEN** the developer inspects `.gitignore`
- **THEN** `logs/` (and its contents) is listed so log files are not committed

### Requirement: Stdout dual output via multistream

The logger SHALL use `pino.multistream()` so each entry is written to both
stdout and the log file in a single emission.

#### Scenario: Same entry reaches both destinations
- **WHEN** a log entry is emitted
- **THEN** an equivalent line is observable in stdout AND appended to
  `logs/app.log`

### Requirement: Pretty-printed stdout in development only

Stdout output SHALL be formatted with `pino-pretty` when `NODE_ENV !== "production"`,
and SHALL remain raw JSON (no pretty-printing) in any other environment.

#### Scenario: Dev stdout is human-readable
- **WHEN** `NODE_ENV` is not `production`
- **THEN** stdout lines are pretty-printed via `pino-pretty`

#### Scenario: Production stdout is raw JSON
- **WHEN** `NODE_ENV` is `production`
- **THEN** stdout lines are raw JSON, identical in structure to file output

### Requirement: Configurable log level

The logger SHALL honor the `LOG_LEVEL` environment variable for its minimum
level, defaulting to `info` when `NODE_ENV === "production"` and `debug`
otherwise.

#### Scenario: LOG_LEVEL overrides defaults
- **WHEN** `LOG_LEVEL=warn` is set
- **THEN** `info` and `debug` entries are not emitted, but `warn` and `error`
  entries are

#### Scenario: Default level in production
- **WHEN** `NODE_ENV=production` and `LOG_LEVEL` is unset
- **THEN** the effective level is `info`

#### Scenario: Default level in development
- **WHEN** `NODE_ENV` is not `production` and `LOG_LEVEL` is unset
- **THEN** the effective level is `debug`

### Requirement: Sensitive data redaction

The logger SHALL redact the following fields from any log entry that contains
them, replacing their values with the literal `[REDACTED]`:

- `password`
- `passwordHash`
- `*.password`
- `*.passwordHash`
- `req.headers.authorization`
- `token`

#### Scenario: Password is redacted
- **WHEN** a log entry would contain a `password` field (at any depth matched
  by the paths above)
- **THEN** the value is replaced with `[REDACTED]` in the emitted entry

#### Scenario: Authorization header is redacted
- **WHEN** a request log entry is emitted with `req.headers.authorization`
- **THEN** the header value is replaced with `[REDACTED]`

#### Scenario: JWT token is redacted
- **WHEN** any log entry contains a `token` field
- **THEN** the value is replaced with `[REDACTED]`

#### Scenario: Auth endpoints never log raw request body
- **WHEN** the `/auth/register` or `/auth/login` handlers execute
- **THEN** the password value from the request body is NOT emitted in any
  log entry (only safe identifiers such as `email` may be logged)

### Requirement: Request and response auto-logging

Every HTTP request processed by the Elysia app SHALL produce one structured
log entry automatically, without any manual `onRequest`/`onAfterResponse` hook
added by the project. This is achieved by mounting the
`@bogeychan/elysia-logger`-wrapped logger with `autoLogging: true` on the Elysia
instance as early as possible in the plugin chain.

#### Scenario: Successful request is logged
- **WHEN** any HTTP request completes with a 2xx/3xx/4xx response
- **THEN** a single log entry is emitted containing the HTTP method, URL,
  response status code, and response time

#### Scenario: Logger is mounted before other plugins
- **WHEN** the app is built in `src/index.ts`
- **THEN** `.use(elysiaLogger)` appears before any route plugin in the chain

#### Scenario: No manual request/response hook duplicates the package behavior
- **WHEN** the codebase is inspected
- **THEN** no project-owned `onRequest` or `onAfterResponse` hook is added for
  the sole purpose of request logging

### Requirement: Error logging

Every error caught by the global `onError` handler in `src/index.ts` SHALL be
recorded in the structured log. Whether this happens automatically via the
logger package's `autoLogging` integration or via a single explicit call
inside `onError` is determined by the installed package's actual behavior —
but the response body and status code emitted to the client SHALL remain
identical to today's behavior.

#### Scenario: AppError is logged with its status
- **WHEN** an `AppError` (or subclass such as `ConflictError`, `UnauthorizedError`,
  `ForbiddenError`, `NotFoundError`) is thrown
- **THEN** a log entry is emitted containing the error message and the
  numeric status code, at level `warn` for 4xx and `error` for 5xx

#### Scenario: Validation errors are logged
- **WHEN** a request fails TypeBox / Elysia `VALIDATION`
- **THEN** a log entry is emitted and the response is still
  `400 { error: "Input tidak valid", detail: ... }`

#### Scenario: Unknown errors are logged as 500
- **WHEN** an unhandled error reaches `onError`
- **THEN** a log entry at level `error` is emitted and the response is still
  `500 { error: "Terjadi kesalahan pada server" }`

#### Scenario: Response shape is unchanged
- **WHEN** any error path is exercised
- **THEN** the HTTP response body and status code observed by clients are
  identical to those before this change

### Requirement: Business event logs

The booking service SHALL emit structured logs for the two most important
business events: double-booking conflicts and successful booking creation.

#### Scenario: Double-booking conflict is logged at warn
- **WHEN** `createBooking` rejects an overlapping request, whether the
  conflict is detected by the `SELECT ... FOR UPDATE` overlap check OR by
  the database `no_overlapping_bookings` exclusion constraint fallback
- **THEN** a `warn` log entry is emitted containing `resourceId`, the
  requested `startTime`, and the requested `endTime`

#### Scenario: Booking created is logged at info
- **WHEN** `createBooking` successfully creates a booking (free or paid flow)
- **THEN** an `info` log entry is emitted containing `bookingId`, `resourceId`,
  and `userId`, and no other PII such as `email` is included

### Requirement: Failed login log

The auth service SHALL emit a `warn` log entry on any failed login attempt,
including the email that was attempted and explicitly excluding the password.

#### Scenario: Wrong email produces a warn log
- **WHEN** `validateLogin` is called with an email that does not match any user
- **THEN** a `warn` entry is emitted containing the attempted `email` and
  no `password` value

#### Scenario: Wrong password produces a warn log
- **WHEN** `validateLogin` is called with a matching user but an incorrect
  password
- **THEN** a `warn` entry is emitted containing the attempted `email` and
  no `password` value

### Requirement: Live log tailing script

The `package.json` SHALL expose a `logs:tail` script that streams
`logs/app.log` through `pino-pretty` for human-readable live tailing while
the file itself remains raw NDJSON.

#### Scenario: Tailing the log shows recent activity
- **WHEN** the developer runs `bun run logs:tail`
- **THEN** lines appended to `logs/app.log` appear in the terminal in
  pretty-printed form in near real-time