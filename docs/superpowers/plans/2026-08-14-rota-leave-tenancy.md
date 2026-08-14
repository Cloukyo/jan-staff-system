# Workstream 8A Rota and Leave Tenancy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the inherited rota and leave subsystem into an organisation- and site-aware commercial boundary while preserving the named Jan compatibility path and all existing attendance evidence and payroll calculations.

**Architecture:** Keep the inherited tables and add nullable commercial ownership columns so historic unowned Jan rows remain valid. Commercial reads and writes use server-resolved membership context and guarded database commands with composite tenant fences, site-scoped permissions, revisions, idempotency and append-only audit evidence. Existing Jan loaders/actions remain available only through explicitly named compatibility adapters.

**Tech Stack:** Next.js App Router, TypeScript, React, Supabase Auth/PostgREST, PostgreSQL 17, PL/pgSQL, RLS, Vitest, PGlite, pgTAP.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge into `main` or deploy to Vercel Production.
- Use additive migrations only; do not edit recorded migration bodies or backfill/guess Jan ownership.
- Keep offline attendance disabled and do not create offline authorisation.
- Do not change attendance pairing, original clock events, correction evidence or Workstream 6 payable-minute calculations.
- Leave remains organisation/staff owned; rota weeks and shifts are organisation/site owned.
- Resolve organisation, site, membership, staff ownership and permissions on the server/database boundary.
- Use UK display formats and authoritative Europe/London date semantics.
- Preserve the demo repository and local-storage functionality in demo mode.

---

### Task 1: Executable tenancy schema contract

**Files:**
- Create: `tests/rota-leave-tenancy-schema.test.ts`
- Create: `tests/rota-leave-tenancy-db.test.ts`
- Create: `tests/helpers/rota-leave-tenancy-db.ts`
- Create: `supabase/migrations/<generated>_rota_leave_tenancy.sql`
- Modify: `supabase/tests/commercial_tenancy.sql`

**Interfaces:**
- Produces nullable `organisation_id`/`site_id` compatibility columns, commercial revisions, composite foreign keys, audit tables, indexes, RLS policies and private/public command boundaries.
- Preserves unowned legacy rows while rejecting partially owned commercial rows.

- [ ] Write schema tests asserting every commercial ownership column, composite foreign key, uniqueness rule, immutable ownership trigger, index, RLS policy, grant and helper revocation.
- [ ] Run `npx vitest run tests/rota-leave-tenancy-schema.test.ts` and verify the new assertions fail.
- [ ] Discover the installed CLI with `npx supabase --help` and create the migration using `npx supabase migration new rota_leave_tenancy`.
- [ ] Add ownership/revision/audit columns to all seven operational tables, composite tenant constraints, site/work-area/staff fences, commercial-only uniqueness, append-only audit events and command receipts.
- [ ] Replace broad commercial access with membership/site RLS while retaining explicit predicates for wholly unowned Jan rows.
- [ ] Add initial pgTAP assertions for anonymous denial, cross-tenant denial, site scope and private helper revocation.
- [ ] Run the focused schema and PGlite tests until green.

### Task 2: Guarded commercial rota commands

**Files:**
- Modify: `supabase/migrations/<generated>_rota_leave_tenancy.sql`
- Modify: `tests/rota-leave-tenancy-db.test.ts`
- Create: `src/lib/rota/tenant-types.ts`
- Create: `src/lib/rota/tenant-service.ts`
- Create: `tests/rota-tenant-service.test.ts`

**Interfaces:**
- Produces typed commands for week creation/status, shift create/update/archive, copy week/day and safe conflict results.
- Commands accept target IDs, expected revision and idempotency UUID but derive actor ownership and audit identity authoritatively.

