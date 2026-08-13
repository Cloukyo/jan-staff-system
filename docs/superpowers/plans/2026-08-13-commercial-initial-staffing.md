# Commercial Initial Staffing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Workstream 7D manual and staged CSV staffing to the durable commercial onboarding workflow without beginning invitations, kiosk registration, readiness or Go Live.

**Architecture:** Extend the existing `staff_profiles`, `staff_site_assignments`, `staff_kiosk_settings`, `staff_import_batches` and `staff_import_rows` structures. The browser parses no authority: server actions validate bounded CSV input, while guarded database commands resolve the session organisation, first site, active membership, AAL2 and current plan entitlement before atomically creating operational records. The workflow snapshot carries only safe counts, identifiers and staged review data.

**Tech Stack:** Next.js 16 App Router, React 19 server actions, TypeScript, Zod, PostgreSQL/Supabase RLS and SECURITY DEFINER RPCs, Vitest, PGlite and pgTAP.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge to `main` or deploy Vercel Production.
- Use only `commercial-dev` (`perxeotveoxjibkcybnq`) for remote Preview verification.
- Do not implement invitations, kiosk registration, roster testing, readiness, Go Live, payment-provider integration or offline attendance.
- Keep the selected subscription `trial_pending`; `trial_started_at` and `trial_ends_at` remain null.
- Preserve organisation and site composite tenant fences and existing Jan compatibility paths.
- Never create a PIN, kiosk device, offline credential, payroll record or compliance record from staffing onboarding.
- Use fictional commercial data only.

---

### Task 1: Versioned staffing and CSV contracts

**Files:**
- Create: `src/lib/onboarding/staffing-contracts.ts`
- Create: `src/lib/onboarding/staffing-csv.ts`
- Modify: `src/lib/onboarding/contracts.ts`
- Test: `tests/onboarding-staffing-contracts.test.ts`
- Test: `tests/onboarding-staffing-csv.test.ts`

**Interfaces:**
- Produces `manualStaffPayloadSchema`, `staffImportUploadPayloadSchema`, `staffImportDecisionPayloadSchema`, `staffImportCommitPayloadSchema`, `staffingSkipPayloadSchema`, `staffingSnapshotSchema`.
- Produces `parseStaffingCsv(file: { name; type; size; text }): StaffCsvParseResult` with 1 MiB and 250-row limits, exact headers, RFC-style quoted fields and stable validation codes.

- [ ] Write red tests for valid fictional CSV, MIME/extension, empty/malformed/oversized files, row limit, UK ISO date policy, ambiguous dates, emails, duplicates, roles, employment statuses and attendance eligibility.
- [ ] Run the two focused test files and confirm the new exports are absent.
- [ ] Implement strict schemas and parser with no logging or formula/executable interpretation.
- [ ] Run focused tests and confirm they pass.

### Task 2: Durable staging and guarded database commands

**Files:**
- Create: `supabase/migrations/20260813*_commercial_initial_staffing.sql`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Create: `tests/onboarding-initial-staffing-db.test.ts`
- Modify: `supabase/tests/onboarding_bootstrap.sql`

**Interfaces:**
- Extends import batches with session, digest, filename, expiry, reviewed-set hash and commit receipt fields.
- Extends import rows with row number, warning/error codes, attendance decision and `include|exclude|needs_review|confirm_new` decision.
- Adds onboarding commands `create_manual_staff`, `stage_staff_import`, `review_staff_import_row`, `commit_staff_import`, `skip_staffing`.
- Extends snapshot with authoritative staffing usage, plan limit, first site and safe active-batch rows.

- [ ] Write red PGlite tests for manual atomicity/idempotency, AAL2, membership, tenant fences, duplicate identifiers/email, explicit eligibility with null PIN, plan limits, import validation without operational writes, exclusions, atomic commit/replay, stale revision, skip/resume and RLS/grants.
- [ ] Add the additive migration, sixth step, safe events, strict nested SQL validation, RLS and revoke/grant boundaries.
- [ ] Enforce `staff.active.limit` using `private.commercial_require_capability` inside the same transaction and map denial to `staff_limit_exceeded`.
- [ ] Ensure manual/import creation inserts disabled/pending `staff_kiosk_settings` (`kiosk_enabled=false`, `pin_hash=null`, `pin_reset_required=true`) and no kiosk/offline rows.
- [ ] Run PGlite and pgTAP-focused tests until green.

