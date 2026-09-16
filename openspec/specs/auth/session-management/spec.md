# auth/session-management Specification

## Purpose
Manages the lifecycle of refresh tokens (sessions) — creation on successful login, validation when exchanging for access tokens, and revocation on logout. Provides secure storage of refresh token hashes with metadata for audit and security monitoring.

## Requirements

### Requirement: Session creation on login

The system SHALL create a new session record when a user successfully authenticates with valid credentials.

#### Scenario: Successful session creation
- **WHEN** user provides valid email and password
- **THEN** system creates a session record with hashed refresh token, user ID, user agent, IP address, creation timestamp, and 30-day expiry
- **THEN** system returns the plaintext refresh token to the client (only time it is ever exposed)

### Requirement: Session validation for token refresh

The system SHALL validate a presented refresh token by hashing it and checking for a matching, non-revoked, non-expired session record.

#### Scenario: Valid refresh token
- **WHEN** client presents a refresh token that matches a session with no revocation timestamp and future expiry
- **THEN** system returns the associated user ID for access token generation

#### Scenario: Expired refresh token
- **WHEN** client presents a refresh token whose session expiry is in the past
- **THEN** system rejects the token with an authentication error

#### Scenario: Revoked refresh token
- **WHEN** client presents a refresh token whose session has a revocation timestamp
- **THEN** system rejects the token with an authentication error

#### Scenario: Non-existent refresh token
- **WHEN** client presents a refresh token with no matching session hash
- **THEN** system rejects the token with an authentication error

### Requirement: Session revocation on logout

The system SHALL mark a session as revoked when the user logs out, preventing future use of that refresh token.

#### Scenario: Successful revocation
- **WHEN** client presents a valid refresh token to the logout endpoint
- **THEN** system sets the session's revoked_at timestamp to current time
- **THEN** subsequent refresh attempts with that token are rejected

#### Scenario: Revocation of already-revoked token
- **WHEN** client presents a refresh token that was already revoked
- **THEN** system handles gracefully (idempotent operation, no error thrown)

### Requirement: Refresh token hashing for storage security

The system SHALL store only a SHA-256 hash of the refresh token in the database, never the plaintext token.

#### Scenario: Token never stored in plaintext
- **WHEN** session is created
- **THEN** database contains only the hex-encoded SHA-256 hash of the refresh token
- **THEN** plaintext token is returned to client only once at creation and never logged
