# Payroll Adjustment Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make payroll adjustments lifecycle-safe, make zero-attendance staff/site scope exact, and make preparation, readiness, approval, reporting, export, and audit reconcile from one authoritative effective-adjustment projection.

**Architecture:** Keep the adjustment ledger immutable as business evidence, but stop copying adjustment minutes between runs. A single private PostgreSQL function will project either the current effective ledger or an immutable run snapshot in one canonical shape. Preparation will compose each active lineage exactly once with database-validated base rows and snapshot that set; all later freshness, approval, reporting, export, and audit paths will consume or compare that same projection. A second private validator will recompute the complete attendance, adjustment, pay-arrangement, site-scope, readiness, row, total, and revision evidence for a run. Site visibility will be enforced by guarded read RPCs, not client-side `OR source_key` filters.

**Tech Stack:** PostgreSQL/Supabase RLS and guarded RPCs, Next.js App Router, TypeScript, React, Vitest, PGlite.

## Global Constraints

- Work only on `codex/commercial-production` from `b564535ba1462fdbddf028f4d7b9f10482dc20da`.
- This plan is Phase 1 only. Do not modify production code, schema, tests, recorded migrations, or create a commit while authoring it.
- During implementation, generate one new migration with `npx.cmd supabase migration new payroll_adjustment_remediation`. Never edit `20260806224830_payroll_reporting_tenancy.sql`, `20260807053347_payroll_final_review_fixes.sql`, or any earlier recorded migration.
- Do not connect to or modify Jan production, deploy, push, merge to `main`, enable offline attendance, or begin Workstream 7.
- Preserve original clock events and attendance corrections. Payroll adjustments remain a separate, auditable ledger.
- Never calculate tax, PAYE, National Insurance, pensions, statutory pay, deductions, payslips, tax codes, or HMRC submissions.
- Preserve UK formats and `Europe/London`. Do not expose pay information on the kiosk and do not use em dashes in user-facing copy.
- Keep the legacy Jan/demo path intact. Commercial changes must not remove demo behaviour or change unowned legacy records.
- Do not make task-by-task commits. After all tests and independent review pass, create the single authorised milestone commit `Payroll and Reporting Tenancy`.

---

## Verified Blocker Scenarios

The following cases were checked against the code and SQL at the baseline commit. Each scenario must first become a failing test, then pass without weakening an assertion.

| Blocker | Input state | Period/run, staff, site, attendance | Adjustment and lifecycle action | Expected result | Unsafe current result | Root cause | Layer |
|---|---|---|---|---|---|---|---|
| Voided minutes remain payable | Organisation A, active AAL2 payroll preparer, open and ready current run | 3 to 9 August 2026, run r2/revision 2; staff A; organisation-wide; 510 raw minutes | Active +15 adjustment is already included, then manager resolves it as `void` | Current run becomes stale; approval/export are blocked; reprepare creates 510 payable minutes and retains void audit history | Resolution changes only adjustment status. The stored row remains 525 and can still be approved/exported | Resolution does not invalidate/recompose the run; approval drift omits adjustment lifecycle; UI offers approval and only offers prepare when no run exists | Database lifecycle/freshness, server actions, UI, export |
| Superseded/reversed minutes remain payable | Same authority and ready state | Same period, staff A, organisation-wide, 510 raw | Included +15 is superseded or reversed | Old lineage contributes zero; replacement contributes once if present; current run is stale until recomposed | Old 525 row remains approvable/exportable after the lifecycle state changes | Stored rows are mutated copies and there is no authoritative lifecycle comparison | Database lifecycle/freshness, approval, export |
| Adjustment is duplicated on later preparation | Organisation A, open period; r2 already contains +15 | Same period, staff A, site A attendance 510 | Existing adjustment is marked carry-forward, then a new +10 adjustment creates r3 | Effective independent roots total +25, so payable is 535 | r3 clones the already adjusted 525 row, adds +10, then the period-revision trigger adds the old +15 again, producing 550 | Adjustment minutes are copied in stored rows and also replayed by a trigger after every revision | Database composition/lifecycle |
| Active adjustment is stranded after pay-arrangement change | Organisation A, open period; source summary was created under arrangement P1 | Zero-attendance staff A, organisation-wide summary; arrangement changes from P1 to P2 before reprepare | Existing active/pending adjustment must survive recalculation | Stable staff/scope target resolves under P2 and contributes once | Carry lookup requires the exact old `staff-summary:<org>:<staff>:<arrangement>` key and reports the source unavailable | Lifecycle identity is coupled to a display/calculation arrangement identifier | Database target model/calculation |
| Selected-site reporting leaks unrelated summaries | Organisation A has site A and site B; site-A reader | Organisation-wide run contains null-site summaries for staff A, staff B, and multi-site staff M | No lifecycle change | Site-A result contains only site-A occurrence rows and explicit site-A adjustment summaries; null-site organisation summaries and site-B staff are absent | Query uses `site_id.eq.A OR source_key LIKE staff-summary:%`, returning every organisation summary and loading the associated staff/pay labels | Site filtering is performed in application queries using source-key text instead of an authorised database scope | Server repository/reporting/export/security |
| Newly eligible zero-attendance staff does not stale approval | Organisation A prepared r1 while only staff A was eligible | Open ready period/run; after preparation staff C becomes active or receives an effective site-A assignment; C has no attendance | No adjustment required | The run becomes stale because eligible-staff/site-scope/pay/readiness fingerprints change; approval is blocked until reprepare includes C according to the zero rule | Freshness reconstructs only staff already present in stored rows, so C is invisible and r1 can be approved | Drift validation derives its universe from stored output rather than authoritative eligible inputs | Database freshness/readiness/approval |
| Summary adjustment form cannot create a safe site row and self-stales organisation rows | Organisation A preparer; open run | Site-A zero summary has `site_id = null`; organisation-wide zero summary also has `site_id = null` | Manager enters a signed adjustment for the displayed staff summary | An authorised explicit site target creates a separate site-attributed `adjustment_summary` row; an organisation target creates a separate organisation-only row; the zero summary remains zero | Site action submits site A and cannot find the null-site row. Organisation action mutates the summary non-zero, after which freshness rejects its own summary invariant | UI binds to an aggregate output row; command mutates that row; summary identity and adjustment identity are conflated | UI, server action, database composition/freshness |

