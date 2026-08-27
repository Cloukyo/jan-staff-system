# Commercial Readiness and Go Live Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive commercial onboarding readiness from authoritative tenant state and provide one idempotent, atomic Go Live command that starts the 60-day trial and unlocks online attendance while offline attendance remains disabled.

**Architecture:** A private database evaluator returns a versioned item catalogue plus a deterministic fingerprint over safety-critical evidence. A guarded public RPC evaluates readiness or performs Go Live under row locks, re-evaluating the fingerprint and workflow revision inside one transaction. Typed server adapters expose only safe results, while the existing onboarding shell renders final review and a compact live landing state.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Next.js App Router server actions, React, TypeScript, Zod, Vitest, PGlite, pgTAP.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge into `main` or deploy to Production.
- Do not connect to or modify Jan production.
- Do not integrate a billing provider.
- Keep offline attendance disabled globally and per device and issue no offline authorisation.
- Preserve immutable attendance evidence and separate correction chains.
- Use UK presentation and Europe/London time while storing authoritative timestamps in UTC.
- Do not use client readiness, browser time, organisation IDs, roles or entitlement decisions as authority.

---

### Task 1: Readiness and Go Live contracts

**Files:**
- Modify: `src/lib/onboarding/contracts.ts`
- Create: `src/lib/onboarding/readiness-contracts.ts`
- Test: `tests/onboarding-readiness-contracts.test.ts`

**Interfaces:**
- Produces `commercialReadinessSnapshotSchema`, `commercialReadinessItemSchema`, `goLivePayloadSchema`, and typed stable blocker/warning keys.
- Extends the bootstrap snapshot with an optional authoritative readiness summary and live summary.

- [ ] Write failing contract tests for strict item shapes, fingerprints, warning acknowledgements, trial dates, and rejection of client-added authority.
- [ ] Run the focused contract test and confirm it fails.
- [ ] Implement the minimal strict Zod contracts and bootstrap response extension.
- [ ] Run the focused contract and existing onboarding contract tests.

### Task 2: Authoritative database evaluator

**Files:**
- Create: `supabase/migrations/<timestamp>_commercial_readiness_go_live.sql`
- Create: `tests/onboarding-readiness-db.test.ts`
- Modify: `supabase/tests/commercial_onboarding.sql`

**Interfaces:**
- Produces private `commercial_onboarding_readiness(session_id, actor_user_id)` and a guarded read RPC.
- Persists immutable readiness evaluation evidence without making snapshots Go Live authority.

- [ ] Write failing database tests for every required blocker, warning and stable fingerprint drift source.
- [ ] Generate the migration with `supabase migration new commercial_readiness_go_live`.
- [ ] Add authoritative joins for owner security, organisation/site settings, subscription/entitlements, staffing, manager coverage, invitations, kiosk/PIN state, attendance safety and offline invariants.
- [ ] Canonically hash safety-critical evidence and centralise blocker/warning classification and repair routes.
- [ ] Add tenant-fenced RLS, append-only evidence and execute grants/revokes.
- [ ] Run focused PGlite/database tests and pgTAP.

### Task 3: Atomic Go Live and attendance activation

**Files:**
- Modify: `supabase/migrations/<timestamp>_commercial_readiness_go_live.sql`
- Modify: `tests/onboarding-readiness-db.test.ts`
- Add or modify focused kiosk/attendance database tests.

**Interfaces:**
- Extends `execute_onboarding_bootstrap_command` for `evaluate_readiness` and `go_live`.
- Returns replay-safe receipt data containing the authoritative readiness fingerprint, trial timestamps and live identifiers.

- [ ] Add failing tests for AAL1, wrong tenant, stale revision/fingerprint, blockers, warning acknowledgement, duplicate/concurrent commands and injected rollback.
- [ ] Implement receipt-first idempotency, per-session/subscription locks, terminal replay, and changed-payload rejection.
- [ ] Recompute readiness in-transaction, transition organisation/session/steps/subscription, preserve ordinary trial identity, refresh central entitlements, and append privacy-safe lifecycle/onboarding/audit events.
- [ ] Use database `clock_timestamp()` once and set `trial_ends_at = trial_started_at + interval '60 days'`.
- [ ] Keep all offline flags false and prove no offline rows or clock events are created.
- [ ] Gate the existing online kiosk attendance RPC on authoritative live/trial/entitlement/device/staff state without changing RLS visibility.
- [ ] Run focused Go Live, attendance tenancy and trial entitlement tests.

### Task 4: Server application boundary

**Files:**
- Create: `src/lib/onboarding/readiness-actions.ts`
- Modify: `src/lib/onboarding/bootstrap-service.ts`
- Modify: `src/lib/onboarding/navigation.ts`
- Test: `tests/onboarding-readiness-service.test.ts`
- Modify: `tests/onboarding-navigation.test.ts`

**Interfaces:**
- Produces `evaluateCommercialReadinessAction` and `goLiveAction` using authenticated AAL2 server boundaries.
- Routes completed live sessions to the live welcome page and incomplete sessions to readiness remediation.

- [ ] Write failing tests for safe parsing, stale state, permission denial, replay, and historical live routing.
- [ ] Implement server-only action adapters and cache revalidation/redirect behaviour.
- [ ] Run focused service and navigation tests.

### Task 5: Final review and live experience

**Files:**
- Create: `src/app/onboarding/readiness/page.tsx`
- Create: `src/app/commercial/welcome/page.tsx`
- Create: `src/components/onboarding/readiness-review.tsx`
- Create: `src/components/onboarding/go-live-confirmation.tsx`
- Create: `src/components/commercial/live-welcome.tsx`
- Modify: `src/components/onboarding/onboarding-shell.tsx`
- Modify: `src/app/platform.css`
- Modify: `src/app/onboarding/next/page.tsx`
- Test: `tests/onboarding-readiness-ui.test.tsx`

**Interfaces:**
- Renders category status, direct repair routes, explicit warning acknowledgement and `Start live attendance`.
- Renders the authoritative trial end date, site, kiosk and staff summary after success.

- [ ] Write failing UI tests for blocker language, non-blocking optional rota/compliance warnings, explicit trial copy, accessible controls and no technical/sensitive content.
- [ ] Implement reusable readiness rows, summary, confirmation and live state in the established calm commercial visual system.
- [ ] Add mobile-first layout, 44px targets, focus/error association and reduced-motion support.
- [ ] Run UI tests and production build.

### Task 6: Verification, Preview and checkpoint

**Files:**
- Modify only test/runbook documentation required by actual verification results.

- [ ] Run focused 7H tests, complete onboarding regression, tenant/site isolation, identity/membership, attendance/payroll tenancy, invitations, kiosk and entitlements.
- [ ] Run migration history, PGlite replay, Docker Supabase replay, pgTAP and schema lint.
- [ ] Run TypeScript, ESLint, full Vitest, production build, dependency audit, Gitleaks and browser sensitive-marker scan.
- [ ] Inspect desktop and mobile pages in the browser and record a five-point fidelity/accessibility ledger.
- [ ] Commit once as `Commercial Readiness and Go Live`.
- [ ] Push only the commercial branch, wait for CodeQL/Gitleaks/CI, and deploy only commercial Preview.
- [ ] Run the documented fictional Preview flow, controlled clock-in/out and offline invariant checks; remove or document retained fictional data.