- [ ] Write failing database tests for organisation/site isolation, assignment-on-shift-date, work-area site ownership, immutable occurrence site, stale revision, duplicate replay and simultaneous cross-site overlap.
- [ ] Add private lock/validation helpers and narrow authenticated RPCs for commercial rota commands.
- [ ] Use advisory/row locks keyed by organisation/staff/date before overlap checks so concurrent site schedulers cannot both succeed.
- [ ] Return stable codes for `workflow_changed`, `permission_denied`, `assignment_required`, `cross_site_overlap`, `approved_leave_conflict`, `site_closed`, `idempotency_conflict` and `not_found` without disclosing inaccessible site details.
- [ ] Add TypeScript envelopes/parsers and a server service that invokes only the guarded RPC.
- [ ] Run the focused DB/service tests until green.

### Task 3: Tenant-safe templates and copy operations

**Files:**
- Modify: `supabase/migrations/<generated>_rota_leave_tenancy.sql`
- Create: `tests/rota-template-tenancy-db.test.ts`
- Modify: `src/lib/rota/template-server.ts`
- Modify: `src/lib/rota/template-actions.ts`
- Modify: `src/lib/rota/template-types.ts`

**Interfaces:**
- Produces organisation/site-owned templates and guarded duplicate/save/apply/copy operations.
- Revalidates assignments, leave, closures, work areas and cross-site overlaps for destination dates.

- [ ] Write failing tests for same-site success, cross-organisation guessed IDs, wrong-site work areas, destination assignment changes, leave recalculation, cross-site overlap and replay.
- [ ] Add commercial template commands and tenant-scoped request receipts.
- [ ] Route commercial template loaders/actions through membership context and the new commands; retain named Jan functions unchanged.
- [ ] Verify source weeks/templates remain immutable and copied shifts snapshot the destination site.
- [ ] Run template tenancy and existing template tests until green.

### Task 4: Organisation-owned leave commands

**Files:**
- Modify: `supabase/migrations/<generated>_rota_leave_tenancy.sql`
- Create: `src/lib/leave/tenant-types.ts`
- Create: `src/lib/leave/tenant-service.ts`
- Modify: `src/lib/leave/server.ts`
- Create: `tests/leave-tenancy-db.test.ts`
- Create: `tests/leave-tenant-service.test.ts`

**Interfaces:**
- Produces self-service create/cancel and privileged review commands with organisation ownership, linked-staff identity, revision/idempotency and affected-shift conflict summaries.
- Leave has no mandatory site owner; optional source site is context only.

- [ ] Write failing tests for own-profile creation, cross-profile denial, cross-organisation isolation, multi-site applicability, manager scope, AAL2 review, duplicate review and stale revision.
- [ ] Add guarded create/cancel/review RPCs and prevent direct commercial lifecycle mutations.
- [ ] Define approval scope as organisation-wide `leave.manage`, or site-scoped `leave.manage` only when every effective assignment overlapping the leave period is within the actor's permitted sites.
- [ ] Append review evidence and return affected shift/site IDs only when the actor may read those sites; otherwise return counts and a generic conflict code.
- [ ] Add the commercial service/adapter while keeping legacy Jan exports explicit.
- [ ] Run focused leave tests and existing leave calculations until green.

### Task 5: Authoritative planned-hours integration

**Files:**
- Create: `src/lib/rota/planned-hours.ts`
- Modify: `src/lib/attendance/staff-hours.ts`
- Modify: `src/lib/attendance/correction-actions.ts`
- Modify: `src/lib/payroll/tenant-server.ts`
- Create: `tests/commercial-planned-hours.test.ts`
- Modify: `tests/attendance-tenant-adapters.test.ts`
- Modify: `tests/payroll-tenant-server-scoping.test.ts`

**Interfaces:**
- Produces one organisation/site/date-scoped published-shift loader used by attendance and payroll.
- Does not create attendance or payable minutes; it supplies planned context only.

