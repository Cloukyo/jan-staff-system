# Commercial UI/UX Pass C: Attendance Implementation Plan

**Goal:** Make attendance review action-first and usable on mobile while preserving effective-attendance calculations, immutable clock evidence, manager-correction separation, review decisions, exception safeguards, tenancy, permissions and audit behaviour.

**Scope:** Production attendance presentation only. No database, calculation, server action, permission, rota, payroll or kiosk behaviour changes.

## Task 1: Specify the review-priority presentation model

**Files:**
- Create: `tests/attendance-presentation.test.ts`
- Create: `src/components/attendance/attendance-presentation.ts`

1. Add failing tests for classification of rows requiring correction, staff follow-up, manager review, and no action.
2. Add failing tests for aggregate action counts and stable action-first ordering.
3. Run the focused test and confirm it fails because the presentation model does not exist.
4. Implement a pure presentation mapper over `AttendanceReviewDay` rows.
5. Run the focused test and confirm it passes.

## Task 2: Rebuild the daily review around the action queue

**Files:**
- Modify: `src/components/attendance/attendance-review.tsx`
- Test: `tests/attendance-presentation.test.ts`

1. Add failing render assertions for a concise action summary, plain-English row status and a clear primary next action.
2. Place records needing action before completed records without changing persisted order or data.
3. Present exceptions and staff requests as the reason action is needed, with corrections as the primary route when recorded time is unsafe.
4. Put the date selector and completed records behind appropriate progressive disclosure on smaller screens.
5. Preserve every review decision, reason requirement, staff-request resolution action and corrections link.
6. Run focused tests.

## Task 3: Simplify exception remediation without duplicating correction logic

**Files:**
- Modify: `src/components/attendance/attendance-exceptions.tsx`
- Test: `tests/attendance-presentation.test.ts`

1. Add failing render assertions for issue count, plain-English action framing and collapsed evidence/correction choices.
2. Keep staff, date and payroll impact visible before disclosure.
3. Move original evidence, effective ledger, audit history and alternative corrections into labelled disclosures.
4. Keep the safest likely action prominent while preserving all correction and dismissal options.
5. Keep original evidence wording and immutable correction behaviour unchanged.
6. Run focused tests.

## Task 4: Verify attendance behaviour and repository health

**Files:**
- No production file changes expected.

1. Run focused attendance presentation, review, correction and exception tests.
2. Run `npm run lint`.
3. Run `npm run typecheck`.
4. Run `npm test`.
5. Run `npm run build`.
6. Run `git diff --check`.
7. Confirm no calculation, database, migration, server action, permission or tenancy file changed.

## Task 5: Capture and review focused evidence

**Files:**
- Add only untracked evidence under `ux-audit-package/current/pass-c/` if the existing safe environment can render the production state.

1. Capture representative desktop and mobile attendance review states when available without production data or deployment.
2. Record any environment limitation factually rather than weakening authentication or inventing data paths.
3. Inspect the final diff and create coherent implementation commits.

