# booking-email-jobs Specification (delta)

Delta untuk environment-driven mail provider (Mailpit ↔ Resend) dan pembatasan penerima di mode demo.

## ADDED Requirements

### Requirement: Environment-driven mail provider selection

The system SHALL select its outbound mail transport from a `MAIL_PROVIDER` environment setting with two supported values: `smtp` for development and `resend` for production. When `MAIL_PROVIDER` is unset, the system SHALL default to `smtp`, so existing local development configuration continues to work unchanged.

In `smtp` mode the transport MUST be configured from `SMTP_HOST` and `SMTP_PORT` (defaulting to `localhost` and `1025` respectively), authenticating only when both `SMTP_USER` and `SMTP_PASS` are provided.

In `resend` mode the transport MUST be configured for the provider's SMTP endpoint with the provider's designated username and the API key supplied via `RESEND_API_KEY`. The endpoint host, port, and username MUST NOT be overridable by environment variables, so a misconfigured production environment cannot silently deliver mail to an unintended host. The `RESEND_API_KEY` value MUST NOT be written to logs.

The mail transport's transport-security setting MUST be derived from the configured port rather than hardcoded, so that a TLS-required port is negotiated correctly while a plaintext development port is not.

#### Scenario: Unset provider falls back to the local SMTP transport

- **WHEN** the mail configuration is resolved with no `MAIL_PROVIDER` set
- **THEN** the local SMTP transport is selected, defaulting to host `localhost` on port `1025`, with no authentication

#### Scenario: Production selects the provider's own SMTP endpoint

- **WHEN** the mail configuration is resolved with `MAIL_PROVIDER=resend` and a non-empty `RESEND_API_KEY`
- **THEN** the transport targets the provider's SMTP endpoint on a TLS-required port, authenticated with the provider's designated username and the supplied API key, and the transport-security setting is enabled

#### Scenario: No authentication without a complete credential pair

- **WHEN** the mail configuration is resolved in `smtp` mode and only one of `SMTP_USER` or `SMTP_PASS` is provided
- **THEN** the transport is configured without authentication rather than with a half-filled credential

#### Scenario: Unknown provider value halts the worker

- **WHEN** `MAIL_PROVIDER` holds a value other than `smtp` or `resend`
- **THEN** the worker refuses to start, reports the unrecognized value, and exits with a non-zero status instead of falling back to any default provider

#### Scenario: Missing provider credential halts the worker

- **WHEN** `MAIL_PROVIDER=resend` and `RESEND_API_KEY` is absent or empty
- **THEN** the worker refuses to start, reports the missing credential, and exits with a non-zero status

#### Scenario: Malformed port halts the worker for the active provider only

- **WHEN** the mail configuration is resolved in `smtp` mode and `SMTP_PORT` is set to a non-numeric value
- **THEN** the worker refuses to start and reports that the port must be a number
- **AND WHEN** the same non-numeric `SMTP_PORT` is present while `MAIL_PROVIDER=resend`
- **THEN** the worker starts normally, because that setting is not consulted in `resend` mode

#### Scenario: API-only run mode is unaffected by mail misconfiguration

- **WHEN** the process is started in API-only mode, which never sends email, with an invalid or incomplete mail configuration
- **THEN** the process starts and serves requests normally, since mail configuration is only validated by the worker

#### Scenario: Active provider is reported at worker startup

- **WHEN** the worker starts successfully
- **THEN** it logs which mail provider is active, so the effective configuration is visible in production logs without inspecting environment variables

### Requirement: Demo-mode email recipient restriction

When the system is running in `resend` mode, it SHALL deliver email only to the single recipient address configured in `DEMO_EMAIL`, and SHALL skip delivery for every other recipient. Skipped deliveries MUST be treated as successful outcomes: the job MUST NOT be retried and MUST NOT be recorded as a failure.

This restriction governs delivery only. Email jobs MUST still be enqueued and processed for all users in every mode, so queuing, booking-status checks, and template rendering are unaffected by the restriction.

`DEMO_EMAIL` SHALL be required when running in `resend` mode; its absence SHALL be treated as a configuration error.

Recipient matching against `DEMO_EMAIL` SHALL be case-insensitive and ignore surrounding whitespace, so that a stored address differing in letter case from the configured value still matches.

The restriction MUST NOT apply in `smtp` mode, where the development mail capture server has no delivery quota and every recipient is expected to receive mail.

#### Scenario: The configured demo recipient receives mail

- **WHEN** an email job for a booking owned by the address configured in `DEMO_EMAIL` is processed in `resend` mode
- **THEN** the email is delivered through the configured provider

#### Scenario: Other recipients are skipped

- **WHEN** an email job for a booking owned by any other address is processed in `resend` mode
- **THEN** no mail is transmitted for that recipient and the skip is recorded in worker logs

#### Scenario: A skipped delivery completes successfully

- **WHEN** an email job is skipped because its recipient is not the configured demo address
- **THEN** the job is reported as completed without being retried, and no failure is recorded against it

#### Scenario: Jobs are enqueued for every user regardless of the restriction

- **WHEN** a booking is created by an account whose address is not the configured demo address
- **THEN** an email job is still enqueued for that booking owner and is still processed by the worker, exactly as in the unrestricted mode

#### Scenario: Demo recipient matching ignores letter case

- **WHEN** the demo owner is stored with an address whose letter case differs from `DEMO_EMAIL`
- **THEN** the email is still delivered, rather than being skipped because of a case mismatch

#### Scenario: Missing demo address halts the worker

- **WHEN** `MAIL_PROVIDER=resend` and `DEMO_EMAIL` is absent or empty
- **THEN** the worker refuses to start, reports the missing setting, and exits with a non-zero status rather than delivering to every recipient or no recipient
