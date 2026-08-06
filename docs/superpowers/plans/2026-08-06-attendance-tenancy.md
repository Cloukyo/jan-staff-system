# Attendance Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every new commercial attendance record authoritatively organisation and occurrence-site owned while preserving Jan's explicit unowned compatibility path, immutable evidence, correction chains, operational-day safety and payroll-compatible effective minutes.

**Architecture:** One additive migration expands all attendance and minimum required kiosk-device tables with nullable legacy-compatible ownership, then enforces commercial ownership with composite foreign keys, immutable-ownership triggers, RLS and narrowly granted RPCs. New commercial RPCs derive authority from membership or registered device state; legacy functions remain isolated for unowned Jan records. Application adapters select commercial or legacy paths server-side and all commercial consumers use one tenant-aware effective-ledger contract.

**Tech Stack:** PostgreSQL/Supabase migrations and RLS, Next.js 16 server actions, TypeScript 5, Vitest, PGlite, Europe/London date rules.

## Global Constraints

- Work only in `codex/commercial-production` at or after `13144eebc3054ff9804b776a48037ebab28e289f`.
- Do not connect to or modify Jan production and do not merge into `main`.
- Do not begin payroll tenancy, billing, onboarding, Jan migration or offline enablement.
- Preserve original `clock_events`; corrections remain append-only and separate.
- New commercial attendance requires non-null `organisation_id` and `site_id`; existing unowned Jan rows remain explicit compatibility data.
- Do not guess historic ownership or rewrite timestamps, evidence hashes or correction lineages.
- Offline attendance remains disabled; no offline authorisation is issued by this workstream.
- Use UK formats and `Europe/London`; do not add payroll calculations.

---

### Task 1: Executable attendance-tenancy harness and migration contract

**Files:**
- Create: `tests/helpers/attendance-tenancy-db.ts`
- Create: `tests/attendance-tenancy-schema.test.ts`
- Create with CLI: `supabase/migrations/<timestamp>_attendance_tenancy.sql`

**Interfaces:**
- Consumes: `createCustomerDomainDatabase()`, organisation/site/staff fixture IDs and existing attendance migration contracts.
- Produces: `createAttendanceTenancyDatabase()`, tenant/device fixture constants, commercial and legacy auth helpers.

- [ ] **Step 1: Write the failing migration contract tests**

Add assertions that each converted attendance table and `kiosk_devices` has nullable `organisation_id`/`site_id`, every tenant parent has `unique (organisation_id, id)`, composite foreign keys use `ON DELETE RESTRICT`, ownership-change triggers exist, commercial rows cannot remain unowned, and historical migration files are unchanged.

- [ ] **Step 2: Run the focused test and verify RED**

Run: `npm.cmd test -- --run tests/attendance-tenancy-schema.test.ts`

Expected: failure because the attendance-tenancy migration and ownership columns do not exist.

- [ ] **Step 3: Create the empty migration through the installed CLI**

Run: `npx.cmd supabase migration new attendance_tenancy`

- [ ] **Step 4: Build the PGlite harness and minimal additive schema expansion**

The harness must seed Organisation A with Sites A1/A2, Organisation B with Site B1, overlapping staff identifiers, site-limited managers, organisation-wide admins, linked staff and site-bound devices. It must apply the real Workstream 5 migration and retain one unowned Jan-style staff/event path.

- [ ] **Step 5: Run the focused test and verify GREEN**

Run: `npm.cmd test -- --run tests/attendance-tenancy-schema.test.ts`

Expected: all schema, migration and ownership-contract tests pass.

### Task 2: Relational tenant fences, immutable ownership and RLS

**Files:**
- Modify: `supabase/migrations/<timestamp>_attendance_tenancy.sql`
- Create: `tests/attendance-tenant-isolation-db.test.ts`
- Create: `tests/attendance-site-isolation-db.test.ts`

**Interfaces:**
- Consumes: `private.has_permission(uuid,text)`, `private.has_site_permission(uuid,uuid,text)`, `staff_profiles(organisation_id,id)`, `organisation_sites(organisation_id,id)`.
- Produces: `private.attendance_row_is_readable(uuid,uuid,text)`, tenant-aware RLS for all converted attendance tables and direct-write denial.

- [ ] **Step 1: Write failing organisation and site isolation tests**

