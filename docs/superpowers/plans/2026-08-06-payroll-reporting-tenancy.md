# Payroll and Reporting Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert payroll preparation, review, adjustments, approval, imports, exports, and related reporting to an organisation-owned commercial ledger while preserving Jan compatibility and existing payable-minute behaviour.

**Architecture:** Add one additive payroll-tenancy migration with organisation-owned periods, immutable revisioned runs, rows, adjustments, approvals, export audits, and organisation-aware import ownership. A single application adapter will resolve commercial identity, consume the Workstream 5 effective attendance RPC, construct stable fingerprints/readiness, and retain an explicit legacy adapter for Jan. Guarded RPC commands will enforce organisation membership, payroll permissions, AAL2, idempotency, optimistic revision, and tenant fences; direct browser mutation will remain revoked.

**Tech Stack:** PostgreSQL/Supabase RLS and RPCs, Next.js App Router, TypeScript, React, ExcelJS, Vitest, PGlite.

## Global Constraints

- Work only on `codex/commercial-production` from milestone `eae5e7bd648733fd5ffd2247da9587be86b478f3`.
- Do not connect to or modify Jan production, deploy, merge to `main`, enable offline attendance, or begin Workstream 7.
- Preserve original clock events and correction evidence. Payroll adjustments remain separate from attendance.
- Preserve existing valid payable-minute behaviour and produce zero invented minutes for malformed attendance.
- Payroll is organisation-owned; site is occurrence attribution and an authorised reporting filter, not the tenant boundary.
- New commercial mutations require `payroll.prepare` or `payroll.export` as applicable and AAL2. Never use generic manager fallback for commercial paths.
- Retain legacy unowned Jan rows without ownership backfill or guessed ownership.
- Keep the product limited to payroll preparation. Do not add PAYE, National Insurance, pensions, statutory pay, deductions, payslips, tax codes, or HMRC submission behaviour.
- Use UK formats and `Europe/London`; do not use em dashes in user-facing application copy.

---

### Task 1: Payroll tenancy schema contract

**Files:**
- Create: `tests/payroll-tenancy-schema.test.ts`
- Create: `supabase/migrations/<generated>_payroll_reporting_tenancy.sql`
- Modify: `tests/migration-history.test.ts` only if the immutable-history guard requires adding a newly recorded production migration (it should not).

**Interfaces:**
- Consumes: Workstream 2 `private.has_permission`, `private.has_site_permission`, membership tables, and Workstream 5 commercial attendance functions.
- Produces: `payroll_periods`, `payroll_preparation_runs`, `payroll_preparation_rows`, `payroll_adjustments`, `payroll_approvals`, `payroll_export_audits`; nullable ownership on legacy import tables; composite tenant keys and indexes.

- [ ] **Step 1: Write a failing schema contract test**

Assert that all new tables have mandatory `organisation_id`, RLS, composite tenant fences, and indexes; legacy import tables gain nullable `organisation_id` and `site_id`; commercial tables deny direct authenticated mutations; command functions revoke `PUBLIC` execute; and no migration touches attendance evidence with `UPDATE` or `DELETE`.

- [ ] **Step 2: Run the schema test and verify RED**

Run: `npm test -- tests/payroll-tenancy-schema.test.ts`
Expected: FAIL because the payroll reporting tenancy migration does not exist.

- [ ] **Step 3: Generate the migration filename and add the minimum schema**

Run `npx supabase --help` and `npx supabase migration new payroll_reporting_tenancy`, then populate that generated file. Define lifecycle/status enums; strict date, revision, value, and acknowledgement constraints; organisation/staff/site/pay-arrangement composite foreign keys; unique idempotency keys scoped by organisation; and immutable ownership triggers. Add only nullable ownership columns to legacy import tables and leave existing rows unowned.

- [ ] **Step 4: Add grants and RLS**

Enable RLS immediately. Allow commercial reads only through `private.has_permission(organisation_id, 'payroll.read')`; keep legacy policies explicitly restricted to `organisation_id is null`; revoke browser writes to commercial ledger tables and use guarded RPCs. Index every ownership/filter/foreign-key column used by policies and reporting.

- [ ] **Step 5: Run schema and migration-history tests and verify GREEN**

Run: `npm test -- tests/payroll-tenancy-schema.test.ts tests/migration-history.test.ts`
Expected: PASS with historical migration checksums unchanged.

### Task 2: Effective attendance and deterministic preparation core

