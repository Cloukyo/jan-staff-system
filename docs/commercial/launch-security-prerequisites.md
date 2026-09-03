# Commercial Launch Security Prerequisites

## Programmatically controlled

- Keep Production Auth signup disabled until the pilot migration, database gate, server HMAC secret, approved grants, and gated application are deployed together.
- Keep production transactional email disabled until the domain and provider are configured.
- Keep live billing configuration rejected by application environment validation.
- Require exact-SHA CI, staging health, environment identity, and migration-ledger evidence in the protected production release workflow.

## Manual provider checks

- GitHub organisation and repository administrators: enable MFA, store recovery codes securely, review owners and deploy-capable tokens, protect `main`, and require the CI status checks used by the release workflow.
- Vercel team: enable account MFA, store recovery methods securely, restrict Production project deploy access, configure the `commercial-production` GitHub environment approval, and ensure personal tokens cannot bypass the release workflow.
- Supabase organisation: enable administrator MFA, verify recovery access, review owners, enable SSL enforcement and suitable network restrictions, and decide on PITR before external pilot data.
- Supabase Auth: set minimum password length to 12, enable lowercase/uppercase/digit/symbol requirements if supported, review signup and email rate limits, and enable CAPTCHA only after its production domain and provider keys are ready.

No provider MFA or recovery setting is considered complete until verified in that provider's administrator dashboard.