### Task 3: Server action and workflow integration

**Files:**
- Modify: `src/lib/onboarding/bootstrap-service.ts`
- Modify: `src/lib/onboarding/actions.ts`
- Modify: `src/lib/onboarding/navigation.ts`
- Create: `src/lib/onboarding/staffing-actions.ts`
- Modify: `tests/onboarding-bootstrap-service.test.ts`
- Modify: `tests/onboarding-navigation.test.ts`
- Create: `tests/onboarding-staffing-actions.test.ts`

**Interfaces:**
- Produces server actions for manual create/draft, CSV stage, row decision, atomic commit and deliberate skip.
- Navigation routes incomplete staffing to `/onboarding/staffing` and completed/skipped staffing to `/onboarding/next`.

- [ ] Write red tests for command allowlisting, redirects, value preservation, stale workflow results and no production demo fallback.
- [ ] Implement actions with server-side file parsing and AAL2 enforcement.
- [ ] Run focused service/navigation/action tests.

### Task 4: Polished staffing interface

**Files:**
- Create: `src/app/onboarding/staffing/page.tsx`
- Create: `src/app/onboarding/staffing/template/route.ts`
- Create: `src/components/onboarding/staffing-workspace.tsx`
- Create: `src/components/onboarding/staffing-manual-form.tsx`
- Create: `src/components/onboarding/staffing-import-review.tsx`
- Modify: `src/components/onboarding/onboarding-shell.tsx`
- Modify: `src/app/onboarding/next/page.tsx`
- Modify: `src/app/platform.css`
- Create: `tests/onboarding-staffing-ui.test.tsx`

**Interfaces:**
- Reuses the onboarding shell and exposes manual, CSV and deliberate-later paths.
- Template contains only fictional Alex Morgan, Jamie Patel and Casey Taylor records.

- [ ] Write source/render tests for neutral wording, accessible labels/errors/statuses, 44px controls, atomic-import explanation, mobile review cards, no invitation/kiosk actions and fictional template content.
- [ ] Implement desktop and 390px layouts without horizontal page overflow.
- [ ] Exercise loading, error, warning, excluded, committed and skipped states.
- [ ] Capture desktop/mobile screenshots and fix all material hierarchy, spacing, focus and zoom issues.

### Task 5: Full verification and isolated Preview checkpoint

**Files:**
- Modify only defects discovered by verification.

- [ ] Run focused 7D, onboarding regression, customer-domain, tenant-isolation and entitlement tests.
- [ ] Run full Vitest, migration history, PGlite replay, typecheck, ESLint, build, dependency audit and browser sensitive-marker scan.
- [ ] Run independent review and fix every Critical/Important finding in scope.
- [ ] Commit exactly `Commercial Initial Staffing` and push the existing Draft PR branch.
- [ ] Wait for Commercial CI, Docker replay, pgTAP, schema lint, CodeQL, Gitleaks, dependency review and Vercel Preview.
- [ ] Verify Preview SHA/readiness, `trial_pending` timestamps, zero kiosk devices/offline authorisations and clean 0/0 worktree; do not begin 7E.

## Self-review

- Coverage: manual creation, staged CSV, review decisions, atomic commit, plan limit, explicit eligibility, skip/resume, RLS, UI and Preview are each assigned to a task.
- Scope: no invitations, kiosk registration, readiness, Go Live, provider billing or offline implementation is included.
- Type flow: contracts feed actions; actions use existing command envelopes; snapshots feed one staffing route.
- Data safety: events and receipts contain only IDs, counts and validation categories; staged names/emails stay in restricted staging rows and expire.