- [ ] Write failing tests for per-site minutes, organisation totals, multi-site counting once, tenant isolation and invalid overlap exclusion.
- [ ] Implement the paginated authoritative adapter over published commercial weeks/shifts with explicit organisation/site filters.
- [ ] Replace commercial empty-shift fallbacks in staff-hours and payroll with the adapter.
- [ ] Re-enable commercial planned-hours correction/reset only through a tenant-aware database command that revalidates the published shift fingerprint and never mutates original clock events.
- [ ] Run attendance, payroll and planned-hours regression suites until green.

### Task 6: Commercial route and UI context

**Files:**
- Modify: `src/app/rota/page.tsx`
- Modify: `src/app/rota/templates/page.tsx`
- Modify: `src/app/leave/page.tsx`
- Modify: `src/app/leave/request/page.tsx`
- Modify: `src/app/leave/requests/page.tsx`
- Modify: `src/components/rota/production-rota.tsx`
- Modify: `src/components/rota/production-rota-grid.tsx`
- Modify: `src/components/leave/production-leave.tsx`
- Modify: `src/lib/rota/server.ts`
- Create: `tests/rota-leave-commercial-ui.test.tsx`

**Interfaces:**
- Produces selected-site rota loading/editing and organisation-owned leave screens without redesigning the established interface.
- Preserves demo mode and named Jan compatibility rendering.

- [ ] Write failing route/component tests for server-derived site selection, visible site context, neutral work-area labels, generic hidden-site conflict copy, keyboard labels and no production demo fallback.
- [ ] Resolve commercial membership/site context before loading rota; reject injected inaccessible site IDs.
- [ ] Add the existing commercial site selector pattern and retain week selection/query parameters.
- [ ] Show conflict and closure codes accessibly; organisation-wide schedulers may receive authorised site details.
- [ ] Convert leave pages to linked commercial staff and permission-aware manager views.
- [ ] Run the focused UI tests and React best-practices review.

### Task 7: Compatibility, documentation and complete local verification

**Files:**
- Modify: `docs/commercial/compatibility.md` or the current equivalent
- Create: `docs/commercial/rota-leave-tenancy.md`
- Modify: `README.md`
- Modify: relevant migration-history and sensitive-marker tests

**Interfaces:**
- Documents the owned commercial path, wholly unowned Jan path, removal gates and Workstream 8B boundary.

- [ ] Document all seven tables, command boundaries, permission/scope policy, date semantics, conflict disclosure, planned-hours consumer flow and compatibility removal conditions.
- [ ] Run focused rota, leave, tenant/site isolation, attendance, payroll, onboarding/Go Live, RLS/grant, idempotency and Jan regression tests.
- [ ] Run `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, migration-history verification, PGlite replay, dependency audit, Gitleaks and browser sensitive-marker scan.
- [ ] Run clean Docker Supabase replay, pgTAP and schema lint.
- [ ] Fix only Workstream 8A failures and repeat verification until green.

### Task 8: Commercial Preview proof and milestone checkpoint

**Files:**
- Modify only if verification exposes a Workstream 8A defect.

**Interfaces:**
- Produces a verified Draft PR checkpoint and healthy commercial Preview without Production deployment.

- [ ] Commit the milestone as `Rota and Leave Tenancy` after local verification.
- [ ] Push `codex/commercial-production` normally and verify Draft PR #8 remains open, Draft and unmerged.
- [ ] Wait for all GitHub workflows, CodeQL, Gitleaks, dependency review, Docker replay and pgTAP; fix only 8A failures.
- [ ] Apply the additive migration only to Supabase Preview `commercial-dev` and verify repository/remote migration history.
- [ ] Exercise the specified two-site fictional flow, cross-site overlap denial, multi-site leave conflict, planned-vs-actual comparison, payroll regression and second-organisation isolation.
- [ ] Inspect desktop, tablet, mobile, keyboard and 200% zoom states and correct only necessary tenancy/accessibility issues.
- [ ] Confirm Vercel Preview is READY at the verified SHA, offline remains disabled, Jan production was untouched and the worktree is clean.