**Files:**
- Create: `tests/payroll-tenant-adapter.test.ts`
- Create: `src/lib/payroll/tenant-types.ts`
- Create: `src/lib/payroll/fingerprint.ts`
- Create: `src/lib/payroll/readiness.ts`
- Create: `src/lib/payroll/tenant-calculations.ts`
- Modify: `src/lib/payroll/types.ts`
- Modify: `src/lib/payroll/calculations.ts`

**Interfaces:**
- Consumes: typed rows returned by `get_commercial_effective_clock_events`, effective-dated `staff_pay_arrangements`, current `createPayrollPreparationRow` arithmetic.
- Produces: `buildCommercialPayrollSnapshot(input): CommercialPayrollSnapshot`, `fingerprintPayrollInput(input): string`, and central readiness severity `blocker | warning | informational`.

- [ ] **Step 1: Write failing adapter tests**

Use hand-checked fictional fixtures for A1, A2, and B1. Assert stable fingerprints; grouping by organisation/staff/operational day/occurrence site; unchanged valid minutes; corrections once; superseded corrections absent; malformed, cross-day, cross-site, and cross-organisation sequences produce zero invented minutes; site transfer leaves historic site attribution unchanged.

- [ ] **Step 2: Run the adapter test and verify RED**

Run: `npm test -- tests/payroll-tenant-adapter.test.ts`
Expected: FAIL because the commercial snapshot API is missing.

- [ ] **Step 3: Implement focused calculation, readiness, and fingerprint modules**

Map the authoritative Workstream 5 ledger output without resolving corrections again. Preserve the existing hourly ordinary/overtime and salary-informational arithmetic. Canonicalise sorted input fields before SHA-256 hashing. Centralise missing clock-in/out, malformed sequence, unresolved exception, unreviewed day, pending request, long shift, site attribution, and stale-input severity.

- [ ] **Step 4: Remove duplicated commercial pairing while retaining Jan arithmetic**

Keep legacy `calculateClockTotals` and `createPayrollPreparationRow` for Jan. Route commercial snapshots only through the authoritative adapter and explicitly reject mixed owned/unowned input.

- [ ] **Step 5: Run adapter and legacy payroll tests and verify GREEN**

Run: `npm test -- tests/payroll-tenant-adapter.test.ts tests/payroll-production.test.ts tests/attendance-pairing.test.ts`
Expected: PASS and legacy fixture minute totals remain unchanged.

### Task 3: Guarded payroll lifecycle and adjustment commands

**Files:**
- Create: `tests/helpers/payroll-tenancy-db.ts`
- Create: `tests/payroll-tenancy-db.test.ts`
- Modify: `supabase/migrations/<generated>_payroll_reporting_tenancy.sql`

**Interfaces:**
- Consumes: Task 1 schema, Workstream 3 membership/AAL helpers, Workstream 5 effective ledger, tenant fixtures A/A1/A2/B/B1.
- Produces RPCs for period creation, preparation persistence, adjustment creation, warning acknowledgement, approval, reopen, and export audit; all return JSON-safe results and use expected revision plus organisation-scoped operation IDs.

- [ ] **Step 1: Build the PGlite payroll harness and failing isolation/lifecycle tests**

Replay prior fictional tenant and attendance migrations, add legacy payroll base tables, apply the new migration, and seed hourly/salaried staff, pay arrangements, corrected and malformed attendance for both organisations. Test guessed IDs, cross-organisation links, site filters, permissions, AAL1/AAL2, idempotency, stale revisions, blocker approval, acknowledgement, reopen history, and immutable attendance evidence.

- [ ] **Step 2: Run DB tests and verify RED**

Run: `npm test -- tests/payroll-tenancy-db.test.ts`
Expected: FAIL at missing command RPCs or lifecycle behaviour.

- [ ] **Step 3: Implement private authorization and validation helpers**

Every `SECURITY DEFINER` helper uses `set search_path = ''`, fully qualified names, `auth.uid()`, active organisation membership, exact permission, AAL2 for mutations, same-organisation composite checks, validated optional site filters, and narrow execute grants. Put reusable privileged helpers in `private`, revoke all execute from browser roles, and expose only command RPCs in `public`.

- [ ] **Step 4: Implement revisioned lifecycle commands**

Create/reuse periods idempotently; persist reproducible runs and rows; mark `needs_review` or `ready`; record warning acknowledgement; approve only the exact non-stale unblocked revision; reopen with reason into a new auditable revision; keep old revisions, approvals, and exports. Detect attendance/pay-arrangement fingerprint drift without rewriting previous rows.