---

## Authoritative Lifecycle and Effective-Adjustment Contract

Use the existing `payroll_adjustments` table as the historical ledger, retaining its authoritative `status` enum: `active`, `superseded`, or `voided`. A reversal is an audited lifecycle transition that moves an active row to `superseded` without a replacement; it is not a fourth stored status.

- `active`: contributes its signed minutes once on every new preparation while the period remains open.
- `superseded`: contributes zero because a linked replacement in the same lineage is authoritative.
- `voided`: contributes zero because the entry was invalid and never should have counted.
- `reverse` transition: changes the source adjustment to `superseded`, contributes zero from the next preparation onward, creates no replacement, and retains the transition and reason in lifecycle audit evidence.
- Replacement is atomic: lock the period and lineage, mark the old row `superseded`, insert one new `active` row with the same `lineage_root_id`, and reject a second active row in that lineage.
- Multiple deliberately independent lineages can target the same staff/site/date and are summed once each. A partial unique index permits only one active row per `(organisation_id, lineage_root_id)`.
- Recalculation does not carry, clone, or mutate adjustments. It reprojects all active lineages. Remove the period-revision carry trigger and revoke the legacy carry/resolve RPCs from browser roles.
- Existing pending carry events are migrated without losing evidence: reactivate their source adjustment, mark the event applied as “continues active”, and do not create another minutes-bearing row. Existing completed carries retain their current active descendant and lineage root.
- Lifecycle commands update the ledger and append audit evidence but do not mutate a stored preparation row. The current run becomes stale because its snapshotted adjustment fingerprint no longer equals the live effective fingerprint.

Create this one entry point and forbid lifecycle/status filtering anywhere else:

```sql
private.effective_commercial_payroll_adjustments(
  target_organisation_id uuid,
  target_period_id uuid,
  target_site_filter_id uuid,
  source_run_id uuid default null
) returns table (
  adjustment_id uuid,
  lineage_root_id uuid,
  staff_id text,
  target_kind text,
  site_id uuid,
  operational_date date,
  adjustment_minutes integer,
  reason text,
  created_at timestamptz
)
```

With `source_run_id is null`, it returns the current effective ledger by selecting active lineages. With a run id, it returns the immutable rows from `payroll_run_adjustment_snapshots` in the same shape. Preparation calls the live branch and snapshots it. Readiness/fingerprinting compare live with the run branch. Approval calls the shared validator and consumes the run branch. Reporting/export call the shared validator and consume the run branch. Approval/export audit records copy its fingerprint and totals. No TypeScript or SQL caller may independently test `payroll_adjustments.status`.

