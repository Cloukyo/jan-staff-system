# Commercial Platform Baseline

**Frozen on:** 8 August 2026  
**Branch:** `codex/commercial-production`  
**Verified implementation SHA:** `03f23ef9f945bf9fda39e3b76884b84957916ead`  
**Draft pull request:** [Commercial Platform Foundation](https://github.com/Cloukyo/jan-staff-system/pull/8)

## Purpose

This document records the verified commercial platform checkpoint after Workstreams 1 through 6. It does not change the approved architecture, begin customer-facing implementation, authorise a merge to `main`, or authorise any deployment.

## Completed workstreams

1. **Workstream 1, Commercial Foundation**
   - Security headers, environment validation, CI and security scanning, structured logging hooks, correlation IDs, health and readiness endpoints, version reporting, and release documentation.
2. **Workstream 1.5, Core Platform Neutralisation**
   - Neutral core terminology and configurable industry presentation, with the nursery compatibility profile retained.
3. **Workstream 2, Tenant Primitives**
   - Organisation and site primitives, membership and site-access foundations, permission helpers, and isolation tests.
4. **Workstream 3, Identity and Membership Conversion**
   - Commercial identity resolution, organisation memberships, site access, active-organisation selection, and legacy compatibility.
5. **Workstream 4, Customer Domain Conversion**
   - Organisation and site ownership for staff, compliance, settings, work areas, imports, and site operations, with compatibility adapters retained.
6. **Workstream 5, Attendance Tenancy**
   - Organisation and site ownership for attendance workflows while preserving immutable clock evidence, separate correction chains, and legacy compatibility.
7. **Workstream 6, Payroll and Reporting Tenancy**
   - Organisation-owned payroll preparation, reporting, adjustments, approvals, imports, exports, and tenant-isolation controls. The platform remains pay-preparation software and does not calculate statutory payroll deductions or payslips.

## Database state

- The repository contains **44 ordered SQL migrations**.
- A clean Docker-backed Supabase instance applies every migration successfully.
- Local migration history matches the repository migration set.
- All three SQL database contract files emit valid pgTAP output and pass.
- Database schema lint passes at error severity.
- The latest additive migration corrects PL/pgSQL analyser ambiguity and enum resolution without editing recorded migrations.
- Commercial shared-schema tenant ownership, RLS, trusted RPC validation, and compatibility paths are present through Workstream 6.
- No onboarding, billing, entitlement, Jan backfill, commercial deployment, or production migration has been performed.

## Verification baseline

| Verification | Result |
| --- | --- |
| Install from lockfile | Passed |
| ESLint | Passed with 0 errors and 3 existing navigation warnings |
| TypeScript typecheck | Passed |
| Vitest | 101 files, 891 tests passed |
| Production build | Passed |
| Migration-history verification | Passed |
| Clean Docker-backed Supabase replay | Passed, 44 migrations |
| pgTAP database contracts | Passed, 3 files |
| Database schema lint | Passed |
| CodeQL | Passed |
| Gitleaks | Passed |
| Dependency audit | Passed with 0 known vulnerabilities |
| Dependency change review | Passed |
| Browser sensitive-marker scan | Passed |
| Commercial demo-data safety test | Passed |

The verified GitHub workflow runs correspond to implementation SHA `03f23ef9f945bf9fda39e3b76884b84957916ead`.

## Data-safety state

- The commercial branch tip contains clearly fictional compliance demo identities.
- None of the prior staff identity values remain in the commercial branch's current tracked tree.
- `.gitleaks.toml` retains only the narrow path-and-value allowance required for fictional UUID idempotency fixtures.
- The full-history secret scan reports no secrets.
- The base branch and inherited Git history still contain the former demo identity values. Consequently, the draft PR can display those values as removed lines. Removing them from repository history requires a separately authorised repository-wide remediation and is not part of this checkpoint.
- No environment file, production credential, Jan production project reference, temporary log, or debug artifact is included in the commercial branch tip.

## Compatibility and operational state

- Jan production was not connected to or modified during commercial work.
- No production or commercial deployment occurred.
- The branch has not been merged into `main`.
- Offline attendance remains disabled and was not enabled by any commercial workstream.
- Existing Jan compatibility paths remain in place for staged migration work.
- Attendance evidence remains immutable, and manager corrections remain separate from original clock events.

## Remaining roadmap

1. **Workstream 7, Commercial Onboarding Implementation**
2. **Workstream 8, Billing & Entitlements**
3. **Workstream 9, Jan Migration Rehearsal**
4. **Workstream 10, Commercial Pilot**

No additional workstream is introduced by this baseline.

## Workstream 7 boundary

Workstream 7 implements the separately approved onboarding and Go Live specification. It begins with **Phase 1, Workflow Foundations**.

The exact first task is to define the versioned workflow, step, command, event, and readiness contracts. Only after those contracts and their tests are established may implementation add onboarding sessions, step state, append-only onboarding events, command receipts, tenant fences, idempotency, optimistic concurrency, and safe event metadata validation.

Workstream 7 must not silently expand into billing implementation, Jan migration, production deployment, offline attendance enablement, or changes to the frozen tenancy and attendance architecture.

## Checkpoint conclusion

The current commercial branch tip is a verified development baseline for Workstream 7, subject to the explicit inherited-history data caveat above. The draft PR must remain Draft. No merge or deployment is authorised by this document.
