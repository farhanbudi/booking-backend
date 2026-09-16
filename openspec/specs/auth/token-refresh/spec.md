# auth/token-refresh Specification

## Purpose
Enables clients to obtain new short-lived access tokens by presenting a valid long-lived refresh token, without requiring the user to re-enter credentials.

## Requirements

### Requirement: Access token issuance via refresh token

The system SHALL issue a new access token when a valid refresh token is presented.

#### Scenario: Successful token refresh
- **WHEN** client sends POST /auth/refresh with a valid refresh token in request body
- **THEN** system validates the refresh token against session store
- **THEN** system generates a new JWT access token (15-minute expiry) with user claims (sub, email, role)
- **THEN** system returns the new access token in response body

#### Scenario: Invalid refresh token
- **WHEN** client sends POST /auth/refresh with an invalid/expired/revoked/non-existent refresh token
- **THEN** system returns 401 Unauthorized with error message

#### Scenario: Missing refresh token
- **WHEN** client sends POST /auth/refresh without refreshToken field in request body
- **THEN** system returns 400 Bad Request (validation error)

### Requirement: Refresh token reuse without rotation (MVP)

The system SHALL allow the same refresh token to be used multiple times until expiry or explicit revocation.

#### Scenario: Multiple refreshes with same token
- **WHEN** client uses the same valid refresh token to obtain access tokens multiple times
- **THEN** each request succeeds and returns a new access token
- **THEN** the refresh token remains valid until its 30-day expiry or explicit logout