Stable targets are independent of pay-arrangement ids:

```ts
type CommercialAdjustmentTarget =
  | { kind: "attendance"; staffId: string; siteId: string; operationalDate: string }
  | { kind: "organisation_summary"; staffId: string }
  | { kind: "site_summary"; staffId: string; siteId: string };
```

An attendance target is one staff/site/operational-date group. An organisation summary is visible only in organisation scope. A site summary requires an explicit authorised same-organisation site and an effective staff assignment overlapping the period. A multi-site employee may receive an explicit site summary at either genuinely assigned site. The command must reject guessed organisation/staff/site ids, inactive sites, non-overlapping assignments, a site-scoped actor targeting organisation scope or another site, stale revisions, AAL1, missing `payroll.prepare`, reused operation ids with different payloads, and any adjustment that would make its composed target payable minutes negative.

---

## Exact Zero-Attendance Site Rule

Eligibility is computed from authoritative same-organisation staff state and effective-dated assignments across the whole inclusive period, never from current-primary-site shortcuts and never from staff already present in a run.

1. An organisation-wide preparation emits exactly one zero `staff_summary` row for each active eligible staff member with no attendance row in the period. It has `site_id = null`, zero raw/adjustment/payable minutes, and stable key `staff-summary:<organisation>:<staff>`. It remains organisation-only even when the staff member has one site assignment.
2. A site-filtered preparation emits a zero `staff_summary` only when exactly one distinct effective assignment site overlaps the period and that site equals the selected filter. The row is scoped to that selected site for guarded visibility but remains zero and cannot itself be mutated.
3. Concurrent A+B assignment and an in-period A-to-B transfer are ambiguous for zero attendance. They emit no site-filtered summary at either site and remain represented only by the organisation-wide null-site summary.
4. Assignments ending before the period and assignments beginning after the period do not count. An assignment contributes when `starts_on <= period_end` and `ends_on is null or ends_on >= period_start`.
5. Actual attendance remains attributed to its authoritative occurrence site regardless of current or historic assignments.
6. An explicit, authorised site adjustment creates a separate `adjustment_summary` row for that site. It never assigns a site to, or writes minutes into, a null-site staff summary. An organisation adjustment creates a separate null-site `adjustment_summary` row.
7. Organisation totals reconcile exactly as `sum(all site-attributed attendance and site adjustment rows) + sum(organisation-only adjustment rows)`. Zero summaries contribute zero. For the same effective evidence, separately prepared site scopes plus organisation-only adjustments must equal the organisation-wide run, with no fake site allocation and no duplicate minutes.

---

### Task 1: Lock the regression contract with RED tests

**Files:**
- Create: `tests/payroll-adjustment-remediation-schema.test.ts`
- Create: `tests/payroll-adjustment-remediation-db.test.ts`
- Modify: `tests/helpers/payroll-tenancy-db.ts`
- Modify: `tests/payroll-tenant-adapter.test.ts`
- Modify: `tests/payroll-tenant-server-scoping.test.ts`
- Modify: `tests/payroll-tenant-export.test.ts`
- Modify: `tests/payroll-commercial-ui.test.tsx`

**Interfaces:** The test helper must discover the existing payroll tenancy migration, final-review migration, and exactly one migration whose suffix is `_payroll_adjustment_remediation.sql`, in timestamp order. It must fail on zero or multiple remediation migrations.

- [ ] **Step 1: Add schema RED tests**

Add tests named `defines one effective adjustment projection and immutable run snapshots`, `retires carry replay without editing recorded migrations`, `stores lifecycle and stable targets independently of pay arrangements`, and `guards lifecycle and reporting functions with tenant permissions`. Assert the canonical function signature, snapshot table, composite tenant foreign keys, immutable trigger, active-lineage unique index, no carry trigger, revoked legacy execute privileges, RLS, and `SECURITY DEFINER SET search_path = ''`.

- [ ] **Step 2: Add database scenario RED tests**

Add tests named `voiding included minutes makes the run stale and reprepare removes them`, `reversing included minutes blocks approval and export`, `superseding replaces a lineage exactly once`, `reprepare does not duplicate active adjustment minutes`, `arrangement replacement does not strand an active summary adjustment`, `a newly active zero-attendance staff member stales the run`, `a newly effective site assignment stales the run`, `site reporting excludes organisation-only and other-site summaries`, `explicit site adjustment produces one site adjustment summary`, `organisation adjustment leaves the zero staff summary unchanged`, and `site and organisation totals reconcile exactly`.

