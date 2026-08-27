# Onboarding Application Service Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute versioned onboarding foundation commands through one transactional, tenant-safe server boundary and return validated server-authoritative readiness.

**Architecture:** A server-only TypeScript service parses the frozen command envelope and calls one authenticated Supabase RPC. The RPC owns locking, authorisation, request hashing, command receipts, optimistic revisions, step/session updates, append-only safe events and conservative readiness evaluation in one PostgreSQL transaction. Only `save_step_draft` and `evaluate_readiness` execute in this foundation task; later domain commands return a stable unavailable result.

**Tech Stack:** TypeScript, Zod, Supabase RPC, PostgreSQL PL/pgSQL, PGlite, Vitest and pgTAP.

## Global Constraints

- Stay on `codex/commercial-production`; do not push, merge or deploy.
- Do not connect to or modify Jan production.
- Do not add UI, billing, tenant migration or full onboarding execution.
- Keep offline attendance disabled and issue no offline authorisation.
- Preserve the version-1 contracts and existing tenant/RLS boundaries.

---

### Task 1: Service and transaction contract tests

**Files:**
- Create: `tests/onboarding-service.test.ts`
- Create: `tests/onboarding-service-db.test.ts`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Modify: `supabase/tests/onboarding_persistence.sql`

**Interfaces:**
- Consumes: frozen onboarding command/readiness schemas and the four persistence stores.
- Produces: executable tests for success, replay, conflicts, indeterminate state, readiness safety, privacy-safe events and tenant permission enforcement.

- [x] Write service tests against the wished-for `executeOnboardingCommand` API and verify they fail because the service does not exist.
- [x] Write PGlite tests against `public.execute_onboarding_foundation_command(jsonb)` and verify they fail because the RPC migration does not exist.
- [x] Extend pgTAP coverage for RPC grants and authenticated tenant boundaries.

### Task 2: Transactional database command boundary

**Files:**
- Create with the pinned Supabase CLI: `supabase/migrations/*_onboarding_application_service_foundation.sql`

**Interfaces:**
- Consumes: an exact version-1 command envelope and `auth.uid()`.
- Produces: `public.execute_onboarding_foundation_command(jsonb) -> jsonb` and private request/readiness helpers.

- [x] Extend command receipts with the immutable result fields required for exact replay.
- [x] Implement a private conservative readiness evaluator that never accepts client readiness and rejects `offline_disabled` bypass semantics.
- [x] Lock and authorise the session, hash the exact command, claim/replay the receipt, enforce expected revisions, update draft/session state, append derived safe events and complete the receipt atomically.
- [x] Revoke default function access and grant only the authenticated role permission to execute the narrow RPC.
- [x] Run focused PGlite tests until all database behaviours pass.

### Task 3: Server-only application service

**Files:**
- Create: `src/lib/onboarding/service.ts`
- Create: `src/lib/onboarding/server.ts`

**Interfaces:**
- Consumes: `unknown` command input and an authenticated RPC dependency.
- Produces: `executeOnboardingCommand(input, dependencies?) -> OnboardingServiceResult` with a validated command result and authoritative readiness or a safe indeterminate response.

- [x] Parse the command with `onboardingCommandSchema` before calling the RPC.
- [x] Strictly parse the RPC result with the frozen command/readiness schemas and enforce matching session, command and revision evidence.
- [x] Treat transport ambiguity or malformed authoritative responses as `indeterminate` with `dataState: unknown`; never invent readiness.
- [x] Reject any required blocker reported as `not_applicable`, including `offline_disabled`.
- [x] Run focused service and database tests until green.

### Task 4: Verification and local checkpoint

**Files:**
- Modify only the scoped plan, service, migration and onboarding test files if verification exposes a defect.

- [x] Run onboarding contract, service, persistence and tenant-isolation tests.
- [x] Run migration-history verification and attempt local pgTAP replay (Docker is not installed locally; pgTAP remains enforced by CI).
- [x] Run typecheck, ESLint, the full Vitest suite and production build.
- [x] Run Gitleaks and a scoped personal/production-data scan over all added fixtures.
- [ ] Review the final diff, commit once locally, and verify a clean worktree without pushing.
