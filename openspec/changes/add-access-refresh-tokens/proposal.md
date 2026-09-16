## Why

The current authentication system uses a single JWT with no expiration — once a user logs in, their token is valid forever and cannot be revoked without changing `JWT_SECRET` (which logs out ALL users simultaneously). This is a significant security risk. We need to implement an access token + refresh token pattern where access tokens are short-lived (15 minutes) for API calls, and refresh tokens are long-lived (30 days), stored in the database, and can be individually revoked (e.g., on logout) without affecting other sessions.

## What Changes

- **New `sessions` table** in database to store hashed refresh tokens with metadata (user agent, IP, expiry, revocation timestamp)
- **New utility functions** for generating cryptographically secure refresh tokens and hashing them with SHA-256
- **New session service** (`session.service.ts`) for creating, validating, and revoking sessions
- **Modified `POST /auth/login`** — returns both `accessToken` (JWT, 15 min) and `refreshToken` (random string); keeps `token` field as alias for backward compatibility with existing frontend
- **New `POST /auth/refresh`** endpoint — exchanges valid refresh token for new access token
- **New `POST /auth/logout`** endpoint — revokes refresh token (marks as revoked in database)
- **Existing `auth.middleware.ts`** — remains unchanged; continues to verify access tokens (now short-lived); expired tokens automatically return 401

## Capabilities

### New Capabilities

- `auth/session-management`: Manages refresh token lifecycle — creation on login, validation on refresh, revocation on logout. Includes database schema, hashing utilities, and service layer.
- `auth/token-refresh`: Endpoint for exchanging refresh tokens for new access tokens.

### Modified Capabilities

- `auth/login`: Response payload now includes `accessToken` and `refreshToken` fields in addition to existing `token` alias. Login behavior (credential validation) unchanged.

## Impact

- **Database**: New `sessions` table; requires migration (`db:generate` + `db:migrate` + manual exclusion constraint not needed for this table)
- **API**: `/auth/login` response shape extended (non-breaking); two new endpoints added (`/auth/refresh`, `/auth/logout`)
- **Security**: Refresh tokens hashed before storage; individual session revocation now possible
- **Dependencies**: No new npm packages — uses Web Crypto API (`crypto.subtle.digest`) and built-in `crypto.getRandomValues`
- **Testing**: New unit/integration tests needed for session service and new endpoints