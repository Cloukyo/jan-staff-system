# Commercial Trial and Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add provider-neutral plan selection, one durable no-card `trial_pending` subscription, authoritative initial entitlements, and resumable onboarding without starting the 60-day trial clock.

**Architecture:** Extend the existing version-1 commercial onboarding contract and guarded transaction RPC with a strict `select_plan` command. PostgreSQL owns catalogue eligibility, owner/AAL2 permission checks, one-trial history, subscription state, entitlement materialisation, usage-aware capability decisions, idempotency, workflow revision, and atomic completion; Next.js only validates for usability and renders the authoritative snapshot. Entitlements remain a commercial decision layer and are never added to tenant RLS predicates.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Supabase Auth/Postgres/RLS/RPC, PGlite, pgTAP, Vitest.

## Global Constraints

- Work only on `codex/commercial-production` from verified SHA `7b90b1aa113c46e37867b82185c9175fdbee1194`.
- Apply only to Supabase Preview `commercial-dev` (`perxeotveoxjibkcybnq`) and deploy only Vercel Preview.
- Keep Draft PR #8 unmerged and do not modify `main` or Jan production.
- Do not add staffing, invitations, kiosk registration, readiness, Go Live, payment collection, provider integration, webhooks, grace transitions, restricted-mode transitions, or Workstream 7D functionality.
- The ordinary trial is 60 consecutive calendar days but remains `trial_pending`; `trial_started_at` and `trial_ends_at` must remain null until the future atomic Go Live command.
- No payment details are collected or stored.
- Offline attendance and offline authorisation remain disabled regardless of plan data.
- Billing and entitlements must never control tenant identity, organisation/site RLS visibility, or attendance evidence.
- Use fictional, explicitly Preview-labelled catalogue data and no final commercial pricing.

---

### Task 1: Versioned plan, subscription and capability contracts

**Files:**
- Modify: `src/lib/onboarding/contracts.ts`
- Create: `src/lib/commercial/entitlements.ts`
- Modify: `tests/onboarding-contracts.test.ts`
- Create: `tests/commercial-entitlements.test.ts`

**Interfaces:**
- Produces strict schemas for plan catalogue entries, entitlement values, `trial_pending` subscription summaries, `select_plan` payloads and capability decisions.
- Extends `onboardingBootstrapStepKeySchema` with `subscription` and the bootstrap snapshot with an authoritative plan catalogue and subscription summary.
- Adds `select_plan` to the available bootstrap command parser without accepting organisation IDs, entitlement values, prices, provider IDs or payment fields.
- Produces `evaluateCapabilityDecision(input)` and `requireCapabilityDecision(input)` as pure typed decision adapters over authoritative database results.

- [ ] Add failing contract tests for active/inactive plan presentation, strict payload keys, unsupported plans, client-supplied entitlements, provider fields, trial timestamps, offline flags and safe subscription summaries.
- [ ] Add failing pure capability tests for boolean grants, integer limits, usage boundaries, missing subscription, unknown capability, offline denial and the rule that a capability decision does not convey tenant access.
- [ ] Run `npx vitest run tests/onboarding-contracts.test.ts tests/commercial-entitlements.test.ts` and confirm the new assertions fail for missing contracts.
- [ ] Implement exact Zod contracts and typed decision adapters with stable codes: `allowed`, `not_entitled`, `limit_reached`, `subscription_required`, `subscription_not_eligible`, and `offline_disabled`.
- [ ] Re-run the focused tests until they pass.

### Task 2: Provider-neutral catalogue, trial and entitlement persistence

**Files:**
- Create with `npx supabase migration new commercial_trial_entitlements`: `supabase/migrations/20260813005555_commercial_trial_entitlements.sql`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Create: `tests/onboarding-trial-entitlements-db.test.ts`
- Modify: `supabase/tests/onboarding_bootstrap.sql`

**Interfaces:**
- Adds versioned `plans`, `plan_entitlements`, `organisation_subscriptions`, `organisation_entitlements`, and `organisation_usage` tables.
- Seeds one active, unpriced, fictional `preview_standard` plan version for `GB`; inactive plans remain unavailable.
- Enforces one current subscription and one ordinary initial-trial history per organisation.
- Enforces `trial_pending` with null `trial_started_at` and `trial_ends_at`, organisation-scoped composite foreign keys, typed entitlement values, non-negative usage and immutable historical trial identity.
- Defers `billing_webhook_events` because 7C makes no provider call; the provider-neutral subscription fields remain ready for the later billing integration.