- [ ] **Step 5: Implement adjustment commands**

Accept signed minute adjustments only because current payroll supports adjusted worked minutes. Require reason, staff ownership, optional same-organisation site attribution, operation ID, actor membership, and expected revision. Deduplicate retries and apply each active adjustment exactly once without changing clock events or corrections.

- [ ] **Step 6: Run DB tests and verify GREEN**

Run: `npm test -- tests/payroll-tenancy-db.test.ts tests/attendance-tenancy-db.test.ts tests/attendance-tenant-security-db.test.ts`
Expected: PASS with no attendance evidence changes.

### Task 4: Organisation-aware payroll imports

**Files:**
- Create: `tests/payroll-tenant-imports-db.test.ts`
- Modify: `supabase/migrations/<generated>_payroll_reporting_tenancy.sql`
- Modify: `src/lib/payroll/review.ts`
- Modify: `src/lib/payroll/review-actions.ts`

**Interfaces:**
- Consumes: nullable ownership columns on legacy import tables, commercial membership context, ExcelJS workbook reader.
- Produces: organisation-aware preview and atomic commit RPCs with optional validated site metadata and idempotent commit receipts; explicit legacy Jan action adapter.

- [ ] **Step 1: Write failing commercial import tests**

Assert one organisation per batch, same-organisation staff mapping, optional same-organisation site metadata, preview-before-commit, idempotent retry, atomic rollback on any invalid row, and denial of commercial calls into the legacy unowned import path.

- [ ] **Step 2: Run import tests and verify RED**

Run: `npm test -- tests/payroll-tenant-imports-db.test.ts tests/payroll-review.test.ts`
Expected: FAIL because commercial import RPCs and application routing are missing.

- [ ] **Step 3: Implement commercial import RPCs and application routing**

Derive organisation and actor membership server-side. Validate every profile, arrangement, and site against that organisation. Insert batch plus rows atomically for preview, and apply all arrangements in one transaction with an organisation-scoped idempotency key. Keep the existing Jan flow only behind the explicit legacy actor branch.

- [ ] **Step 4: Run import tests and verify GREEN**

Run: `npm test -- tests/payroll-tenant-imports-db.test.ts tests/payroll-review.test.ts tests/payroll-production.test.ts`
Expected: PASS.

### Task 5: Commercial application service and compatibility adapter

**Files:**
- Create: `tests/payroll-tenant-service.test.ts`
- Create: `src/lib/payroll/actor.ts`
- Create: `src/lib/payroll/tenant-server.ts`
- Create: `src/lib/payroll/tenant-actions.ts`
- Create: `src/lib/payroll/compatibility.ts`
- Modify: `src/lib/payroll/server.ts`
- Modify: `src/lib/payroll/actions.ts`
- Modify: `src/lib/commercial-identity/preference.ts`

**Interfaces:**
- Consumes: `requireActiveMembership`, `requirePermission`, `requireAal2`, Workstream 5 RPC, lifecycle RPCs, and legacy `requireAccount` loaders.
- Produces: `resolvePayrollActor`, `loadPayrollWorkspace`, commercial period/run commands, and a fail-closed choice between commercial and explicit Jan legacy paths.

- [ ] **Step 1: Write failing actor/service tests**

Assert commercial membership takes precedence, multi-organisation ambiguity fails closed, permission failures never fall back to manager, AAL1 mutations fail, selected sites are validated, and only a genuine `membership_required` outcome may select the Jan adapter.

- [ ] **Step 2: Run service tests and verify RED**

Run: `npm test -- tests/payroll-tenant-service.test.ts`
Expected: FAIL because the payroll actor/service does not exist.

- [ ] **Step 3: Implement the actor and commercial server service**

Load identity once, require the relevant permission, query organisation-scoped profiles/pay arrangements/reviews/rota and the commercial effective ledger, then call the central snapshot builder. Commercial commands pass only server-resolved organisation/membership context. Keep legacy loaders unchanged and named as legacy compatibility.

- [ ] **Step 4: Implement revision-safe server actions**

Validate form inputs with bound organisation/run context, enforce AAL2 before RPC mutations, pass operation IDs and expected revisions, translate typed safe failures, and revalidate only payroll paths. Never accept an organisation ID or site ID from an unvalidated browser field.

- [ ] **Step 5: Run service/action tests and verify GREEN**

Run: `npm test -- tests/payroll-tenant-service.test.ts tests/payroll-production.test.ts tests/commercial-identity-guards.test.ts`
Expected: PASS.

