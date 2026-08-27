# Commercial Environments and Releases

This runbook describes the commercial application environments and release controls. It does not authorise a deployment and must not be configured with Jan production credentials.

## Environment separation

| Environment | `APP_ENV` | `APP_MODE` | Database | Application host |
| --- | --- | --- | --- | --- |
| Local demo | `local` | `demo` | None | `localhost` |
| Local production-style | `local` | `production` | Dedicated local or disposable project | `localhost` |
| Pull-request preview | `preview` | `production` | Commercial preview project | Unique preview host |
| Shared staging | `staging` | `production` | Commercial staging project | Commercial staging host |
| Commercial production | `production` | `production` | Commercial production project | Commercial production host |

Preview and staging must never use the production Supabase project reference or production site host. Production must match both. The startup validator enforces these rules before Next.js starts.

Required non-local variables:

- `APP_ENV`
- `APP_MODE=production`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_PROJECT_REF`
- `PRODUCTION_SUPABASE_PROJECT_REF`
- `PRODUCTION_SITE_HOST`
- one of `VERCEL_GIT_COMMIT_SHA`, `GITHUB_SHA` or `DEPLOYMENT_SHA`

`SUPABASE_SERVICE_ROLE_KEY`, provider tokens and monitoring credentials are server-only. They must never use a `NEXT_PUBLIC_` prefix.

## Local development

1. Install Node.js 24 and npm 11.
2. Copy `.env.example` to `.env.local`.
3. Keep `APP_ENV=local` and `APP_MODE=demo` for the safe browser-only demo.
4. Run `npm ci`.
5. Run `npm run dev`.

For production-style local work, use a local Supabase stack or a disposable commercial project. Set `APP_MODE=production`, its URL, publishable key and matching project reference. Never paste Jan production values into local files.

Local Supabase commands:

```bash
supabase db start
supabase migration list --local
supabase test db supabase/tests --local
supabase db lint --local --level warning
supabase stop
```

## Health and support endpoints

- `GET /api/health/live` confirms that the application process can respond.
- `GET /api/health/ready` validates configuration and, in production mode, checks the configured Supabase Auth health endpoint.

Both endpoints are uncached and report application version, environment and deployment SHA. They do not return keys, tokens or customer data. A load balancer should use liveness for process replacement and readiness for traffic eligibility.

Application responses include `x-request-id`. Preserve this value in support tickets and external monitoring. Structured logs are JSON records created through `src/lib/observability/logging.ts`. A monitoring provider must integrate through `configureErrorReporter` without adding provider calls throughout business code.

## Continuous integration

`Commercial CI` runs locked installation, lint, type checking, the complete Vitest suite and a production-mode preview build. Its migration job starts a clean local Postgres instance, applies every migration, lists migration history, runs pgTAP tests and lints the resulting schema.

`Commercial Security` runs a high-severity npm audit, pull-request dependency review and a pinned Gitleaks scan. `CodeQL` analyses JavaScript and TypeScript on pull requests, commercial branch pushes and weekly schedules.

No workflow receives deployment credentials during ordinary CI.

## Staging promotion

The `Promote Commercial Staging` workflow is manual and accepts an exact 40-character commercial commit SHA.

1. Confirm all required checks pass for the SHA.
2. Confirm the commercial staging environment contains only commercial Vercel and Supabase configuration.
3. Run the workflow with the full SHA, not a mutable branch name.
4. The workflow checks out that SHA, runs tests, pulls staging configuration, builds once and deploys the prebuilt artifact.
5. Record the returned immutable deployment URL.
6. Verify liveness, readiness, login isolation and the current milestone's smoke tests against staging.

The GitHub `commercial-staging` environment should require an authorised reviewer and restrict deployments to the future protected commercial release branch.

## Commercial production release

The `Release Commercial Production` workflow promotes the already-tested staging artifact without rebuilding it. It is deliberately unusable until all of these are configured:

- protected GitHub environment `commercial-production`;
- required reviewers who cannot approve their own deployment;
- `COMMERCIAL_VERCEL_TOKEN` scoped to the separate commercial project;
- `COMMERCIAL_VERCEL_ORG_ID`;
- `COMMERCIAL_VERCEL_PROJECT_ID`; and
- `COMMERCIAL_RELEASE_GUARD=commercial-only`.

Never put Jan's Vercel project ID or token into these names.

The release operator supplies the verified staging URL and SHA and types `RELEASE COMMERCIAL`. The workflow inspects the deployment, confirms its Git SHA and project, then promotes that exact artifact.

For later database workstreams, additive migrations must be applied and verified against commercial staging before application promotion. Production migrations require a separate approved runbook, backup check, migration ledger comparison and stop conditions. Destructive automatic migration rollback is prohibited.

## Rollback

Application rollback re-points the commercial production alias to the previous verified deployment. It does not reverse additive database migrations or delete evidence. Record the prior SHA, failed SHA, reason, diagnostics and final health state.

## Release evidence

Retain:

- source and deployed SHAs;
- CI and security check links;
- dependency audit result;
- migration verification result;
- staging URL and smoke-test result;
- production health responses;
- reviewer identity and release time in Europe/London; and
- rollback decision.