- [ ] **Step 3: Add domain/server/export/UI RED tests**

Cover the zero rule for one site, A+B, A-to-B transfer, historic-ended, future-starting, current-primary mismatch, actual attendance occurrence attribution, and explicit site adjustment. Cover guessed and cross-tenant ids, AAL1, missing permission, site-scoped cross-site and organisation-only attempts, idempotent retry, conflicting operation id, and two concurrent lifecycle requests. Assert the UI shows `Recalculate preparation` for stale open runs, hides approval/export while stale, never offers an adjustment against a `staff_summary` output row, and binds each form to a unique operation id plus explicit target.

- [ ] **Step 4: Verify RED**

Run:

```powershell
npm.cmd test -- tests/payroll-adjustment-remediation-schema.test.ts tests/payroll-adjustment-remediation-db.test.ts tests/payroll-tenant-adapter.test.ts tests/payroll-tenant-server-scoping.test.ts tests/payroll-tenant-export.test.ts tests/payroll-commercial-ui.test.tsx
```

Expected: new tests fail for missing migration/functions/types and for the verified unsafe behaviours; existing unrelated assertions continue to run.

### Task 2: Generate the additive lifecycle and snapshot migration

**Files:**
- Create: `supabase/migrations/*_payroll_adjustment_remediation.sql` using the Supabase CLI generated timestamp
- Modify: `tests/helpers/payroll-tenancy-db.ts`
- Modify: `tests/payroll-adjustment-remediation-schema.test.ts`

**Interfaces:** Add `target_kind`, `target_operational_date`, `lineage_root_id`, and `replaces_adjustment_id` to `payroll_adjustments`; retain the existing `payroll_adjustment_status` enum and record reversal as an audited transition to `superseded`; add `payroll_run_adjustment_snapshots`; add adjustment, scope, readiness, row, payable-total, and adjustment-total fingerprints to runs and immutable copies to approvals/export audits.

- [ ] **Step 1: Generate, do not hand-name, the migration**

Run:

```powershell
npx.cmd supabase --help
npx.cmd supabase migration new payroll_adjustment_remediation
```

Verify `git diff --name-only -- supabase/migrations` lists exactly one new file and no recorded migration.

- [ ] **Step 2: Add stable lineage and snapshot schema**

Backfill targets from existing rows: attendance rows use staff/site/operational date; null-site summaries become `organisation_summary`; explicit-site summaries become `site_summary`. Recursively collapse `carried_from_adjustment_id` and `supersedes_adjustment_id` to a lineage root. Add deferrable same-organisation composite foreign keys, the one-active-per-lineage partial unique index, snapshot uniqueness on `(organisation_id, run_id, adjustment_id)`, immutable snapshot triggers, supporting indexes, RLS, grants, and comments.

- [ ] **Step 3: Implement the canonical effective projection**

Implement the `private.effective_commercial_payroll_adjustments` signature specified above. Validate organisation, period, run, and site ownership before returning rows. The live branch is the only SQL location that interprets lifecycle state. The run branch is the only downstream source for stored adjustment evidence.

- [ ] **Step 4: Retire carry replay safely**

Drop `payroll_adjustment_lifecycle_carry_trigger` and its private trigger function only in the new migration. Revoke authenticated execute on old create/resolve commands. Migrate pending and completed carry records according to the lifecycle contract without deleting ledger or event rows.

- [ ] **Step 5: Verify schema GREEN and history immutability**

Run:

```powershell
npm.cmd test -- tests/payroll-adjustment-remediation-schema.test.ts tests/migration-history.test.ts
npm.cmd run verify:migrations
git diff --exit-code b564535ba1462fdbddf028f4d7b9f10482dc20da -- supabase/migrations/20260806224830_payroll_reporting_tenancy.sql supabase/migrations/20260807053347_payroll_final_review_fixes.sql
```

Expected: PASS; only the generated migration is new.

### Task 3: Implement guarded v2 lifecycle commands

**Files:**
- Modify: `supabase/migrations/*_payroll_adjustment_remediation.sql`
- Modify: `tests/payroll-adjustment-remediation-db.test.ts`
- Modify: `src/lib/payroll/tenant-actions.ts`
- Modify: `tests/payroll-review-actions.test.ts`

**Interfaces:**

