## Context

Current authentication uses a single JWT with no expiration (`src/modules/auth/auth.routes.ts` line 33-37). The `auth.middleware.ts` verifies this token via `jwt.verify()` and exposes `getUser()`. Login returns only `{ token }`. Database has `users` table but no session storage.

See `proposal.md` - Why for motivation.

## Goals / Non-Goals

**Goals:**
- Implement access token (15 min JWT) + refresh token (30 days, DB-stored hash) pattern
- Enable individual session revocation without affecting other sessions
- Maintain backward compatibility via `token` alias in login response
- Use Web Crypto API (no new dependencies) for token generation and SHA-256 hashing
- Keep existing `auth.middleware.ts` unchanged — it already handles short-lived JWTs correctly

**Non-Goals:**
- Refresh token rotation (new token on each refresh)
- Automatic token reuse detection / theft detection
- Scheduled cleanup of expired sessions
- Changes to registration or password reset flows

## Decisions

### 1. Database Schema: `sessions` table

**Decision:** Add `sessions` table with columns: `id`, `user_id` (FK cascade), `token_hash` (unique), `user_agent`, `ip_address`, `created_at`, `expires_at`, `revoked_at`.

**Rationale:**
- `token_hash` unique constraint prevents accidental duplicates
- `user_id` cascade delete cleans up sessions when user is deleted
- `revoked_at` nullable timestamp enables soft revocation (logout) without row deletion
- `user_agent`/`ip_address` provide audit context for security monitoring
- No exclusion constraint needed — sessions don't have overlapping time ranges to protect

**Alternative considered:** Store plaintext token with encryption. Rejected — hashing is simpler, standard practice for bearer tokens, and avoids key management.

### 2. Refresh Token Generation & Hashing

**Decision:** 
- Generation: 32 random bytes → base64url (256-bit entropy)
- Hashing: SHA-256 via `crypto.subtle.digest` → hex string

**Rationale:**
- 256-bit entropy makes brute force infeasible; fast hash (SHA-256) is sufficient since token is already high-entropy (unlike user-chosen passwords)
- Web Crypto API is built into Bun, no dependencies
- Base64url is URL-safe and compact for transport

**Alternative considered:** `Bun.password.hash()` (argon2id). Rejected — intentionally slow for low-entropy secrets; unnecessary overhead for high-entropy tokens.

### 3. Session Service (`src/modules/auth/session.service.ts`)

**Decision:** New module with three functions:
- `createSession({ userId, userAgent?, ipAddress? })` → returns plaintext refresh token
- `validateSession(rawToken)` → returns session or throws `UnauthorizedError`
- `revokeSession(rawToken)` → idempotent, no error if already revoked

**Rationale:**
- Separation of concerns: auth routes handle HTTP, service handles session logic
- `validateSession` throws `UnauthorizedError` for consistent error handling
- `revokeSession` is idempotent to simplify logout endpoint (no need to distinguish "already logged out")

### 4. Access Token Format

**Decision:** JWT signed by existing `@elysiajs/jwt` plugin with claims: `sub` (user ID), `email`, `role`, `exp` (15 min from now).

**Rationale:**
- Reuses existing JWT infrastructure in `auth.middleware.ts`
- Short expiry limits blast radius of token leakage
- Claims match current payload for zero middleware changes

### 5. Login Response Shape

**Decision:** Return `{ accessToken, refreshToken, token: accessToken }`

**Rationale:**
- `accessToken` + `refreshToken` are the new canonical fields
- `token` alias preserves compatibility with existing frontend that reads `token`
- Frontend migration can happen independently; alias removed in future change

### 6. Refresh Endpoint (`POST /auth/refresh`)

**Decision:** Public endpoint (no `requireAuth`), validates refresh token via `validateSession()`, returns new access token only.

**Rationale:**
- Refresh token itself proves possession; no need for access token
- Returns only access token — refresh token stays same (no rotation per MVP scope)
- Body: `{ refreshToken: string }`

### 7. Logout Endpoint (`POST /auth/logout`)

**Decision:** Public endpoint, calls `revokeSession()`, returns `{ success: true }`.

**Rationale:**
- Idempotent revocation means no error handling needed for invalid tokens
- Client discards tokens locally; server revocation prevents reuse
- No `requireAuth` needed — refresh token in body is sufficient proof

### 8. Error Handling

**Decision:** Reuse existing `UnauthorizedError` from `utils/errors.ts` for all token validation failures (login, refresh, middleware).

**Rationale:**
- Consistent error format across auth flows
- Global error handler in `index.ts` already maps `AppError` subclasses to correct status codes

## Risks / Trade-offs

| Risk | Mitigation |
|------|------------|
| Refresh tokens accumulate in DB (no cleanup job) | Acceptable for MVP; add cleanup job in follow-up. Query filters (`expires_at > NOW()`, `revoked_at IS NULL`) keep active set small. |
| No rotation = longer exposure window if token stolen | Documented as known limitation; rotation can be added later without breaking API contract. |
| `ip_address` may be undefined behind proxies | Use `x-forwarded-for` header fallback; field is nullable, failure doesn't block login. |
| SHA-256 hash in DB — if DB leaks, tokens safe but hashes are verifiable | High-entropy tokens make offline verification infeasible; standard practice. |
| Login response has both `token` and `accessToken` — potential confusion | Document clearly; `token` marked deprecated in OpenAPI; remove after frontend migration. |

## Migration Plan

1. **Apply schema**: Run `bun run db:generate` → `bun run db:migrate` to create `sessions` table
2. **Deploy code**: All changes are additive (new files + extended login response); no breaking changes
3. **Verify**: Test login → access protected route → wait 15 min → 401 → refresh → access works → logout → refresh fails
4. **Frontend migration** (separate): Update frontend to use `accessToken`/`refreshToken`; then remove `token` alias in future backend change
5. **Rollback**: Revert code changes; `sessions` table can remain (unused) or be dropped via migration

## Open Questions

None — all design decisions resolved per requirements.