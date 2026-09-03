# Commercial Environments and Releases

## Environment identities

- Commercial Staging uses its dedicated Supabase and Vercel projects. It must never use the Commercial Production Supabase reference or production site host.
- Commercial Production uses its dedicated Supabase and Vercel projects. Environment validation rejects a mismatched project reference or host.
- Jan Production is a separate product lineage and infrastructure set. Commercial workflows must never target it.

Provider identifiers and secrets belong in protected environment configuration, not this document.

## Release lineage

Commercial `main` is the authoritative release-candidate lineage. A candidate is identified by its full commit SHA. Feature or maintenance branches are integrated into `main` without rewriting or discarding commercial history.

The normal sequence is:

1. CI passes on the exact SHA at commercial `main`.
2. `.github/workflows/promote-staging.yml` deploys that exact SHA to the separate Commercial Staging Vercel project.
3. Staging liveness and readiness report `environment=staging`, `ok=true`, and the exact candidate SHA.
4. Staging database migrations are applied and verified using the documented staging-only process.
5. A production review confirms both remote migration ledgers and environment identities.
6. `.github/workflows/release.yml` independently verifies the candidate, staging deployment metadata, health evidence, and both ledgers.
7. After protected-environment approval, the workflow builds and deploys that exact SHA to the separate Commercial Production project.

Cross-project `vercel promote` is not a valid release path. Production is rebuilt from the exact reviewed commit after staging evidence has passed.

## Required protected secrets

- Commercial Staging: dedicated Vercel token, organisation ID, project ID, and database URL.
- Commercial Production: dedicated Vercel token, organisation ID, project ID, and database URL.
- `COMMERCIAL_RELEASE_GUARD=commercial-only` in the protected Production environment.

Tokens must be scoped as narrowly as the providers allow. Repository administrators must protect `main`, require CI, restrict workflow modification, and require approval for the `commercial-production` environment.

## Pilot rollout ordering

Production public Auth signup remains disabled while the pilot release is prepared. A future controlled pilot rollout must apply the pilot-access migration, enable the database gate, configure the server-only HMAC secret and approved grants, deploy the gated application through the release workflow, verify the exact SHA, and only then re-enable provider signup.

Production email delivery and live billing remain disabled until their later milestones are separately reviewed.
