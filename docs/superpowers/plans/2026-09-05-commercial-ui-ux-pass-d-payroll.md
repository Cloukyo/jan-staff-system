# Commercial UI/UX Pass D: Payroll Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make commercial payroll preparation lead with authoritative readiness and one clear next action while preserving every calculation, revision, fingerprint, warning, adjustment, approval and exact-export safeguard.

**Architecture:** Add a pure presentation mapper over the existing commercial payroll reporting state and snapshot readiness. The production screen consumes that mapper to reorder and label existing controls; all mutations continue through the current bound server actions and all eligibility conditions remain unchanged.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Vitest, existing semantic and layout primitives.

**Spec:** `docs/superpowers/specs/2026-09-04-commercial-ui-ux-improvement-programme-design.md`

## Global Constraints

- Do not change payroll calculations, payable-minute rules, adjustment history, readiness rules, fingerprints, revisions, approvals or exact-revision export.
- Do not change attendance calculations, immutable evidence, manager correction storage, RLS, tenant/site permissions, billing or database architecture.
- Preserve manager permission checks and every current server-action eligibility condition.
- Use UK date, time and currency formats and Europe/London semantics.
- Keep payroll clearly labelled as preparation only, not completed payroll.
- Do not add dependencies, migrations or production fixture routes.

---

### Task 1: Payroll workflow presentation model

**Files:**
- Create: `src/components/payroll/payroll-presentation.ts`
- Create: `tests/payroll-presentation.test.ts`

**Interfaces:**
- Consumes: `CommercialPayrollReportingState`, `CommercialPayrollSnapshot`, permission flags and the already-computed export scope match.
- Produces: `buildPayrollWorkflowPresentation(input)`, `groupPayrollReadinessIssues(issues)`, plain-English issue labels and direct remediation links.

- [ ] **Step 1: Write failing lifecycle tests**

Cover no period, no saved run, stale inputs, blockers, unacknowledged warnings, ready approval, approved export, scope mismatch and read-only access.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/payroll-presentation.test.ts`

Expected: FAIL because `payroll-presentation.ts` does not exist.

- [ ] **Step 3: Implement the pure mapper**

Return a semantic tone, manager-facing title, description, primary action kind and ordered counts without changing action eligibility. Map attendance readiness codes to `/attendance` with staff/date context where available, and missing pay arrangements to `/payroll/arrangements`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `npm test -- --run tests/payroll-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

Commit the tested presentation model independently.

### Task 2: Readiness-first preparation and export hierarchy

**Files:**
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `tests/payroll-commercial-ui.test.tsx`

**Interfaces:**
- Consumes: `buildPayrollWorkflowPresentation` and `groupPayrollReadinessIssues` from Task 1.
- Preserves: existing bound period creation, preparation, warning acknowledgement, approval, export and reopen actions.

- [ ] **Step 1: Add failing render tests**

Assert that clean, blocked, warning, stale and approved states render a readiness headline before internal lifecycle detail; approved fresh state exposes `Export approved revision` as the primary action; technical period/run/revision/fingerprint information remains in an `Audit and revision details` disclosure.

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `npm test -- --run tests/payroll-commercial-ui.test.tsx`

Expected: FAIL on the new readiness hierarchy assertions.

- [ ] **Step 3: Recompose the screen**

Place period, scope, semantic readiness status, ranked blocker/warning/information counts and the single eligible primary action first. Preserve the exact existing boolean gates around create, prepare, acknowledge, approve and export. Move reopen, last export, revision and source identifiers into secondary audit disclosure.

- [ ] **Step 4: Add direct remediation**

Render current authoritative readiness issues grouped by severity. Show staff/date context from the snapshot and link only to existing authoritative attendance or pay-arrangement destinations.

- [ ] **Step 5: Run focused UI and domain tests**

Run: `npm test -- --run tests/payroll-commercial-ui.test.tsx tests/payroll-presentation.test.ts tests/payroll-tenant-export.test.ts tests/payroll-review-actions.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit the readiness-first lifecycle composition.

### Task 3: Progressive adjustments and responsive staff review

**Files:**
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `tests/payroll-commercial-ui.test.tsx`

**Interfaces:**
- Uses: existing `DetailDisclosure`, `ResponsiveDataView`, `Alert`, `StatusBadge` and `ActionSummary`.
- Preserves: all adjustment target kinds, operation IDs, signed-minute bounds, reasons, replace/void/reverse controls and stored staff totals.

- [ ] **Step 1: Add failing render tests**

Assert that adjustments are contained in a labelled disclosure, active adjustments remain visibly attention-level, the desktop comparison table remains, and mobile staff records expose payable/ordinary/overtime values without the wide table.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm test -- --run tests/payroll-commercial-ui.test.tsx`

Expected: FAIL on disclosure and responsive-view assertions.

- [ ] **Step 3: Implement progressive adjustment disclosure**

Keep active adjustment state visible and place creation and remediation forms inside a clearly labelled manager-adjustment section. Do not change form fields, targets or operation IDs.

- [ ] **Step 4: Implement responsive staff totals**

Use `ResponsiveDataView`: retain the compact desktop comparison table and add mobile records with staff identity, pay category, payable time, ordinary time, overtime and estimated preparation value.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --run tests/payroll-commercial-ui.test.tsx tests/payroll-presentation.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

Commit the responsive detail and adjustment hierarchy.

### Task 4: Complete verification and evidence

**Files:**
- Add only untracked evidence under `ux-audit-package/current/pass-d/` if the existing safe environment can render the production state.

- [ ] **Step 1: Run focused payroll verification**

Run: `npm test -- --run tests/payroll-commercial-ui.test.tsx tests/payroll-presentation.test.ts tests/payroll-production.test.ts tests/payroll-export-options.test.ts tests/payroll-tenant-export.test.ts tests/payroll-review-actions.test.ts`

- [ ] **Step 2: Run the full standard suite**

Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `git diff --check`.

- [ ] **Step 3: Check scope**

Confirm the tracked diff contains only the plan, payroll presentation/UI files and focused tests. Confirm no migration, calculation, readiness derivation, server action, export implementation, permission or tenancy file changed.

- [ ] **Step 4: Capture or document visual evidence**

Use only fictional data and existing environment-gated preview capability. If no approved payroll fixture or authenticated Commercial Staging session is available, record the limitation instead of adding a production fixture route or weakening authentication.

- [ ] **Step 5: Finish the branch**

Use the finishing-a-development-branch skill, report commits and verification, and stop before Pass E or deployment.