```sql
public.create_commercial_payroll_adjustment_v2(target_period_id uuid, expected_revision integer, operation_id uuid, target_staff_id text, target_kind text, target_site_id uuid, target_operational_date date, adjustment_minutes integer, reason text) returns jsonb
public.replace_commercial_payroll_adjustment_v2(target_period_id uuid, expected_revision integer, operation_id uuid, target_adjustment_id uuid, adjustment_minutes integer, reason text) returns jsonb
public.transition_commercial_payroll_adjustment_v2(target_period_id uuid, expected_revision integer, operation_id uuid, target_adjustment_id uuid, transition text, reason text) returns jsonb
```

- [ ] **Step 1: Make lifecycle tests fail at the v2 command boundary**

Assert exact JSON-safe error codes: `stale_revision`, `invalid_target`, `invalid_site_scope`, `negative_target_total`, `aal2_required`, `permission_denied`, `operation_conflict`, and `run_stale`. Assert identical retries return the original result.

- [ ] **Step 2: Implement guarded commands**

Use an organisation/period advisory transaction lock, `auth.uid()`, active membership, exact `payroll.prepare`, AAL2, composite tenant checks, and immutable operation payload hashing. Site-scoped permission can target only its authorised site. Organisation scope requires organisation-level permission. Never accept organisation id from the browser.

- [ ] **Step 3: Implement atomic lifecycle transitions**

Create establishes `lineage_root_id = id`; replace changes one active row to superseded and inserts its replacement under the same root; transition accepts only `void` or `reverse` and never inserts negative compensating minutes. Append lifecycle audit events and leave the current run untouched so fingerprint comparison marks it stale.

- [ ] **Step 4: Update server actions**

Parse the discriminated target, generate one operation id per form, call only v2 functions, map stable database error codes to concise UK-facing copy, and revalidate `/payroll`. Remove `carry_forward` from the application action union.

- [ ] **Step 5: Verify lifecycle GREEN**

Run: `npm.cmd test -- tests/payroll-adjustment-remediation-db.test.ts tests/payroll-review-actions.test.ts`

### Task 4: Compose adjustments exactly once during preparation

**Files:**
- Modify: `supabase/migrations/*_payroll_adjustment_remediation.sql`
- Modify: `src/lib/payroll/tenant-types.ts`
- Modify: `src/lib/payroll/tenant-calculations.ts`
- Modify: `src/lib/payroll/tenant-server.ts`
- Modify: `tests/payroll-adjustment-remediation-db.test.ts`
- Modify: `tests/payroll-tenant-adapter.test.ts`

**Interfaces:** Add `sourceKind: "attendance" | "staff_summary" | "adjustment_summary"` and `CommercialAdjustmentTarget`. Preparation payload rows must always carry `adjustmentMinutes: 0`; the database rejects non-zero client-supplied adjustment minutes.

- [ ] **Step 1: Add RED composition tests**

Assert active lineages persist across ordinary reprepare and reopen/reprepare, each lineage contributes once, voided/reversed/superseded entries contribute zero, pay-arrangement replacement does not affect stable targets, and tampered browser adjustment minutes are rejected.

- [ ] **Step 2: Implement database-owned composition**

Add `private.compose_commercial_payroll_preparation` with organisation, period, site filter, and base rows as arguments. Validate base rows and their authoritative attendance/pay evidence, obtain adjustments only through the live canonical function, apply attendance targets to the stable staff/site/date row, create separate organisation/site `adjustment_summary` rows, recalculate ordinary/overtime/estimated gross from final payable minutes once, and reject negative target results.

- [ ] **Step 3: Snapshot exact inputs and outputs**

Persist immutable effective-adjustment snapshots and sorted SHA-256 fingerprints for adjustment, attendance, pay arrangements, site scope, readiness, rows, payable total, and adjustment total in the same transaction as the run. Do not increment a revision or create a run from a lifecycle-only command; preparation alone creates the next revision.

- [ ] **Step 4: Remove client composition assumptions**

Keep TypeScript snapshot calculation for preview/readiness, but emit zero adjustment minutes and stable summary keys. Treat database-returned composed rows as the saved truth. Do not use pay-arrangement ids in summary keys.

- [ ] **Step 5: Verify composition GREEN**

Run: `npm.cmd test -- tests/payroll-adjustment-remediation-db.test.ts tests/payroll-tenant-adapter.test.ts tests/payroll-tenancy-db.test.ts tests/payroll-final-review-fixes-db.test.ts`

### Task 5: Implement the exact zero-attendance scope rule

