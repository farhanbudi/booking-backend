## 1. Database Schema & Migration

- [x] 1.1 Add `sessions` table to `src/db/schema.ts` with columns: `id` (uuid, PK), `userId` (uuid, FK cascade to users), `tokenHash` (varchar(255), unique), `userAgent` (varchar(500), nullable), `ipAddress` (varchar(100), nullable), `createdAt` (timestamptz, default now), `expiresAt` (timestamptz), `revokedAt` (timestamptz, nullable); export `Session` and `NewSession` types. **Verify**: File compiles with `bunx tsc --noEmit`
- [x] 1.2 Generate migration: run `bun run db:generate` and verify migration file created in `src/db/migrations/`. **Verify**: Migration file exists with CREATE TABLE for sessions
- [x] 1.3 Apply migration: run `bun run db:migrate` and verify `sessions` table exists in database. **Verify**: `psql $DATABASE_URL -c "\d sessions"` shows table

## 2. Token Utilities

- [x] 2.1 Create `src/utils/token.ts` with `generateRefreshToken()` (32 random bytes → base64url) and `hashToken(token)` (SHA-256 via `crypto.subtle.digest` → hex). **Verify**: File compiles; unit test can import and call functions
- [x] 2.2 Add unit tests for `token.ts` in `tests/unit/token.test.ts`: `generateRefreshToken` returns 43-char base64url string; `hashToken` returns 64-char hex; same input produces same hash; different inputs produce different hashes. **Verify**: `bun test tests/unit/token.test.ts` passes

## 3. Session Service

- [x] 3.1 Create `src/modules/auth/session.service.ts` with `createSession`, `validateSession`, `revokeSession` per design.md. Import `db`, `sessions`, `generateRefreshToken`, `hashToken`, `UnauthorizedError`. **Verify**: File compiles; exports three functions
- [x] 3.2 Add unit tests for `session.service.ts` in `tests/unit/session.service.test.ts` (use test DB via `.env.test`): create session returns token; validateSession accepts valid token; validateSession rejects expired/revoked/non-existent tokens; revokeSession marks session revoked; revokeSession idempotent on already-revoked token. **Verify**: `bun test tests/unit/session.service.test.ts` passes

## 4. Auth Routes — Login, Refresh, Logout

- [x] 4.1 Modify `src/routes/auth.routes.ts`:
  - Import `createSession`, `validateSession`, `revokeSession` from `../modules/auth/session.service`
  - Import `getUserById` from `../modules/auth/auth.service`
  - Update `/login` handler: after `validateLogin`, generate access token (15 min expiry), create session for refresh token, return `{ accessToken, refreshToken, token: accessToken }`
  - Add `/refresh` handler: validate refresh token, get user by ID, generate new access token, return `{ accessToken }`
  - Add `/logout` handler: call `revokeSession`, return `{ success: true }`
  - All new endpoints use TypeBox schemas for request body validation. **Verify**: File compiles; routes registered under `/auth` prefix
- [x] 4.2 Add integration tests in `tests/integration/auth-refresh.test.ts`:
  - Login returns accessToken + refreshToken + token alias
  - Access token works on protected route (`/auth/me`)
  - Refresh with valid token returns new accessToken
  - Refresh with invalid/expired/revoked token returns 401
  - Logout revokes token; subsequent refresh fails with 401
  - Multiple refreshes with same token succeed (no rotation). **Verify**: `bun test tests/integration/auth-refresh.test.ts` passes

## 5. Verification & Documentation

- [x] 5.1 Run full test suite: `bun test` — ensure no regressions in existing auth, bookings, payments tests. **Verify**: All tests pass
- [ ] 5.2 Manual verification checklist (run against dev server):
  1. `POST /auth/login` with valid credentials → 200, response has `accessToken`, `refreshToken`, `token`
  2. `GET /auth/me` with `Authorization: Bearer <accessToken>` → 200, user data
  3. Wait >15 min (or temporarily reduce expiry to 10s for test) → `GET /auth/me` → 401
  4. `POST /auth/refresh` with valid `refreshToken` → 200, new `accessToken`
  5. `GET /auth/me` with new `accessToken` → 200
  6. `POST /auth/logout` with `refreshToken` → 200, `{ success: true }`
  7. `POST /auth/refresh` with same `refreshToken` → 401
  8. `POST /auth/login` with invalid credentials → 401
  9. `POST /auth/refresh` with missing body → 400
  10. Verify `token` field equals `accessToken` in login response (backward compat)
- [x] 5.3 Update OpenAPI/Swagger documentation (auto-generated via `@elysiajs/openapi`): verify new endpoints appear at `/docs` with correct schemas. **Verify**: Open `/docs` in browser, see `/auth/refresh` and `/auth/logout` documented

## 6. Migration Commands (Post-Deploy)

- [ ] 6.1 After deploying code, run migrations on target database:
  - `bun run db:generate`
  - `bun run db:migrate`
  - (No manual exclusion constraint needed for sessions table) **Verify**: Target DB has `sessions` table