Cover Organisation A versus B reads/corrections, Site A1 manager versus A2, organisation-wide access, linked staff self-read, revoked membership, guessed IDs, direct writes and privileged cross-tenant FK attempts.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test -- --run tests/attendance-tenant-isolation-db.test.ts tests/attendance-site-isolation-db.test.ts`

Expected: cross-tenant reads or links succeed, or required policies/constraints are absent.

- [ ] **Step 3: Implement ownership constraints and guards**

Add nullable ownership to `clock_events`, `clock_event_corrections`, `attendance_day_reviews`, `attendance_correction_requests`, `attendance_operation_requests`, `attendance_action_requests`, `attendance_exceptions`, `attendance_exception_operations` and the minimum `kiosk_devices` boundary. Add composite tenant FKs, partial indexes and triggers that reject commercial/unowned mixing and any organisation/site reparenting. Keep legacy rows wholly unowned.

- [ ] **Step 4: Replace attendance RLS and grants**

Commercial reads require current membership plus `attendance.read` and site authority, or linked same-organisation self-service. Legacy policies require `organisation_id is null`. Direct commercial writes remain unavailable; guarded functions own mutations. Revoke `PUBLIC`/`anon` execution and grant only required roles.

- [ ] **Step 5: Verify GREEN**

Run the two focused isolation files and confirm every denial is caused by the intended relational or permission boundary.

### Task 3: Tenant-aware effective ledger, state and locks

**Files:**
- Modify: `supabase/migrations/<timestamp>_attendance_tenancy.sql`
- Create: `tests/attendance-tenant-state-machine-db.test.ts`
- Modify: `src/lib/attendance/types.ts`
- Create: `src/lib/attendance/tenant-context.ts`

**Interfaces:**
- Produces: `private.lock_attendance_stream(uuid,text)`, `public.get_commercial_effective_clock_events(uuid,uuid,date,date,text)`, `public.get_commercial_attendance_state(uuid,uuid,text,timestamptz)`.
- State/effective rows always include `organisationId`, `siteId`, `staffId` and operational date.

- [ ] **Step 1: Write failing state/effective-ledger tests**

Cover ordinary clock-in/out, stale previous-day clock-in, `start_new_shift`, duplicates, overlapping staff identifiers across organisations, cross-site and cross-day non-pairing, transfer/device-rebind snapshots, DST and payroll-minute parity.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test -- --run tests/attendance-tenant-state-machine-db.test.ts`

- [ ] **Step 3: Implement tenant-scoped locking and effective ledger**

Use a transaction advisory key containing organisation plus staff. Filter originals and correction lineage by organisation, occurrence site, staff and operational day. Preserve raw originals and exclude only superseded corrections.

- [ ] **Step 4: Implement tenant-aware state derivation**

Return the existing safe state machine shape plus organisation/site ownership. Never pair across organisation, site or London operational date.

- [ ] **Step 5: Verify GREEN and legacy regression**

Run the new file plus `tests/attendance-state-machine.test.ts`, `tests/attendance-pairing.test.ts` and `tests/payroll-production.test.ts`.

### Task 4: Trusted online kiosk attendance and idempotency

**Files:**
- Modify: `supabase/migrations/<timestamp>_attendance_tenancy.sql`
- Create: `tests/attendance-tenant-kiosk-db.test.ts`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `src/lib/kiosk/server.ts`
- Modify: `src/lib/kiosk/rpc-mapping.ts`

**Interfaces:**
- Produces: device-token resolved organisation/site context; commercial action RPC keyed by organisation/site/device/staff/action/idempotency UUID.
- The client continues sending staff/action/revision only as routing input and never supplies trusted ownership.

- [ ] **Step 1: Write failing device-boundary and idempotency tests**

Cover changed organisation/site/staff/device, inactive assignment, Site A1 device versus Site A2-only staff, identical UUID retries, UUID payload changes, overlapping staff IDs and one-event concurrent duplicate behaviour.

- [ ] **Step 2: Verify RED**

Run: `npm.cmd test -- --run tests/attendance-tenant-kiosk-db.test.ts`

- [ ] **Step 3: Implement minimum device ownership and trusted context**

Commercial device tokens resolve one immutable organisation/site binding. The RPC validates an effective staff-site assignment on the event date, locks the organisation/staff stream, recomputes revision and inserts one owned event with the bound occurrence site.

- [ ] **Step 4: Make idempotency tenant and payload bound**

Use an atomic insert/conflict path. Replays return the original safe response only when organisation, site, device, staff, action and expected revision match; changed payloads fail closed.

- [ ] **Step 5: Verify GREEN and confirm offline remains disabled**

Run the focused test and existing online/offline feature tests. Assert no offline authorisation is created and `offline_enabled` remains false.

### Task 5: Tenant-aware manager corrections and exceptions

**Files:**
- Modify: `supabase/migrations/<timestamp>_attendance_tenancy.sql`
- Create: `tests/attendance-tenant-corrections-db.test.ts`
- Create: `tests/attendance-tenant-exceptions-db.test.ts`
- Modify: `src/lib/attendance/correction-actions.ts`
- Modify: `src/lib/attendance/review-actions.ts`
- Modify: `src/lib/attendance/exceptions-server.ts`

**Interfaces:**
- Produces guarded commercial correction/removal/reset/resolve/dismiss RPCs that resolve membership server-side and require `attendance.correct` for the evidence site.
- Corrections and exceptions inherit organisation/site from original evidence or explicit same-site manager-added evidence.

- [ ] **Step 1: Write failing correction and exception tests**

