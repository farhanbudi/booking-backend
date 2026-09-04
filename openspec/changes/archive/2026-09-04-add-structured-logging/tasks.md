## 1. Verify package signatures and install dependencies

- [x] 1.1 Inspect `node_modules/@bogeychan/elysia-logger` (its `package.json`,
  `dist/*.d.ts`, and exports) to confirm `wrap()` exists and to record its
  exact signature, then verify by inspection that it accepts a `pino`
  instance and an options bag including `autoLogging`. Document signature in
  a short code comment at the top of `src/utils/logger.ts`.
- [x] 1.2 Install runtime deps and verify `package.json` and `bun.lock` are
  updated by running `bun add @bogeychan/elysia-logger pino` and confirming
  both packages appear under `dependencies` and that `bun install` (already
  satisfied) does not error.
- [x] 1.3 Install dev dep and verify `package.json` lists `pino-pretty` under
  `devDependencies` by running `bun add -d pino-pretty`.

## 2. Centralized logger module

- [x] 2.1 Create `src/utils/logger.ts` exporting a `pino` instance configured
  with `level` from `LOG_LEVEL` (fallback `info`/`debug` by `NODE_ENV`),
  `timestamp: pino.stdTimeFunctions.isoTime`, and `redact` paths covering
  `password`, `passwordHash`, `*.password`, `*.passwordHash`,
  `req.headers.authorization`, `token` with `censor: "[REDACTED]"`. Verify
  by reading the file back and confirming all five paths are present.
- [x] 2.2 Wire `pino.multistream()` so the same pino output goes to stdout
  (raw when `NODE_ENV === "production"`, `pino-pretty` otherwise) and to
  `logs/app.log` (always raw JSON, NDJSON — never pretty). Verify by
  inspecting `src/utils/logger.ts` and confirming there are exactly two
  stream entries and that the file stream has no pretty transform.
- [x] 2.3 Ensure `logs/` exists at startup and `logs/app.log` is created on
  first write by creating the directory with `fs.mkdirSync("logs",
  { recursive: true })` before constructing the file destination. Verify by
  deleting `logs/` and running `bun run dev` briefly, then confirming
  `logs/app.log` exists.
- [x] 2.4 Export `elysiaLogger` from `src/utils/logger.ts` by passing the
  pino instance through `wrap()` with `autoLogging: true`. Verify the
  named export exists and that `bunx tsc --noEmit` reports no type errors
  against `src/**/*.ts`.

## 3. Wire logger into Elysia app

- [x] 3.1 Import `elysiaLogger` from `./utils/logger` at the top of
  `src/index.ts` (additions only — no other lines moved). Verify by reading
  `src/index.ts` and confirming the import statement is present and unique.
- [x] 3.2 Mount `.use(elysiaLogger)` as the first `.use(...)` call in the
  Elysia chain in `src/index.ts` (before `cors()`, `openapi()`, and all
  route plugins). Verify by reading `src/index.ts` and confirming the
  call order.
- [x] 3.3 Augment the existing `onError` handler in `src/index.ts` (do not
  rewrite it) with a single explicit log call:
  `const isServerError = ctx.set.status && Number(ctx.set.status) >= 500;
  ctx.log[isServerError ? "error" : "warn"]({ err: ctx.error,
  statusCode: ctx.set.status }, "request error");`. Verify by reading
  `src/index.ts` and confirming the existing `if/return` blocks are intact
  (response body and status codes unchanged).

## 4. Business event logs

- [x] 4.1 In `src/modules/bookings/bookings.service.ts`, import the logger
  singleton at the top. Verify the import statement is added and no other
  lines are moved.
- [x] 4.2 Add a `warn` log in `createBooking` inside the `db.transaction`
  immediately before throwing the overlapping-slot `ConflictError`, with
  `resourceId`, `startTime`, `endTime`. Verify by reading the file and
  confirming the throw is preceded by the log call.
- [x] 4.3 Add a `warn` log in `createBooking` inside the
  `PG_EXCLUSION_VIOLATION` catch block, with `resourceId`, `startTime`,
  `endTime`. Verify by reading the file and confirming the log call is
  inside the existing catch.
- [x] 4.4 Add an `info` log after the `db.transaction` returns
  successfully, with `bookingId`, `resourceId`, `userId`. Verify by reading
  the file and confirming the log fires for both free and paid flows.
- [x] 4.5 In `src/modules/auth/auth.service.ts`, import the logger
  singleton at the top. Verify the import statement is added.
- [x] 4.6 Add a `warn` log at both rejection points in `validateLogin`
  (missing user and wrong password) with `{ email: input.email }` and no
  password. Verify by reading the file and confirming two warn logs are
  present and no password value is included.

## 5. Project configuration

- [x] 5.1 Add `"logs:tail": "tail -f logs/app.log | bunx pino-pretty"` to
  `scripts` in `package.json`. Verify by reading `package.json` and
  confirming the new script key exists.
- [x] 5.2 Add `logs/` to `.gitignore` (in addition to the existing
  `*.log` rule). Verify by reading `.gitignore` and confirming the line
  is present.

## 6. End-to-end verification

- [x] 6.1 Run `bun install` and verify it exits 0 with no audit warnings
  blocking the build.
- [x] 6.2 Run `bunx tsc --noEmit` and verify it exits 0 (type check on
  `src/**/*.ts`; tests and openspec are excluded by `tsconfig.json` and
  that's expected).
- [x] 6.3 Run `bun run dev`, hit any endpoint with `curl`, and verify
  that `logs/app.log` contains at least one well-formed JSON line per
  request with the expected field set (method, URL, status, response time).
- [x] 6.4 Trigger a 4xx by hitting an admin-only endpoint without a token
  and verify the resulting log line is at level `warn`, contains the
  `statusCode` (401) and an `err` object, and that the response body is
  still the JSON `{"error": "..."}` shape returned today.
- [x] 6.5 Trigger a successful login with a wrong password and verify
  the log line shows the attempted `email` field and that no `password`
  value appears anywhere in the line (the `redact` paths guarantee this;
  check by grepping the log).
- [x] 6.6 Run `bun run logs:tail` in a separate terminal while the dev
  server is up, make a request, and verify a pretty-printed line appears
  in real time and that the raw file (`logs/app.log`) is still valid
  NDJSON (each line parses as a JSON object).
- [x] 6.7 Run `bun run test` and verify the existing test suite still
  passes — no test should regress because of the logger additions
  (logger writes to file/stdout, not into test assertions).

## 7. Simplified log tail for humans (deferred)

The default `logs:tail` (pino-pretty over the full Elysia auto-log stream)
emits ~40 lines per HTTP request because `autoLogging: true` includes
headers, cookies, and the full request context. That is great for
debugging but hard to skim. A second script that reads the same
`logs/app.log` NDJSON directly and shows only what a human cares about
was discussed and scoped, but is deferred to a separate change so this
change can be archived now.

- [-] 7.1 Create `scripts/logs-tail-simple.mjs` and add
  `"logs:tail:simple": "bun scripts/logs-tail-simple.mjs"` to
  `package.json`. _Cancelled — will be tracked under a new change
  `add-simple-log-tail` so that the design can be revisited
  independently after this change is archived._