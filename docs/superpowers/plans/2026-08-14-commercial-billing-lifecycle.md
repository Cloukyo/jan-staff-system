# Commercial Billing Lifecycle Implementation Plan

**Goal:** Add a Stripe test-mode implementation behind provider-neutral billing contracts while preserving the no-card 60-day trial, tenant visibility, attendance evidence, and the frozen restricted-mode capability matrix.

**Architecture:** Provider-neutral application contracts call a Stripe adapter only at authenticated server boundaries. PostgreSQL remains authoritative for organisation subscription state, entitlement evaluation, idempotency, lifecycle evidence, grace clocks, and tenant fencing. Signed Stripe webhooks are recorded before reconciliation and may only advance state when their provider object timestamp is newer than the last accepted provider revision. A scheduled database reconciler advances expired trials and grace periods using database time.

**Technology:** Next.js App Router and server actions, Zod, Stripe Node SDK, Supabase/PostgreSQL migrations with RLS, pg_cron, Vitest/PGlite, pgTAP.

## 1. Contracts and environment safety

- Add provider-neutral billing status, command, snapshot, webhook, plan-price, and adapter contracts.
- Extend environment validation for provider name, mode, secret key, webhook secret, and environment-specific price configuration.
- Reject live Stripe secrets outside a future explicitly live production configuration; never expose billing secrets through `NEXT_PUBLIC_*`.
- Test parsing, safe return paths, test/live separation, and plan-price selection before implementing adapters.

## 2. Durable billing persistence and lifecycle

- Add provider customer mappings, provider price mappings, checkout intents, webhook ledger, immutable lifecycle events, and provider revision fields.
- Extend subscriptions with paid-period, grace, restricted, cancellation, provider, and over-limit evidence without rewriting trial history.
- Add RLS read policies for `billing.manage`; revoke direct customer writes.
- Add guarded private transition and entitlement-rematerialisation functions.
- Add the 7-day trial conversion grace and 14-day paid failure grace reconciler, scheduled through Supabase Cron when available.
- Keep billing state out of tenant-visibility RLS and enforce offline=false invariants.

## 3. Central capability matrix

- Resolve commercial access mode centrally as setup, full, grace, or restricted.
- Preserve existing-footprint clock-in/clock-out, exception-safe shift starts, attendance correction/review, essential reporting, complete customer export, and billing recovery in restricted mode.
- Block new staff, invitations, sites, kiosks, imports, advanced exports, integrations, and premium mutations in grace/restricted mode exactly as frozen.
- Apply database-side checks at existing growth mutation boundaries; do not add scattered subscription-state checks.

## 4. Stripe test-mode adapter and server boundaries

- Install the official Stripe SDK pinned through the lockfile and use the current supported API version.
- Implement create/reuse customer, hosted Checkout, hosted Billing Portal, retrieve/update/cancel/resume subscription, and webhook verification behind the provider interface.
- Generate provider idempotency keys from durable local intents; never trust client-provided customer, subscription, or price identifiers.
- Validate return URLs against the configured site origin.
- Add AAL2 and `billing.manage` guarded server actions and a raw-body webhook route.

## 5. Webhook reconciliation

- Verify signatures before writes and persist only safe identifiers/status metadata.
- Deduplicate provider event IDs and reconcile duplicate, delayed, and out-of-order events against provider object timestamps.
- Handle Checkout completion, subscription create/update/delete, invoice paid, and invoice payment failure.
- Materialise the selected plan version's entitlements atomically and append immutable lifecycle evidence.

## 6. Billing customer experience

- Add a reusable commercial billing settings page for current plan, trial dates, paid period, grace/restricted warnings, plan selection, payment recovery, portal access, plan changes, and cancellation.
- Surface billing warnings only in owner/billing-authorised post-login administration, never on kiosks.
- Use the established commercial design system with deliberate desktop/mobile layouts, accessible status semantics, visible focus, and non-manipulative copy.

## 7. Verification and Preview

- Run focused contracts, adapter, lifecycle, entitlement, RLS, webhook, attendance-continuity, and offline-invariant tests first.
- Run migration history, PGlite replay, clean Docker Supabase replay, pgTAP, schema lint, TypeScript, ESLint, full Vitest, production build, dependency audit, Gitleaks, browser marker scan, and desktop/mobile visual review.
- Configure and exercise only Stripe test mode on `commercial-dev` and Vercel Preview. If test credentials are absent, report the exact Preview configuration gap without creating or changing secrets.
- Commit as `Commercial Billing Lifecycle`, push only to the existing draft PR branch, wait for CI, and do not deploy Production or access Jan production.