- [ ] Generate the migration through the installed Supabase CLI and record its exact generated filename in this plan before implementation continues.
- [ ] Write failing PGlite tests for catalogue status/versioning, one current subscription, one initial trial, timestamp checks, composite tenant fences, entitlement/source integrity, direct-write denial, RLS isolation and immutable trial history.
- [ ] Run the focused PGlite test and confirm it fails before the migration is implemented.
- [ ] Implement additive enums/tables/indexes/checks using explicit composite foreign keys and no destructive changes to previous migrations.
- [ ] Materialise plan entitlements into organisation entitlements inside the guarded command transaction; use stable keys for active site, active staff, privileged membership, storage, exports/API/features, core attendance and offline attendance.
- [ ] Seed `preview_standard` without a final price and assert `offline.attendance = false` at both plan and organisation layers.
- [ ] Enable RLS. Allow active authenticated members with `billing.manage` to read their organisation subscription and entitlement state; allow catalogue discovery only through the guarded snapshot; deny all direct authenticated mutations.
- [ ] Add pgTAP assertions for RLS, grants, `PUBLIC` execute revocation, fixed search paths, owner-only reads, cross-organisation denial, direct tampering denial and offline invariants.
- [ ] Run focused PGlite and pgTAP-compatible tests until green.

### Task 3: Atomic trial selection and capability database boundary

**Files:**
- Modify: `supabase/migrations/20260813005555_commercial_trial_entitlements.sql`
- Modify: `tests/onboarding-trial-entitlements-db.test.ts`
- Modify: `supabase/tests/onboarding_bootstrap.sql`

**Interfaces:**
- Extends `private.commercial_onboarding_snapshot(session_id)` and `public.get_or_create_onboarding_bootstrap()` with the fifth step, active catalogue and authoritative subscription summary.
- Extends `public.execute_onboarding_bootstrap_command(jsonb)` for `select_plan` while preserving prior 7A/7B commands through a private frozen predecessor.
- Adds `private.commercial_capability_decision(organisation_id, capability_key, context)` and a narrow authenticated read boundary that still verifies active membership.
- `select_plan` accepts only `{ planKey, planVersion, selection: "free_trial" }`.

- [ ] Add failing database tests for owner/AAL2 success, AAL1 denial, site-manager/staff/suspended-member denial, wrong-session organisation denial, inactive/unknown plan denial and strict payload rejection.
- [ ] Add failing tests for the all-or-none creation of subscription, entitlements, events, completed step and advanced session revision.
- [ ] Add failing tests for double-click, same-key replay, changed-key payload rejection, lost-response replay, stale revision, simultaneous tabs, one ordinary trial, and failed-transaction rollback.
- [ ] Add failing capability tests for site/staff/privileged-user limits, feature flags, usage boundaries, offline denial, cross-organisation denial and unchanged organisation visibility when a capability is denied.
- [ ] Implement owner membership plus `billing.manage`, AAL2, first-site prerequisite, plan eligibility, trial eligibility, idempotency and expected-revision checks inside the guarded transaction.
- [ ] Atomically create the `trial_pending` subscription, materialise authoritative entitlements, append privacy-safe `plan_selected`, `trial_selected`, `trial_pending_created`, and `subscription_step_completed` events, complete the step and advance the workflow exactly once.
- [ ] Ensure terminal receipt replay returns the stored historical result with the current authoritative snapshot, including after later workflow revisions.
- [ ] Call the central capability decision inside the new commercial mutation boundary to verify materialised core attendance and offline decisions without granting tenant access or converting unrelated product functions.
- [ ] Re-run focused database and pgTAP tests until green.

### Task 4: Server service, actions and authoritative routing

**Files:**
- Modify: `src/lib/onboarding/bootstrap-service.ts`
- Modify: `src/lib/onboarding/actions.ts`
- Modify: `src/lib/onboarding/navigation.ts`
- Modify: `tests/onboarding-bootstrap-service.test.ts`
- Modify: `tests/onboarding-navigation.test.ts`
- Create: `tests/onboarding-trial-service.test.ts`