Cover same-site success, cross-site/cross-org denial, byte-identical originals, inherited ownership, append-only supersession, stale revision, operation replay, duplicate reconciliation, dismissal reason and concurrent manager resolution.

- [ ] **Step 2: Verify RED**

Run both new focused files.

- [ ] **Step 3: Implement commercial manager RPCs and audit ownership**

Resolve current membership inside each function, require AAL2 where existing sensitive-operation policy requires it, verify site permission and same-tenant staff/evidence, and persist membership audit IDs without altering legacy actor columns.

- [ ] **Step 4: Implement tenant-scoped exception reconciliation**

One anomaly fingerprint is unique within organisation/site/staff/day/type. Resolution/dismissal operations inherit the exception ownership and remain immutable audit history.

- [ ] **Step 5: Verify GREEN and original evidence hashes**

Run focused tests and existing correction/exception suites; compare original event rows before and after corrections byte-for-byte.

### Task 6: Attendance consumers and explicit compatibility adapter

**Files:**
- Create: `src/lib/attendance/server-actor.ts`
- Create: `src/lib/attendance/commercial-server.ts`
- Modify: `src/lib/attendance/review-server.ts`
- Modify: `src/lib/attendance/staff-hours.ts`
- Modify: `src/lib/attendance/correction-actions.ts`
- Modify: `src/lib/attendance/review-actions.ts`
- Modify: `src/lib/attendance/exceptions-server.ts`
- Modify attendance-only pages/components only where context/filter plumbing is required.
- Create: `tests/attendance-tenant-adapters.test.ts`
- Create: `tests/attendance-self-service-tenant.test.ts`

**Interfaces:**
- `requireAttendanceActor(permission,{siteRequired})` returns either a commercial membership/site actor or explicit legacy Jan actor.
- Commercial membership errors never fall back to legacy; only absence of commercial membership permits the named compatibility path.

- [ ] **Step 1: Write failing adapter and self-service tests**

Cover selected organisation/site routing, multi-organisation ambiguity, stale/revoked membership, unlinked membership, own records only, and explicit unowned legacy fallback.

- [ ] **Step 2: Verify RED**

Run the two focused files.

- [ ] **Step 3: Implement server-authoritative adapter selection**

Reuse Workstream 3 context. Add organisation/site filters to all commercial queries and RPC calls. Preserve the exact legacy loaders for unowned Jan records under clearly named compatibility functions.

- [ ] **Step 4: Update attendance-only consumers**

Manager history, exceptions, currently-clocked-in, self-service history, dashboard attendance counts and attendance-only weekly preview consume the tenant-aware path. Do not change payroll tables or formulas.

- [ ] **Step 5: Verify GREEN and UI regression**

Run adapter, self-service, manager-view, dashboard, kiosk and payroll regression tests.

### Task 7: Documentation and security audit

**Files:**
- Create: `docs/commercial/attendance-tenancy.md`
- Modify: `docs/commercial/customer-domain-conversion.md`
- Modify: `README.md`
- Modify: `tests/migration-history.test.ts` only if its expected migration inventory is explicit.

**Interfaces:**
- Documents the removal condition for every legacy path and the exact Workstream 6 payroll dependency boundary.

- [ ] **Step 1: Write the attendance tenancy document**

Include ER and data-flow diagrams, occurrence-site snapshot, correction/exception inheritance, device-derived ownership, RLS/RPC/grants, lock identity, idempotency scope, effective grouping, Jan compatibility removal gates, payroll dependencies and Jan rehearsal requirements.

- [ ] **Step 2: Audit every attendance `SECURITY DEFINER` function**

Assert empty or pinned `search_path`, fully qualified relations, `auth.uid()` or device validation, membership/site checks, narrow return fields, explicit revocations and only necessary grants.

- [ ] **Step 3: Self-review scope**

Confirm no payroll table, billing, onboarding, offline enablement or Jan backfill appears in the diff.

### Task 8: Review, complete verification and milestone commit

**Files:**
- Review all Workstream 5 files.

- [ ] **Step 1: Request independent code review**

Provide the Workstream 5 brief, base SHA `13144eebc3054ff9804b776a48037ebab28e289f`, current diff and verification evidence. Resolve every Critical and Important finding using a new failing test first.

- [ ] **Step 2: Run the complete verification matrix**

Run full Vitest, focused tenant/site/state/correction/exception/self-service/security/concurrency suites, migration history, PGlite replay, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run audit:dependencies`, `npm.cmd run verify:browser-bundle` and `git diff --check`.

- [ ] **Step 3: Verify repository and environment safety**

Confirm branch is `codex/commercial-production`, remote production was never accessed, offline remains disabled, historical migrations are unchanged and only intended files are staged.

- [ ] **Step 4: Commit the milestone**

Run: `git commit -m "Attendance Tenancy"`

- [ ] **Step 5: Report exact final state**

Provide all 17 requested deliverables, commit SHA and clean/dirty worktree status. Do not begin Workstream 6.