**Files:**
- Modify: `src/lib/payroll/tenant-types.ts`
- Modify: `src/lib/payroll/tenant-calculations.ts`
- Modify: `src/lib/payroll/tenant-server.ts`
- Modify: `tests/payroll-tenant-adapter.test.ts`
- Modify: `tests/payroll-tenant-server-scoping.test.ts`
- Modify: `tests/payroll-adjustment-remediation-db.test.ts`

**Interfaces:** Add effective assignment intervals to `CommercialPayrollSnapshotInput`; expose a pure `classifyZeroAttendanceScope(staffId, period, assignments, selectedSiteId)` returning `organisation_only | selected_site | omitted`.

- [ ] **Step 1: Add the complete zero-scope matrix as RED fixtures**

Use 3 to 9 August 2026 fixtures for: only A; simultaneous A+B; A ending 5 August then B starting 6 August; A ended 2 August; A begins 10 August; current-primary B with only effective A; no assignment; actual site-A attendance; explicit site-A adjustment for multi-site staff. Assert the seven exact rules above.

- [ ] **Step 2: Load authoritative interval evidence**

Load all same-organisation assignments intersecting the inclusive period, including ended historical rows and future-effective boundaries needed to classify overlap. Do not read only the current primary assignment. Include all active staff in organisation scope even when they have no stored run rows; missing pay arrangements remain readiness evidence rather than removing staff.

- [ ] **Step 3: Implement the pure classifier and stable summary output**

Deduplicate distinct overlapping site ids. Organisation-wide output is one null-site zero summary. Site-filter output exists only for one distinct overlapping site matching the filter. Never infer a site for ambiguous zero attendance.

- [ ] **Step 4: Verify the matrix GREEN**

Run: `npm.cmd test -- tests/payroll-tenant-adapter.test.ts tests/payroll-tenant-server-scoping.test.ts tests/payroll-adjustment-remediation-db.test.ts`

### Task 6: Centralise freshness, readiness, and approval validation

**Files:**
- Modify: `supabase/migrations/*_payroll_adjustment_remediation.sql`
- Modify: `src/lib/payroll/tenant-server.ts`
- Modify: `tests/payroll-adjustment-remediation-db.test.ts`
- Modify: `tests/payroll-tenancy-db.test.ts`

**Interfaces:**

```sql
private.validate_commercial_payroll_run_inputs(
  target_organisation_id uuid,
  target_run_id uuid
) returns table (
  is_fresh boolean,
  stale_code text,
  attendance_fingerprint text,
  adjustment_fingerprint text,
  pay_arrangement_fingerprint text,
  site_scope_fingerprint text,
  readiness_fingerprint text,
  row_fingerprint text,
  payable_minutes bigint,
  adjustment_minutes bigint
)
```

- [ ] **Step 1: Add RED drift tests for every evidence class**

After prepare, independently change effective attendance, adjustment lifecycle/minutes, pay arrangement/rate, active staff, assignment/site eligibility, readiness issue, and period revision. Assert a stable code and blocked approval for each. Specifically assert newly eligible staff C is found even though C has no stored row.

- [ ] **Step 2: Implement one validator over authoritative universes**

Recompute attendance for the full period, active staff eligibility, all intersecting assignment intervals, effective pay arrangements, readiness, and the live effective adjustment projection. Compare them with the immutable run fingerprints/snapshots, row digest, totals, and period revision. Do not seed any query from stored run staff ids.

- [ ] **Step 3: Route approval through the validator**

Add `public.approve_commercial_payroll_preparation_v2(target_period_id uuid, expected_revision integer, target_operation_id uuid)`, lock the period/run, call this validator, reject every stale code, require zero blockers and acknowledged warnings, then copy all fingerprints/digests/totals into the approval. Revoke browser execution on the legacy approval RPC and update the application action to call only v2. The UI must not be the enforcement boundary.

- [ ] **Step 4: Verify freshness GREEN**

Run: `npm.cmd test -- tests/payroll-adjustment-remediation-db.test.ts tests/payroll-tenancy-db.test.ts`

### Task 7: Replace unsafe reporting queries and update the manager UI

**Files:**
- Modify: `supabase/migrations/*_payroll_adjustment_remediation.sql`
- Modify: `src/lib/payroll/reporting.ts`
- Modify: `src/lib/payroll/tenant-server.ts`
- Modify: `src/components/payroll/production-payroll-screen.tsx`
- Modify: `tests/payroll-tenant-server-scoping.test.ts`
- Modify: `tests/payroll-tenant-export.test.ts`
- Modify: `tests/payroll-commercial-ui.test.tsx`

