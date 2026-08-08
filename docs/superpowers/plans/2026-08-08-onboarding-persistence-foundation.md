# Onboarding Persistence Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist the approved commercial onboarding workflow state, step state, replay receipts and append-only events without implementing onboarding commands or UI.

**Architecture:** Add four version-1 relational tables behind RLS and explicit grants. Bootstrap reads are limited to the authenticated owner while post-organisation reads require an active membership with an onboarding permission; all authenticated direct writes remain revoked. Constraints and triggers enforce contract versions, tenant linkage, privacy-safe JSON, optimistic revisions, terminal receipt replay safety and immutable events.

**Tech Stack:** PostgreSQL/Supabase migrations, RLS, pgTAP, PGlite, Vitest.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge, push or deploy.
- Do not connect to or modify Jan production.
- Keep offline attendance disabled and add no offline authorisation.
- Do not add UI, billing, tenant migration, readiness evaluation or full onboarding execution.
- Preserve the version-1 TypeScript contracts as the application authority.

---

### Task 1: Persistence contract tests

**Files:**
- Create: `tests/helpers/onboarding-persistence-db.ts`
- Create: `tests/onboarding-persistence-db.test.ts`
- Create: `supabase/tests/onboarding_persistence.sql`

**Interfaces:**
- Consumes: the Workstream 2 organisation, membership, permission and RLS primitives.
- Produces: executable tests for version constraints, tenant isolation, bootstrap access, append-only evidence, revision control, idempotency, safe metadata and least-privilege grants.

- [x] Write PGlite tests that expect the four onboarding tables and their production invariants.
- [x] Run `npm test -- --run tests/onboarding-persistence-db.test.ts` and confirm failure because the migration does not exist.
- [x] Add a pgTAP contract that exercises the same security boundaries on a fully replayed Supabase database.

### Task 2: Additive onboarding persistence migration

**Files:**
- Create with `supabase migration new onboarding_workflow_persistence`: `supabase/migrations/20260808162827_onboarding_workflow_persistence.sql`

**Interfaces:**
- Consumes: `auth.users`, `public.organisations`, `public.organisation_memberships`, `private.role_permissions`, `private.has_permission` and the version-1 onboarding contracts.
- Produces: `public.onboarding_sessions`, `public.onboarding_step_states`, `public.onboarding_events`, `public.onboarding_command_receipts`, supporting private validators/triggers, indexes, RLS policies and explicit grants.

- [x] Create the migration through the pinned Supabase CLI.
- [x] Implement exact workflow/status/type constraints and composite tenant foreign keys.
- [x] Implement recursive sensitive-key rejection and allowlisted safe event/result JSON validation.
- [x] Enforce one active bootstrap session per owner, command idempotency uniqueness, terminal receipt immutability, exact revision increments and append-only events.
- [x] Enable RLS, grant authenticated read-only access, grant narrowly required service-role writes, and revoke all anonymous/direct authenticated writes.
- [x] Run the focused PGlite test until it passes.

### Task 3: Replay and repository verification

**Files:**
- Modify only the five test/plan/migration files above if verification exposes a scoped defect.

**Interfaces:**
- Consumes: the complete migration chain and all Workstream 7 contract/persistence tests.
- Produces: a locally committed, database-only persistence checkpoint.

- [x] Run relevant unit and database tests, including the versioned contract tests.
- [x] Run migration-history verification; attempt pgTAP locally and record the unavailable Docker runtime for CI execution.
- [x] Run typecheck, lint and production build.
- [x] Run Gitleaks against every added file and confirm no environment, deployment, attendance, payroll, billing or offline changes.
- [x] Review the final diff, commit locally once, and verify the worktree is clean and unpushed.
