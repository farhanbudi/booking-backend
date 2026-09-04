## Context

See `proposal.md` for motivation. Briefly: the backend currently logs with
ad-hoc `console.log`/`console.error` calls (in `src/index.ts`'s `onError`, and
inside `src/modules/bookings/bookings.service.ts`'s queue-failure fallbacks).
There is no consistent format, no redaction, and no file output.

Project constraints from `AGENTS.md` that shape the design:

- Single `db` singleton imported from `src/db/client` — no DI, so the logger
  module must also export a singleton (no service-locator plumbing).
- Domain text and comments are in Indonesian — log messages stay in Indonesian.
- `tests/setup.ts` is the test preload; the logger must not break the existing
  test isolation setup (no module-load-order surprises for `tests/unit/`).
- Bun auto-loads `.env`; no dotenv import.
- No refactor/relocation allowed by the user; new code is additive only.

## Goals / Non-Goals

**Goals:**

- One new file (`src/utils/logger.ts`) owning the pino configuration.
- Mount the Elysia plugin as early as possible; rely on its `autoLogging` for
  request/error coverage; verify and minimally augment only if needed.
- NDJSON file output (`logs/app.log`) plus stdout, with dev-only pretty-printing
  on stdout.
- Redaction of password/passwordHash/Authorization/token at the logger layer.
- Business event logs for double-booking conflicts, successful bookings, and
  failed logins.
- A `logs:tail` script for live human-readable tailing.
- No API behavior change.

**Non-Goals:**

- Not adding a log aggregator, shipper, or external sink (Datadog, Loki, etc.).
- Not restructuring service files or extracting helpers.
- Not adding request-id / correlation-id propagation (unless the installed
  package already does so out of the box — not invented here).
- Not changing the existing `AppError` hierarchy, status codes, or response
  shapes.
- Not migrating existing `console.log`/`console.error` calls in worker code,
  payment webhook, etc. — only the ones explicitly listed in the spec get
  touched.

## Decisions

### D1. Use `@bogeychan/elysia-logger` (wrapper) instead of bare `pino-http` or hand-rolled hooks

The package is the official pino wrapper for Elysia's lifecycle and is
designed to plug into `onError` automatically when `autoLogging: true`. This
removes the need for a project-owned `onRequest`/`onAfterResponse` hook (which
would duplicate package behavior and risk double-logging). Wrapping our own
pino instance with `wrap()` lets us own redact/level/multistream config while
still getting Elysia integration for free.

**Alternatives considered:**

- `pino-http` directly — works fine but doesn't expose `ctx.log` in Elysia's
  `onError`, so we'd need to thread the logger through every handler. The
  Elysia-specific wrapper integrates with the framework's `derive`/context,
  which is the established pattern in this stack.
- Hand-rolled Elysia `onRequest`/`onAfterResponse` — duplicates work and
  conflicts with `autoLogging`.

### D2. Build our own pino instance, do not use the wrapper's prebuilt logger

`@bogeychan/elysia-logger` can create one itself, but we need:

- custom redact paths,
- `pino.multistream()` for file + stdout,
- ISO timestamps,
- level from `LOG_LEVEL`,

none of which are trivially exposed by the wrapper's convenience constructor.
Using `wrap(pinoInstance, ...)` keeps full control while still wiring
`autoLogging` and lifecycle hooks.

**Verification step before implementation:** read the installed `.d.ts` of the
package to confirm `wrap()` exists with the expected signature `(pinoInstance,
options?) => ElysiaPlugin`. If the signature differs (e.g. function is named
`logger`, accepts a config object instead of an instance), adjust to that
shape — but never fall back to writing manual hooks if `wrap` is unavailable;
in that case, abort and surface the discrepancy.

### D3. NDJSON file format with `pino.multistream()`

`pino.multistream()` accepts `[{ stream: ..., level?: ... }, ...]`. We point two
streams:

- stdout: a `pino-pretty` transport stream when `NODE_ENV !== "production"`,
  otherwise raw `process.stdout`.
- file: a `pino.destination("logs/app.log")` (or a hand-rolled
  `fs.createWriteStream(..., { flags: "a" })`) — always raw JSON, never
  pretty-printed, regardless of env.

NDJSON means each entry is one JSON object terminated by `\n`. The file is
stream-appendable (no need to parse the whole file to append), which is the
industry standard for log files (e.g. Bunyan, pino, Vector). This is
explicitly called out in a code comment and in the proposal so the file isn't
mistaken for a wrapping array.

**Alternative considered:** write the same JSON twice via two separate
pino instances — rejected; multistream is the canonical pattern and avoids
race conditions between two writers on the same file.

### D4. Level default `info` in production, `debug` in development

We read `LOG_LEVEL` first, fall back to `NODE_ENV === "production" ? "info" :
"debug"`. `pino`'s constructor accepts `level` as a string and applies it
directly; `multistream` accepts per-stream `level` overrides but we use a
single global level for simplicity.

### D5. Redact paths selected for this codebase

The exact paths:

- `password`, `*.password`, `*.passwordHash` — covers body fields and any
  object passed to a logger that might contain them.
- `req.headers.authorization` — covers the standard `pino-http` request log
  field for the Authorization header.
- `token` — covers any future code that passes a raw token into a logger
  context (defensive).

We deliberately do NOT add `req.body.password` because pino's redact applies
globally across any object; the `*.password` form covers the request body
automatically once it is included in a log entry.

**Risk:** if request logs from the Elysia wrapper don't include the raw body
(typical — bodies aren't logged to avoid accidentally leaking credentials),
then `password` redaction on body fields only matters for code that
explicitly logs the body, which we explicitly forbid in auth handlers.

### D6. Error logging decision: add explicit log, do not rely solely on `autoLogging`

`autoLogging: true` in `@bogeychan/elysia-logger` typically logs request
failures at the end of the lifecycle, but it logs them at a fixed level (often
`info`/`warn`) and may not include the `AppError` message in a structured
field. We want both: the package's auto request log, plus one explicit
`ctx.log[level]({ err, statusCode }, "request error")` inside the existing
`onError` so the AppError's message and `statusCode` are first-class fields
on the log line.

This is the minimum addition; it does not rewrite any branch, does not change
the response, and matches the existing pattern of calling `console.error`
from `onError` today.

### D7. Business event logs

- In `bookings.service.ts`:
  - One `warn` before throwing the `overlapping` `ConflictError` inside the
    `db.transaction` callback — `resourceId`, `startTime`, `endTime`.
  - One `warn` inside the `PG_EXCLUSION_VIOLATION` catch — same fields.
  - One `info` after the transaction returns successfully (covers both
    free and paid flows) — `bookingId`, `resourceId`, `userId`.
- In `auth.service.ts`:
  - One `warn` at both rejection points in `validateLogin` —
    `{ email: input.email }` (never the password). Same message text as
    today ("Email atau password salah") so the response is byte-identical.

These are pure additions; existing code paths, return values, and error
messages are unchanged.

### D8. Logging from non-Elysia code (services)

Services are called from route handlers and from jobs (worker). For service
code we import the same `pino` instance via `src/utils/logger.ts` and call
`logger.info({...}, "msg")` / `logger.warn({...}, "msg")`. The instance is a
module singleton; importing it from multiple files is cheap (pino's documented
pattern).

### D9. `logs:tail` script

`package.json`:

```json
"logs:tail": "tail -f logs/app.log | bunx pino-pretty"
```

`tail -f` is POSIX; on Windows under Git Bash / WSL this works. For native
PowerShell users we accept that the live-tail UX is degraded — the file is
still readable directly, and pretty-printing can be done manually with
`bunx pino-pretty logs/app.log`.

## Risks / Trade-offs

- **Risk:** `wrap()` signature in the installed package may differ from the
  expected `(pinoInstance, options)`. **Mitigation:** read
  `node_modules/@bogeychan/elysia-logger/dist/*.d.ts` before writing the
  final logger file; if signature differs, adapt the call site without
  rewriting the design. If `wrap` does not exist at all, stop and ask.
- **Risk:** automatic request logging might double-log if we also explicitly
  log in `onError`. **Mitigation:** the explicit log uses `ctx.log`
  (Elysia-augmented) and the package's auto-log uses its own pino; we
  accept a small duplication on error paths because the auto-log carries
  request metadata while the explicit log carries `err`/`statusCode` —
  this is the intended trade-off and is verified by reading 1–2 sample
  log lines during implementation.
- **Risk:** tests may flush console assertions; switching services to the
  logger instead of `console.warn` could change observable side effects
  inside `tests/unit/`. **Mitigation:** the spec lists only the booking
  service's business events (success and conflict) and the auth service's
  failed-login event; we do NOT touch the existing `console.warn` lines for
  queue/expiry failures — those stay as-is to avoid breaking existing tests.
- **Risk:** log file growth unbounded. **Mitigation:** out of scope for this
  change; rotation is a deployment concern (logrotate, Bunyan-style
  rolling, etc.) and adding it would expand scope.
- **Risk:** `pino-pretty` in dev increases startup cost. **Mitigation:**
  dev-only path; `NODE_ENV=production` skips it entirely.

## Migration Plan

1. Install new deps (`bun add @bogeychan/elysia-logger pino`,
   `bun add -d pino-pretty`).
2. Create `src/utils/logger.ts` and `logs/` directory.
3. Add `.use(elysiaLogger)` in `src/index.ts` as the first plugin in the
   chain.
4. Add the explicit error log inside the existing `onError` in
   `src/index.ts`.
5. Add business event logs in `src/modules/bookings/bookings.service.ts`
   and `src/modules/auth/auth.service.ts`.
6. Update `package.json` (script) and `.gitignore` (logs/).
7. Verify with a local run (`bun run dev`) and an error-triggering request
   that both stdout and `logs/app.log` contain the expected entries and
   that redaction works.

**Rollback:** revert the single new file and the additive edits to existing
files. No schema, no migration, no API behavior changes means rollback is a
plain code revert — no data migration concerns.

## Open Questions

None. The remaining unknowns (exact `wrap()` signature, exact field set of
the auto request log) are verified during implementation against the
installed package's `.d.ts` and one sample log line — neither changes the
spec, the approach, or the task breakdown.