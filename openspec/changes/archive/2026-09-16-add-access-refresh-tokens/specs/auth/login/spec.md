## Purpose

Handles user authentication and issues access/refresh token pairs upon successful credential validation.

## ADDED Requirements

### Requirement: User login returns access and refresh tokens

The system SHALL authenticate user credentials and return both a short-lived access token and a long-lived refresh token.

#### Scenario: Successful login with token pair
- **WHEN** user provides valid email and password
- **THEN** system validates credentials
- **THEN** system creates a session record (refresh token stored as hash)
- **THEN** system generates JWT access token with 15-minute expiry containing user claims (sub, email, role)
- **THEN** system returns response with `accessToken`, `refreshToken`, and `token` (alias for accessToken for backward compatibility)

#### Scenario: Failed login
- **WHEN** user provides invalid email or password
- **THEN** system returns 401 Unauthorized with generic error message
- **THEN** no session is created