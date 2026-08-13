# Commercial First Site Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the guarded, atomic and resumable first-site milestone to the existing commercial onboarding workflow without beginning subscription, staffing, kiosk or Go Live work.

**Architecture:** Extend the existing version-1 onboarding bootstrap contract and guarded `execute_onboarding_bootstrap_command` RPC with `create_first_site` and safe draft persistence. The database remains authoritative for identity, AAL2, organisation ownership, owner membership, idempotency, revision control, site defaults, access grants and progress; the Next.js layer validates for usability and renders the authoritative snapshot through the reusable 7A onboarding shell.

**Tech Stack:** Next.js 16 App Router, TypeScript, Zod, Supabase Auth/Postgres/RLS/RPC, PGlite, pgTAP, Vitest, Playwright.

## Global Constraints

- Work only on `codex/commercial-production` from baseline `25f3398bc29a92716ce363d79dfcfe3bae6f73f1`.
- Apply and deploy only to Supabase Preview `commercial-dev` (`perxeotveoxjibkcybnq`) and Vercel Preview.
- Do not modify Jan production, merge into `main`, deploy Vercel Production, enable offline attendance, or begin Workstream 7C.
- Preserve organisation and composite site tenancy fences, immutable events, idempotency receipts and expected workflow revisions.
- Use neutral Site, Work week, Operating hours and Work area wording.
- Do not create subscription, staff, invitation, kiosk, billing, readiness or Go Live functionality.

---

### Task 1: Versioned first-site contracts

**Files:**
- Modify: `src/lib/onboarding/contracts.ts`
- Modify: `tests/onboarding-contracts.test.ts`

**Interfaces:**
- Produces `firstSitePayloadSchema`, `saveFirstSiteDraftPayloadSchema`, and a 7B snapshot containing the authoritative first-site step and created-site summary.
- Extends `onboardingBootstrapCommandSchema` to parse only the exact payload for `create_first_site` and `save_step_draft` when `stepKey` is `first_site`.

- [ ] Add failing tests for valid fields, unsupported timezones, malformed/overlapping hours, operational boundaries, strict unknown-key rejection and privacy-safe draft data.
- [ ] Run the focused contract test and confirm the new assertions fail.
- [ ] Implement strict Zod schemas and typed exports with `Europe/London`, Monday and conservative day-boundary defaults.
- [ ] Run the focused contract tests and confirm they pass.

### Task 2: Database transaction, defaults and tenant security

**Files:**
- Create: `supabase/migrations/<generated>_commercial_first_site_onboarding.sql`
- Create: `tests/onboarding-first-site-db.test.ts`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Create: `supabase/tests/onboarding_first_site.sql`

**Interfaces:**
- Extends `public.get_or_create_onboarding_bootstrap()` to return first-site draft and site summary.
- Extends `public.execute_onboarding_bootstrap_command(jsonb)` for `save_step_draft` and `create_first_site`.
- Returns typed result codes including `workflow_changed`, `mfa_required`, `owner_membership_required`, `invalid_site_details`, `idempotency_key_reused`, and `first_site_created`.

- [ ] Generate the migration filename with the installed Supabase CLI.
- [ ] Write failing PGlite tests for all preconditions, validation, atomicity, idempotency, duplicate prevention, tenant isolation, owner access, safe events and resume state.
- [ ] Run the PGlite tests and confirm they fail before migration implementation.
- [ ] Add additive constraints/configuration needed for structured opening hours and operational-day settings without weakening existing RLS.
- [ ] Implement private validation/snapshot helpers and the authenticated guarded transaction with explicit revokes/grants.
- [ ] Atomically insert the site, inherited defaults, active owner site access, safe events and completed step/session revisions.
- [ ] Implement safe draft persistence containing only approved site form fields and field validation codes.
- [ ] Add pgTAP assertions for grants, direct-write denial, RLS isolation, offline-disabled defaults and cross-organisation composite fences.
- [ ] Run focused PGlite and pgTAP-compatible tests until green.

### Task 3: Server application boundary and authoritative routing

**Files:**
- Modify: `src/lib/onboarding/bootstrap-service.ts`
- Modify: `src/lib/onboarding/server.ts`
- Modify: `src/lib/onboarding/actions.ts`
- Modify: `src/lib/onboarding/navigation.ts`
- Modify: `tests/onboarding-bootstrap-service.test.ts`
- Modify: `tests/onboarding-navigation.test.ts`

**Interfaces:**
- Produces `saveFirstSiteDraftAction` and `createFirstSiteAction` using the existing authenticated Supabase server client.
- Routes incomplete organisations to `/onboarding/first-site` and completed first-site sessions to `/onboarding/next`.

- [ ] Add failing service and navigation tests for first-site commands, stale revisions, preserved values, typed MFA/member failures, reload routing and completed-step routing.
- [ ] Extend the command adapter allowlist and strict authoritative response validation.
- [ ] Implement server actions that never accept organisation, membership or role identifiers from the browser.
- [ ] Return linked field errors and explicit saved/not-saved copy.
- [ ] Run focused service/navigation tests until green.

### Task 4: Reusable first-site UI and confirmation

**Files:**
- Modify: `src/components/onboarding/onboarding-shell.tsx`
- Create: `src/components/onboarding/first-site-form.tsx`
- Create: `src/app/onboarding/first-site/page.tsx`
- Modify: `src/app/onboarding/next/page.tsx`
- Modify: `src/app/platform.css`
- Create: `tests/onboarding-first-site-ui.test.tsx`

**Interfaces:**
- Reuses the 7A shell with a fourth visible milestone, responsive progress, validation summary, save-and-exit behaviour and success confirmation.
- The form posts structured weekday intervals, work-week start, operational boundary, neutral site identity/address/contact fields and the server revision/idempotency key.

- [ ] Add failing UI tests for neutral labels, linked validation, value preservation, 44px controls, keyboard order and locked-next-step confirmation.
- [ ] Implement the first-site route and form using existing form primitives and accessible field IDs/error associations.
- [ ] Add progressively disclosed advanced settings without hiding required attendance-day fields.
- [ ] Replace the 7A placeholder next page with an authoritative first-site summary and locked subscription message.
- [ ] Add only reusable onboarding styles and run UI tests, typecheck and lint.

### Task 5: Verification, review and Preview release

**Files:**
- Verify all files above; no additional product scope.

- [ ] Run focused contracts, database, service, navigation, UI, identity, membership, tenant isolation and site-scope tests.
- [ ] Run the full Vitest suite, migration-history verification, typecheck, ESLint, production build, dependency audit and browser sensitive-marker scan.
- [ ] Run Gitleaks and changed-file personal/Jan marker scans.
- [ ] Perform desktop and 390px mobile browser review, including loading/error/success states, 44px controls, keyboard/focus behaviour and overflow.
- [ ] Request an independent code review and fix all Critical or Important findings.
- [ ] Commit as `Commercial First Site Onboarding` and push only `codex/commercial-production`.
- [ ] Confirm the linked migration is applied only to `commercial-dev`, Vercel Preview is READY at the final SHA, and no production target was touched.
- [ ] Wait for Commercial CI, Docker replay/pgTAP, CodeQL, Gitleaks and dependency review to pass.
- [ ] Verify PR #8 remains open, Draft and unmerged; verify local/remote ahead-behind is `0/0` and the worktree is clean.