**Interfaces:**
- Allows the strict `select_plan` envelope through the existing RPC adapter.
- Produces `startFreeTrialAction` with server-side identity/AAL2 checks, preserved form state and typed safe errors.
- Routes a completed first site to `/onboarding/plan`; a completed subscription step routes to `/onboarding/next`, where staffing is shown only as upcoming.

- [ ] Add failing service tests for valid selection, invalid plan, client entitlement injection, MFA failure, permission failure, stale revision, duplicate replay and authoritative snapshot parsing.
- [ ] Add failing navigation tests for first-site-to-plan, subscription resume, completed subscription, refresh/logout resume and stale-tab reload routes.
- [ ] Extend the server command allowlist and parse the exact authoritative response.
- [ ] Implement `startFreeTrialAction` without accepting organisation, subscription, entitlement, price, provider or trial timestamp authority from the browser.
- [ ] Return accessible retry copy that distinguishes `not_saved`, replayed success and `workflow_changed`.
- [ ] Run the focused service and navigation tests until green.

### Task 5: Reusable commercial plan-selection UI

**Files:**
- Modify: `src/components/onboarding/onboarding-shell.tsx`
- Create: `src/components/onboarding/plan-selection-form.tsx`
- Create: `src/app/onboarding/plan/page.tsx`
- Modify: `src/app/onboarding/next/page.tsx`
- Modify: `src/app/platform.css`
- Create: `tests/onboarding-plan-ui.test.tsx`

**Interfaces:**
- Adds the fifth visible onboarding milestone using the existing desktop sidebar and mobile progress header.
- Renders only server-returned active plans and entitlements.
- Presents plan name, concise capability summary, 60-day duration, no-card requirement, Go Live start point, setup-before-trial explanation, Save and exit, safe loading/duplicate-submit prevention and accessible recovery state.

- [ ] Add failing UI/source-contract tests for neutral wording, Preview pricing status, no-card copy, Go Live trial start, no countdown/dark patterns, 44px controls, progress semantics, loading state, error announcement and absence of nursery/provider/payment wording.
- [ ] Implement the plan page and reusable selection card with one clear primary action: `Start free trial`.
- [ ] Use an ordinary form submit and `useActionState` pending state to disable duplicate submission; do not place entitlement inputs in the DOM.
- [ ] Preserve the existing onboarding visual language, responsive breakpoints, visible focus states, reduced-motion behaviour and screen-reader labels.
- [ ] Replace the 7B placeholder with an authoritative `trial_pending` success summary and a disabled/upcoming staffing step.
- [ ] Run UI tests, typecheck and ESLint until green.

### Task 6: Full verification, review and commercial Preview release

**Files:**
- Verify all files above; add no later-workstream functionality.

- [ ] Run focused 7C contracts, entitlement, database, service, navigation and UI tests.
- [ ] Run all 7A/7B onboarding, identity/membership, tenant isolation, attendance, payroll and offline-disabled regressions.
- [ ] Run `npm test`, migration-history verification, PGlite replay, `npm run typecheck`, `npm run lint`, `npm run build`, dependency audit and browser sensitive-marker scan.
- [ ] Run Gitleaks and changed-file personal/Jan marker scans if fixtures or configuration changed.
- [ ] Perform deliberate desktop and 390px mobile inspection of plan selection, pending, error, replay and success states. Check hierarchy, overflow, keyboard order, focus, screen-reader structure and 44px targets.
- [ ] Request independent code review and fix every Critical or Important finding before committing.
- [ ] Commit once as `Commercial Trial and Entitlements`.
- [ ] Push only `codex/commercial-production` to Draft PR #8 and apply the single new migration only to Supabase Preview `perxeotveoxjibkcybnq`.
- [ ] Wait for Commercial CI, Docker-backed replay, pgTAP, schema lint, CodeQL, Gitleaks, dependency audit/review and Vercel Preview to pass.
- [ ] Confirm Preview subscription state is `trial_pending`, both trial timestamps are null, offline remains false, Draft PR #8 is open/unmerged, local/remote are `0/0`, the worktree is clean, and Jan production was untouched.