**Interfaces:** Add guarded `public.get_commercial_payroll_run_report(target_run_id uuid, requested_site_id uuid default null)` that validates the run's organisation and caller permission, returns only rows permitted by exact run/request scope, returns adjustments via the canonical run branch, and includes `is_fresh`/`stale_code` from the shared validator.

- [ ] **Step 1: Add RED visibility tests**

Assert a site-A actor cannot read an organisation-wide run, a site-A report contains no null-site organisation summary/site-B staff/pay labels, and an organisation-level actor can read the exact organisation run. Assert guessed run/site/staff ids have the same safe denial shape as absent ids.

- [ ] **Step 2: Implement guarded reporting RPC**

Replace direct `payroll_preparation_rows` and `payroll_adjustments` queries. Delete the `source_key.like.staff-summary:%` filter. Filter by structured `source_kind` and `site_id`, and obtain adjustment evidence only from the run-id branch of `effective_commercial_payroll_adjustments`.

- [ ] **Step 3: Make stale state actionable in the UI**

Extend `CommercialPayrollReportingState` with `isFresh`, `staleCode`, and explicit adjustment targets. Show `Recalculate preparation` whenever an open run is stale, hide approve/export while stale, render an adjustment form only for a valid stable target, generate a distinct operation id per form/action, and replace carry controls with replace/void/reverse lifecycle controls.

- [ ] **Step 4: Verify reporting/UI GREEN**

Run: `npm.cmd test -- tests/payroll-tenant-server-scoping.test.ts tests/payroll-tenant-export.test.ts tests/payroll-commercial-ui.test.tsx`

### Task 8: Make export and audit reconcile with the approved run

**Files:**
- Modify: `supabase/migrations/*_payroll_adjustment_remediation.sql`
- Modify: `src/lib/payroll/tenant-server.ts`
- Modify: `src/app/payroll/export/route.ts`
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `tests/payroll-tenant-export.test.ts`
- Modify: `tests/payroll-adjustment-remediation-db.test.ts`

**Interfaces:** Add guarded `public.get_commercial_approved_payroll_export(target_approval_id uuid, expected_revision integer)` and `public.record_commercial_payroll_export_v2(...)`; the v2 recorder validates and stores the same approval/run fingerprints, row digest, payable total, adjustment total, exact site scope, file identity, and actor. Revoke browser execution on the legacy export recorder and route the application through v2.

- [ ] **Step 1: Add RED export reconciliation tests**

Assert export is denied after any lifecycle/scope/readiness drift, including after approval if the protected state can change; row sum equals approval payable total; adjustment sum equals approval adjustment total; each snapshot id appears once; site runs contain only their site; and organisation total equals all site-attributed rows plus organisation-only rows. Assert file/audit values match exactly.

- [ ] **Step 2: Implement guarded approved-export read**

Lock and validate approval, period, run, revision, organisation, exact site filter, permission, and current evidence using `validate_commercial_payroll_run_inputs`. Return stored rows plus the canonical run adjustment projection. Do not reconstruct staff visibility with application-side OR filters.

- [ ] **Step 3: Bind audit to exact export evidence**

Record audit only after the same validation and compare supplied digest/totals to approval. Use server-derived values where possible. Preserve export idempotency and reject operation-id payload conflicts.

- [ ] **Step 4: Verify export GREEN**

Run: `npm.cmd test -- tests/payroll-tenant-export.test.ts tests/payroll-adjustment-remediation-db.test.ts tests/payroll-export.test.ts tests/payroll-export-detail.test.ts tests/payroll-export-range.test.ts tests/payroll-export-options.test.ts`

### Task 9: Run security, concurrency, and regression gates

**Files:**
- Modify only if a test exposes a defect: files already listed in Tasks 2 to 8
- Create after implementation evidence is complete: `.superpowers/sdd/2026-08-07-payroll-adjustment-remediation/implementation-report.md`

- [ ] **Step 1: Run focused database/security tests**

Run:

```powershell
npm.cmd test -- tests/payroll-adjustment-remediation-schema.test.ts tests/payroll-adjustment-remediation-db.test.ts tests/payroll-tenancy-schema.test.ts tests/payroll-tenancy-db.test.ts tests/payroll-final-review-fixes-schema.test.ts tests/payroll-final-review-fixes-db.test.ts tests/payroll-tenant-server-scoping.test.ts
```

