# Commercial Operator Security Checklist

Complete this checklist before any external nursery or personal data is introduced. Do not store recovery codes, passwords, tokens or passkey material in the repository.

## GitHub administration

- **MANUAL VERIFICATION REQUIRED:** enable account MFA, preferably two phishing-resistant passkeys or a passkey plus authenticator.
- Store recovery codes in an encrypted password manager with an offline recovery copy.
- Confirm the recovery email and devices are current.
- Review organisation owners, repository administrators, deploy-capable tokens and active sessions.
- Move the private repository to a plan that enforces the documented `main` ruleset and protected `commercial-production` environment.
- Add a second trusted administrator to avoid single-person lockout. Give repository administration only; do not grant billing or unrelated organisation ownership unless needed.

## Vercel administration

- **MANUAL VERIFICATION REQUIRED:** enable account MFA/passkey and confirm recovery methods.
- Review team owners, Production deploy access, access tokens and active sessions.
- Require a second trusted reviewer for Commercial Production promotion when the plan supports protected environments.
- Give the second administrator the smallest team/project role that can recover the Production project and environment configuration.
- Configure usage notifications and a pilot spend threshold in team Billing settings.

## Supabase organisation administration

- **MANUAL VERIFICATION REQUIRED:** enable account MFA/passkey and confirm recovery methods for every organisation owner.
- Review organisation owners, project access tokens and database credentials.
- Add a second trusted administrator with access to the commercial organisation and recovery operations, but not unrelated Jan infrastructure.
- Confirm the latest scheduled Commercial Production backup and retention in **Database > Backups**.
- Decide and approve PITR plus Small compute separately; record the monthly cost and owner.
- Test Staging SSL enforcement before Production and document approved migration/emergency database clients.

## Shared recovery discipline

- Keep provider recovery material in a business-owned encrypted password manager rather than a personal browser or repository.
- Require two people for Production database restore, migration-history repair, release, billing activation and domain/DNS changes.
- Review administrators, recovery contacts, tokens and billing alerts quarterly and after any role change.
