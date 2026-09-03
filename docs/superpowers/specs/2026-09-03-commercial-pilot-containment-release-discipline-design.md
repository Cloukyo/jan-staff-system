# Commercial Pilot Containment and Release Discipline Design

## Scope

This milestone limits commercial onboarding to approved pilots, makes the notification worker safe in staging and production, and makes production releases depend on evidence from the same candidate SHA in Commercial Staging. It does not enable paid signup, production email, billing, or a production application deployment.

## Pilot access

- Normalise an applicant email with `trim().toLowerCase()` and calculate a deterministic HMAC-SHA256 digest with a server-only, purpose-specific secret.
- Store only that digest in the database. Do not send the HMAC key to the browser or database.
- Reserve a valid, unexpired, unrevoked, unused grant through one conditional database operation. A second concurrent attempt cannot reserve the same grant.
- Bind the reservation to the newly created Auth user. Failure remains closed.
- Consume the grant in the same transaction that changes `organisations.operational_state` from `pre_live` to `live`.
- Keep the existing guarded Go Live boundary, readiness evaluation, trial transition, audit records, tenant controls, and grants unchanged.
- Keep the gate disabled in local/demo and Commercial Staging unless explicitly enabled. Production activation is an explicit rollout precondition.

## Notification worker

- The cron route exists in both staging and production.
- A missing or invalid worker secret returns a non-disclosing not-found response.
- An authenticated invocation returns a safe no-op while notification delivery is disabled.
- Enabled delivery fails closed when provider configuration is incomplete.
- Staging redirects all recipients to the controlled Resend test recipient. Production uses intended recipients only after production delivery is separately enabled and configured.

## Release lineage

- Commercial `main` is the release-candidate lineage.
- CI verifies the candidate SHA.
- Commercial Staging must expose that exact SHA through health endpoints and pass readiness/liveness checks.
- Migration-ledger and environment-identity checks are prerequisites for production deployment.
- Production builds and deploys the exact approved SHA to its separate Vercel project. Cross-project promotion is not used.

## Operational controls

- Public Production Auth signup is disabled immediately until the gated application and database control are approved for production.
- Application password policy remains twelve-character mixed complexity; Supabase Auth should be aligned without weakening the application.
- CAPTCHA, provider administrator MFA, recovery controls, and production email remain documented manual prerequisites where they cannot be proven or safely enabled programmatically.

