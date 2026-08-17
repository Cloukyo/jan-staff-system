# Workstream 9.5 Independent Staging Closure Pass Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close only the remaining independent-commercial-staging acceptance blockers with reproducible application, provider, database, security, deployment, and visual evidence.

**Architecture:** Keep the independent commercial repository, Supabase Staging project, Vercel staging project, and Stripe sandbox as separate trust boundaries. Route every operational mutation through the existing server-authoritative services and RPCs. Fix only proven closure defects, preserve immutable attendance and payroll evidence, and require environment validation to prevent staging from acquiring Production authority.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/PostgreSQL/RLS/pgTAP, Stripe Checkout/Billing sandbox, Vercel Preview/staging, Vitest/PGlite, Playwright.

## Global constraints

- Remain in `Cloukyo/sh-workforce-platform` on `codex/commercial-production`; do not merge or begin Workstream 10.
- Never access or modify Jan Production and never create Commercial Production.
- Keep offline attendance and offline authorisation disabled.
- Use only fictional staging identities and Stripe sandbox resources.
- Never print, log, copy into chat, or commit any credential.
- Capture before/after evidence fingerprints and preserve historical attendance, correction, rota, leave, payroll, site, and device evidence.

### Task 1: Establish exact baseline and root causes

**Files:**
- Inspect: `docs/commercial/repository-environment-separation.md`
- Inspect: `src/components/commercial-admin/commercial-admin-page.tsx`
- Inspect: `src/components/billing/billing-page.tsx`
- Inspect: `src/lib/commercial-identity/*`
- Inspect: current Supabase functions, grants, RLS, advisors, Vercel project/deployments, and Stripe sandbox mappings.

- [x] Record current repository and deployed staging SHAs and prove the delta is documentation-only.
- [x] Record staging evidence counts/fingerprints and offline counts before writes.
- [x] Reproduce unauthenticated `/admin` HTTP 500 and identify the unhandled identity exception.
- [x] Inventory advisor categories and live grants without changing the database.
- [ ] Record current Vercel Git/deployment authority, aliases, and environment scopes.

### Task 2: Repair protected administration-route recovery

**Files:**
- Create/Modify: focused commercial identity route-recovery module under `src/lib/commercial-identity/`
- Modify: `src/components/commercial-admin/commercial-admin-page.tsx`
- Modify: `src/components/billing/billing-page.tsx`
- Modify: `src/lib/commercial-identity/preference.ts`
- Create/Modify: focused route regression tests in `tests/`

- [ ] Write failing behavioural tests for unauthenticated, expired preference, invalid preference, stale/revoked membership, permission denial, and authorised access.
- [ ] Run the focused tests and observe the expected failure.
- [ ] Implement the smallest shared safe redirect/not-found boundary without leaking internal errors.
- [ ] Audit every `/admin` route using the shared admin or billing loaders.
- [ ] Run focused route and identity tests and verify unauthenticated staging behaviour is no longer HTTP 500.

### Task 3: Disposition and remediate Supabase advisor findings

**Files:**
- Create: one generated Supabase hardening migration if Category A defects require DDL/grant changes.
- Create: `docs/commercial/supabase-security-advisor-disposition.json`
- Create/Modify: focused RLS/grants and pgTAP tests.

- [ ] Classify every advisor warning into pilot-blocking, intentionally guarded, or legacy compatibility.
- [ ] Trace anonymous/authenticated execution grants, fixed search paths, internal auth checks, tenant fences, and tests for each retained function group.
- [ ] Write failing tests for each confirmed Category A issue before changing grants or policies.
- [ ] Apply only narrowly justified fixes to the repository migration, local replay, and independent Staging.
- [ ] Rerun security and performance advisors and record before/after counts plus residual rationale.
- [ ] Confirm there is no exploitable Critical/Important commercial security issue.

### Task 4: Close operational workflow blockers through real boundaries

**Files:**
- No code by default; any discovered defect receives a focused red-green test and minimal fix.

- [ ] Transfer a fictional staff member from Site A to Site B through the post-live application/server command and verify effective dating and historical attribution.
- [ ] Exercise Site A manager denials against Site B administration, assignment, rota, leave, payroll, and kiosk boundaries; verify an authorised organisation-wide actor where safe.
- [ ] Register, activate, revoke, and replace a fictional online kiosk through supported device-management workflows; prove old credential invalidity, replacement validity, site binding, retained audit history, and zero offline authority.

### Task 5: Complete genuine Stripe sandbox acceptance

**Files:**
- No repository files unless a reproducible application defect is found.

- [ ] Verify the connected Stripe account and every resource used has `livemode=false` before provider writes.
- [ ] Prepare one fictional staging organisation with no duplicate provider subscription and an official test-clock-capable customer where supported.
- [ ] Start Checkout from the real application, observe the Stripe-hosted page, complete with an official test payment method, and prove the browser return is non-authoritative until a signed webhook arrives.
- [ ] Verify paid state, provider mappings, trial history, uniqueness, and operational evidence invariants.
- [ ] Use official Stripe sandbox simulation/test clocks/test payment methods for genuine failure, fixed grace, restriction, and recovery when supported; otherwise record the exact provider limitation without synthetic-provider claims.

### Task 6: Remove staging Production authority and align exact SHA

**Files:**
- Modify only staging-safe repository or Vercel configuration proven necessary.
- Update: `docs/commercial/repository-environment-separation.md`

- [ ] Preserve the historical failed Production-target deployment record while removing future staging Production authority, aliases, Production variables, and Production Git promotion.
- [ ] Prove `APP_ENV=staging` fails closed against Production identity.
- [ ] Commit and push the closure changes to the independent commercial repository only.
- [ ] Deploy current commercial `main` to Vercel staging without granting Production authority.
- [ ] Verify `/api/health`, `/api/ready`, and version reporting match the exact commercial main SHA.

### Task 7: Authenticated responsive acceptance and full staging smoke

**Files:**
- No code by default; acceptance-blocking defects follow focused red-green fixes.

- [ ] Inspect authenticated desktop (about 1440px), tablet, and 390px mobile views for the required operational and administration routes.
- [ ] Exercise navigation, site context, overflow, tables, touch targets, focus, errors, empty/loading states, destructive confirmation, and permission denial.
- [ ] Run the retained fictional tenant smoke across authentication, organisation, sites, staff, assignments, permissions, online kiosk, attendance, correction, rota, leave, planned/actual, payroll, billing, administration, and tenant isolation.
- [ ] Record non-blocking usability improvements separately without redesigning the application.

### Task 8: Final verification and closure report

**Files:**
- Create: `docs/commercial/workstream-9-5-closure-report.md`

- [ ] Compare all before/after evidence counts and fingerprints and prove offline counts remain zero.
- [ ] Run the focused regression, isolation, admin, attendance, payroll, rota/leave, kiosk, billing, RLS/grants, and authentication tests.
- [ ] Run the full suite, migration history, PGlite replay, clean Docker Supabase replay, pgTAP, schema lint, TypeScript, ESLint, build, dependency audit, browser marker scan, CodeQL/SARIF, Gitleaks, dependency review, CI, and staging smoke.
- [ ] Report resource-contention timeouts separately from assertion failures, using independent files and clean CI as corroboration where applicable.
- [ ] Confirm Jan Production remained untouched, no Commercial Production exists, offline stayed disabled, and Workstream 10 did not begin.
- [ ] Leave old PR #8, `commercial-dev`, old Preview resources, and secrets unchanged; provide cleanup recommendations requiring fresh explicit approval.