Confirm explicit coverage for cross-organisation, guessed ids, inactive membership, missing permission, AAL1, site-scope denial, stale revision, idempotent retry, conflicting retry, concurrent replace/transition, direct table mutation denial, immutable snapshots, and original clock-event immutability.

- [ ] **Step 2: Run payroll and attendance regressions**

Run:

```powershell
npm.cmd test -- tests/payroll-tenant-adapter.test.ts tests/payroll-tenant-export.test.ts tests/payroll-commercial-ui.test.tsx tests/payroll-review.test.ts tests/payroll-review-actions.test.ts tests/payroll-production.test.ts tests/attendance-tenancy-db.test.ts tests/attendance-corrections-db.test.ts tests/attendance-state-machine.test.ts
```

Confirm no valid attendance/payable-minute change, no Jan/demo deletion, no pay leak to kiosk, and no attendance evidence mutation.

- [ ] **Step 3: Run complete verification**

Run:

```powershell
npm.cmd run lint
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd run audit:dependencies
npm.cmd run verify:migrations
npm.cmd run verify:browser-bundle
```

Record command, exit code, test counts, and any pre-existing warnings in the implementation report. Do not claim completion if any command fails.

- [ ] **Step 4: Perform a browser marker and workflow check**

Start `npm.cmd run dev`. Using the browser verification skill, verify the manager page at a desktop viewport and a narrow touch viewport: stale marker and recalculate action, no stale approval/export, explicit organisation/site adjustment labels, void/reverse confirmation, readable UK dates/hours/currency, and touch targets at least 44px. Verify the public kiosk never exposes rate, salary, gross estimate, adjustment reason, or payroll links. Record screenshots/observations in the report and stop the dev server.

- [ ] **Step 5: Request independent review**

Give an independent reviewer the user brief, this plan, baseline commit, complete diff, migration, implementation report, and exact seven blocker scenarios. Require review of lifecycle composition, status centralisation, fingerprints, zero-site matrix, reconciliation, tenant/site/AAL2/RLS security, idempotency/concurrency, historic migration immutability, Jan compatibility, and test quality. Address all Critical and Important findings, rerun affected focused tests and the complete verification suite, and repeat review until there are no Critical or Important findings.

- [ ] **Step 6: Create the only authorised milestone commit**

After clean independent review and all gates pass, verify the diff contains no Jan production configuration, deployment, Workstream 7, recorded-migration edits, generated artifacts, or unrelated user changes. Then run:

```powershell
git status --short
git diff --check
git add -- docs/superpowers/plans/2026-08-07-payroll-adjustment-remediation.md .superpowers/sdd/2026-08-07-payroll-adjustment-remediation/implementation-report.md src tests supabase/migrations
git commit -m "Payroll and Reporting Tenancy"
```

Do not push, merge, deploy, or start Workstream 7.

---

## Plan Self-Review Checklist

- [ ] Each verified blocker has explicit input state, period/run, staff, site, attendance, lifecycle action, expected result, unsafe result, root cause, and affected layer.
- [ ] `private.effective_commercial_payroll_adjustments` is the only lifecycle interpreter and is used for preparation, readiness, fingerprinting, approval, reporting, export, and audit.
- [ ] Approval freshness covers attendance, adjustment, pay arrangements/rates, complete staff eligibility, effective site assignments, readiness, stored rows/totals, site filter, and revision.
- [ ] The exact zero-attendance rule covers organisation-only, one-site, multi-site, transfer, historic-ended, future-starting, current-primary mismatch, actual attendance, and explicit-site adjustment cases.
- [ ] Recalculation applies active lineages once and never clones/carries minutes; voided, reversed, and superseded entries contribute zero.
- [ ] Organisation/site totals and approval/export/audit fingerprints reconcile exactly without fake site allocation.
- [ ] Security tests cover cross-tenant ids, guessed ids, AAL1, permissions, site boundaries, RLS, direct mutation denial, idempotency, concurrency, and immutable evidence.
- [ ] The migration is CLI-generated and additive; recorded migrations remain byte-for-byte unchanged.
- [ ] Commands include focused RED/GREEN checks, full lint/typecheck/test/build, dependency audit, migration verification, browser-bundle verification, and browser marker checks.
- [ ] No implementation step authorises Jan production access, deployment, push, merge, offline attendance, or Workstream 7.
- [ ] There are no unresolved drafting markers, ellipsis placeholders, ambiguous target types, or unverified completion claims in this plan.
