# Commercial release baseline

17 September 2026. Step 1 of the commercial product completion plan. This work prepares the release mechanism; it does not authorise deployment or migrate either database.

## Reconciled starting point

- Repository: `Cloukyo/sh-workforce-platform`.
- Remote main: `ec6011439fd3b20df5627062a695f44390a42764`.
- Baseline tree: `4fa628dabdbec76678c98662c62b27326541a8eb`.
- The restored `b8822d9` communications checkout has the same tracked tree as that merge. It was moved onto a new local `codex/release-baseline` branch based on the verified main commit.
- The commercial remote is named `commercial-origin`; inherited `origin` points at Jan. Never use an unqualified push from this migrated checkout.
- Existing audit documents and UX artifacts remain untracked and are excluded from this change.
- Connected GitHub repository access works. Local Git/gh authentication is absent. No token was extracted from the connector or stored in the repository.

## Changes

1. All Node/npm release jobs explicitly use Node 24. Checkout/setup-node actions use the same pinned revisions as Commercial CI. The production ancestry check fetches full history.
2. Both deployment workflows verify the named commercial Vercel project, expected project ID and Node 24 build runtime before deploying. A mistakenly configured Jan or opposite-environment project fails before any deployment.
3. Both deployments explicitly request `lhr1`. The shared verifier rejects absent, non-London or mixed runtime regions, rather than accepting London alongside another region.
4. The supplied staging URL must be a plain HTTPS `*.vercel.app` deployment origin. API identity and the immutable deployment hostname are verified before the staging bypass credential is transmitted. HTTP redirects are not followed by those requests.
5. Deployment metadata must identify the expected project, READY state, hostname and exact commit. Conflicting commit evidence or an explicit wrong project cannot be overridden by fallback metadata.
6. Production now checks both liveness and readiness after deployment. Both responses must identify the correct environment and commit; readiness must confirm configuration and Supabase Auth. Production health uses the documented Vercel CLI path plus `--deployment` contract.
7. Provider requests have bounded timeouts. Pre-deployment project responses are stored under `RUNNER_TEMP`, outside the source uploaded to Vercel. Dispatch values and credentials are passed as quoted environment variables rather than inserted into shell source.
8. Existing migration-ledger equality, commercial repository/confirmation gates, separate environment tokens, full build/test/security checks and disabled automatic Git deployment remain intact. No new secret names or dependencies were introduced.

The executable `scripts/verify-commercial-deployment.mjs` has four read-only modes: `url`, `project`, `deployment` and `health`. Tests execute the actual command with fictional provider responses, checking process success/failure and rejection reasons. Workflow contract tests cover runtime setup, gate ordering and invocation of those checks.

## Verified permissions and outstanding account work

| Check | Result |
| --- | --- |
| Connected GitHub account and repository access | Cloukyo; repository read/write/admin permission reported |
| Remote `main` branch state | `protected: false`; required status-check enforcement off |
| Ruleset capability | HTTP 403: GitHub requests a plan upgrade for this private repository |
| Detailed branch-protection read | HTTP 403: integration administration access unavailable |
| GitHub environment reviewers and deployment branch restrictions | Not verified through available connector capabilities |
| Release secret existence and scope | Inventory identified below; dashboard presence/scope not verified |
| Vercel project names and Node runtime | Both commercial projects exist and report Node 24 |

Enforced repository protection remains an account-level prerequisite. Do not equate passing CI with required checks that GitHub prevents an administrator from bypassing. No paid upgrade, repository visibility change, permission change or secret rotation is included in this step.

## Required secret inventory

Check presence, environment scope and least-privilege grants in GitHub settings without displaying or copying secret values. These are the existing workflow contracts, not newly generated credentials.

| Scope used by workflow | Names |
| --- | --- |
| `commercial-staging` jobs | `COMMERCIAL_STAGING_VERCEL_ORG_ID`, `COMMERCIAL_STAGING_VERCEL_PROJECT_ID`, `COMMERCIAL_VERCEL_TOKEN`, `COMMERCIAL_STAGING_AUTOMATION_BYPASS_SECRET` |
| `commercial-production` deployment job | `COMMERCIAL_PRODUCTION_VERCEL_ORG_ID`, `COMMERCIAL_PRODUCTION_VERCEL_PROJECT_ID`, `COMMERCIAL_PRODUCTION_VERCEL_TOKEN`, `COMMERCIAL_RELEASE_GUARD` |
| Migration verification job, which has no environment binding | `COMMERCIAL_STAGING_DATABASE_URL`, `COMMERCIAL_PRODUCTION_DATABASE_URL` must be accessible in that job's repository/organisation scope |

`COMMERCIAL_RELEASE_GUARD` must equal the documented non-secret marker `commercial-only`. The Vercel tokens must support the corresponding project/deployment inspection and deployment operations. The Production token must also support the existing CLI health-verification path. Validate tokens through a non-mutating authenticated check before the first authorised rollout; connector access is not proof that workflow tokens have those permissions.

Known project identities: Staging `prj_okcLVnWgk82NYD908wWuEutNrLo9`; Production `prj_62NdgMmfOIcGyTiQ3XWNAdzdg3ed`; team `team_bWx7wRT3vU7Fdgdz2fksWFM5`.

## Baseline deployment and migration boundary

At the preceding same-day audit, Staging ran `ec60114...` with 81 migrations ending `20260911000235`, in London. Production ran `10b3d9f...` with 73 migrations ending `20260827120000`, in `iad1`. The eight later migrations remain unapplied in Production. The release ledger check will intentionally refuse promotion until a separately reviewed migration operation brings Production into agreement. The new workflow does not apply or repair migrations automatically.

## Verification record

- Focused release verification: 54 tests passed, including executable pre-deployment target rejection and post-deployment health/identity rejection.
- Typecheck: passed.
- ESLint: passed with zero errors and the three existing unrelated navigation warnings.
- Workflow YAML parsing and shell syntax: passed for both workflows.
- Dependency audit: no high/critical advisories; two existing moderate Vitest development advisories remain.
- Full application suite: 197 files, 1,555 tests passed with two workers on the restored PC.
- Production build: passed using the commercial preview configuration and fictional service endpoints.
- No real deployment was run. This step cannot prove the current GitHub environment secrets or provider tokens by a successful release.

## Completion boundary

Engineering changes can be reviewed and tested independently of the account upgrade. Full step-1 operational closure additionally requires verified private-repository protections, environment approval settings and release secret scope. Until those are verified, record the step as engineering prepared with account prerequisites outstanding, not a fully protected production release process.

Reference: [Vercel CLI curl](https://vercel.com/docs/cli/curl) describes using a relative health path with the explicit deployment URL and forwarding curl flags after `--`.