### Task 6: Revision-bound exports and payroll reporting UI

**Files:**
- Create: `tests/payroll-tenant-export.test.ts`
- Modify: `src/app/payroll/page.tsx`
- Modify: `src/app/payroll/export/route.ts`
- Modify: `src/app/payroll/review/page.tsx`
- Modify: `src/app/payroll/arrangements/page.tsx`
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `src/components/payroll/payroll-review-screen.tsx`
- Modify: `src/components/payroll/pay-arrangements-screen.tsx`
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `src/lib/exports/identity.ts`

**Interfaces:**
- Consumes: `loadPayrollWorkspace`, approved exact run revisions, organisation/site identity, `payroll.export`, export-audit RPC.
- Produces: neutral organisation/site-labelled workbook and reporting views for organisation totals, site-attributed minutes, staff totals, pay category, adjustment totals, warning/readiness, approval/export state.

- [ ] **Step 1: Write failing export and UI-boundary tests**

Assert neutral metadata, correct organisation and optional site label, no Jan/nursery branding on commercial exports, no sensitive pay fields without payroll permission, formula mitigation, row/workbook limits, exact approved revision, tenant-tamper rejection, and recorded export receipt.

- [ ] **Step 2: Run export tests and verify RED**

Run: `npm test -- tests/payroll-tenant-export.test.ts tests/payroll-export.test.ts`
Expected: FAIL because commercial export still downloads a transient legacy calculation.

- [ ] **Step 3: Route pages through the payroll actor**

Commercial pages render organisation-owned periods/runs/readiness and only the actions permitted by `payroll.read`, `payroll.prepare`, and `payroll.export`. Site managers without payroll permission receive no payroll-sensitive data. The Jan branch retains the existing screens and behaviour.

- [ ] **Step 4: Bind workbook generation to an approved exact revision**

Load only authorised stored rows for the approved revision, validate optional site filters server-side, use commercial product and organisation identity, apply ExcelJS limits and formula-safe strings, omit unnecessary sensitive columns, generate a digest, and record an export audit receipt. Historical exports remain linked to their revision.

- [ ] **Step 5: Run export/UI/regression tests and verify GREEN**

Run: `npm test -- tests/payroll-tenant-export.test.ts tests/payroll-export.test.ts tests/payroll-export-detail.test.ts tests/payroll-export-range.test.ts tests/payroll-export-options.test.ts`
Expected: PASS.

### Task 7: Documentation, complete verification, review, and milestone commit

**Files:**
- Create: `docs/commercial/payroll-reporting-tenancy.md`
- Modify: `docs/commercial/README.md`
- Modify: `docs/commercial/compatibility.md` or the existing compatibility document selected by repository convention.

**Interfaces:**
- Consumes: completed schema, RPCs, adapters, UI, and test evidence.
- Produces: ownership/lifecycle/RLS diagrams, Jan compatibility inventory, legacy contract migration note, and exact Workstream 7 boundary.

- [ ] **Step 1: Document the implemented model**

Describe organisation ownership, site attribution, lifecycle/revisions/fingerprints, central readiness, adjustment separation, import/export audit, permissions/AAL2, legacy Jan entry points, no-backfill rule, statutory-payroll exclusions, offline-disabled state, and Workstream 7 boundary. Do not create or modify onboarding architecture.

- [ ] **Step 2: Run targeted verification**

Run all new payroll tenancy, isolation, site-scope, lifecycle, adjustment, import, export, RLS/grant, MFA, idempotency, attendance compatibility, and Jan regression tests. Confirm no original attendance/correction mutations by executable DB assertions.

- [ ] **Step 3: Run full repository verification**

Run: `npm test`, `npm run verify:migrations`, the repository PGlite replay command discovered from scripts/CI, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run audit:dependencies`, and `npm run verify:browser-bundle`. If Docker is unavailable, record Docker-backed Supabase replay as the unchanged remote CI gate.

- [ ] **Step 4: Request independent code review and resolve findings**

Provide the reviewer the Workstream 6 brief, this plan, base SHA `eae5e7bd648733fd5ffd2247da9587be86b478f3`, and the candidate diff. Fix every Critical or Important finding and rerun affected plus full verification.

- [ ] **Step 5: Commit the milestone**

Confirm the diff contains no secrets or environment changes, stage only Workstream 6 files, and commit exactly `Payroll and Reporting Tenancy`. Do not push, deploy, merge, or begin Workstream 7.
