# Stripe Preview Acceptance and Billing Security Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the Workstream 9 billing security-advisor regression and complete the real Stripe sandbox acceptance flow when authenticated Stripe tooling becomes available.

**Architecture:** Preserve the existing guarded billing snapshot implementation by relocating it to the non-exposed `commercial_api_private` schema. Keep the public Data API contract as a narrow `SECURITY INVOKER` wrapper with authenticated-only execution. Stripe remains isolated to Vercel Preview branch variables and the existing provider adapter/webhook boundary.

**Tech Stack:** PostgreSQL/Supabase migrations and pgTAP, PGlite/Vitest, Next.js, Stripe Checkout/Billing, Vercel Preview.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge or deploy to Production.
- Use only Stripe sandbox/test keys and branch-scoped Vercel Preview variables.
- Do not access or modify Jan production.
- Keep offline attendance disabled and do not provision offline authorisation.
- Do not weaken billing permissions, tenant fencing, AAL2 checks or RLS.
- Do not substitute synthetic provider events for the required real Stripe acceptance.

---

### Task 1: Prove and remediate the billing snapshot advisor finding

**Files:**
- Create: `supabase/migrations/20260814195107_harden_commercial_billing_snapshot.sql`
- Modify: `tests/commercial-billing-lifecycle-schema.test.ts`
- Modify: `supabase/tests/commercial_billing_lifecycle.sql`

**Interfaces:**
- Consumes: `public.commercial_billing_snapshot(uuid)` and its existing permission checks.
- Produces: the same public RPC signature backed by `commercial_api_private.commercial_billing_snapshot(uuid)`.

- [ ] Add failing source and database assertions requiring a public `SECURITY INVOKER` wrapper, a private guarded implementation, no PUBLIC/anon execution and authenticated-only minimum grants.
- [ ] Run focused tests and confirm failure against the current exposed `SECURITY DEFINER` implementation.
- [ ] Generate the migration with `supabase migration new harden_commercial_billing_snapshot`.
- [ ] Move the existing function into `commercial_api_private`, preserve its fixed search path and internal `auth.uid()`/permission validation, then create the fully qualified invoker wrapper.
- [ ] Run focused schema, PGlite and pgTAP tests and verify cross-organisation reads remain denied.
- [ ] Apply only the new migration to `commercial-dev`, query both function definitions/grants, and confirm the billing advisor warning disappears.

### Task 2: Configure isolated Stripe sandbox resources

**Files:**
- No repository files or local secret files.
- Vercel Preview branch variables only.

**Interfaces:**
- Consumes: authenticated Stripe tooling, the branch Preview URL and internal plan keys.
- Produces: test products/prices, a Preview webhook endpoint and branch-scoped `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRICE_MAP_JSON`.

- [ ] Confirm the authenticated Stripe account is in sandbox/test mode before creating anything.
- [ ] Create clearly fictional Standard and Group recurring prices sufficient for conversion, upgrade and downgrade tests.
- [ ] Create the Preview-only webhook endpoint at `/api/billing/stripe/webhook` with only implemented event types and the pinned API version.
- [ ] Add secrets as sensitive Vercel Preview variables scoped to `codex/commercial-production`; never print or persist their values.
- [ ] Redeploy the same branch to Preview and verify environment validation and the billing route.

### Task 3: Execute real provider acceptance and invariants

**Files:**
- No application code unless a reproducible defect is found; any defect follows a new red-green test cycle.

**Interfaces:**
- Consumes: the fictional Preview organisation, hosted Stripe Checkout, signed webhook endpoint and Stripe sandbox time controls.
- Produces: authoritative before/after evidence for lifecycle, tenant, attendance and offline invariants.

- [ ] Capture operational evidence counts and identifiers before billing transitions.
- [ ] Exercise trial, Checkout conversion, duplicate/out-of-order delivery, renewal, payment failure, 14-day grace, restricted mode, recovery, upgrade, over-limit downgrade and cancellation.
- [ ] Independently exercise trial expiry, 7-day conversion grace, restricted mode and grace recovery.
- [ ] Verify browser return/cancel URLs are non-authoritative and signature/cross-customer failures are rejected.
- [ ] Capture after-state and compare every protected operational evidence category plus offline-enabled/authorisation counts.
- [ ] Review all billing states in desktop and mobile Preview UI.

### Task 4: Final verification and checkpoint

**Files:**
- Update: `docs/commercial/billing-lifecycle.md` only if the verified Preview procedure or hardening boundary needs recording.

**Interfaces:**
- Produces: one reviewed Workstream 9 acceptance commit and an exact-SHA Preview/CI report.

- [ ] Run focused billing, entitlement, tenant, identity, onboarding, administration, attendance, payroll, rota/leave, kiosk and RLS tests.
- [ ] Run the complete suite, migration history, PGlite replay, clean Docker replay, pgTAP, schema lint, TypeScript, ESLint, build, dependency audit and sensitive-marker scan.
- [ ] Run Supabase advisors and prove the security-warning count is no worse than the pre-Workstream-9 baseline.
- [ ] Commit as the final Workstream 9 acceptance hardening checkpoint, push only the commercial branch, and wait for CodeQL, Gitleaks, dependency review and Commercial CI.
- [ ] Confirm the Draft PR remains open, Draft and unmerged, Preview is READY, Production is untouched, offline remains disabled and the worktree is clean.
