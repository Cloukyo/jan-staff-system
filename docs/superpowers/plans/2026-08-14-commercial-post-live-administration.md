# Commercial Post-Live Administration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide secure normal administration for live commercial organisations without reopening onboarding or changing Jan compatibility.

**Architecture:** Existing commercial tables remain authoritative. A single versioned post-live command boundary resolves the authenticated membership, permissions, site scope, AAL and entitlements in PostgreSQL, writes append-only audit evidence and idempotent receipts, and returns typed safe results. Server components load a permission-filtered snapshot and server actions submit commands; the browser never supplies trusted tenant or privilege values.

**Tech Stack:** Next.js App Router, React 19 server actions, TypeScript, Zod, Supabase Auth/Postgres/RLS, PostgreSQL/pgTAP, Vitest/PGlite, Tailwind-compatible platform styles.

## Global Constraints

- Stay on `codex/commercial-production`; keep PR #8 Draft and unmerged.
- Do not modify Jan production or deploy to Vercel Production.
- Do not implement billing-provider integration, offboarding, onboarding redesign or security-hardening remediation.
- Offline attendance and offline authorisation remain disabled.
- Preserve all attendance, rota, leave, payroll, compliance and kiosk evidence.
- Use Europe/London and UK date/time presentation.
- Commercial operations fail closed and never fall back to unowned Jan rows.

---

### Task 1: Administration contracts and database boundary

**Files:**
- Create: `tests/commercial-post-live-admin-schema.test.ts`
- Create: `tests/commercial-post-live-admin-db.test.ts`
- Create: `tests/helpers/commercial-post-live-admin-db.ts`
- Create: `supabase/migrations/20260814170000_commercial_post_live_administration.sql`
- Create: `supabase/tests/commercial_post_live_administration.sql`

**Interfaces:**
- Produces `public.get_commercial_admin_snapshot(uuid, uuid)`.
- Produces `public.execute_commercial_admin_command(uuid, text, jsonb, uuid, bigint)`.
- Produces append-only `commercial_admin_events` and private `commercial_admin_command_receipts`.

- [ ] Write schema and behavioural tests for live-state checks, AAL2, permissions, entitlement limits, isolation, stale revisions, idempotency, owner continuity, effective assignments, archival and offline-disabled devices.
- [ ] Run the focused tests and confirm they fail because the migration/contracts do not exist.
- [ ] Implement the additive migration and pgTAP checks.
- [ ] Run focused tests, migration-history verification and PGlite replay until green.

### Task 2: Typed service and server actions

**Files:**
- Create: `src/lib/commercial-admin/contracts.ts`
- Create: `src/lib/commercial-admin/server.ts`
- Create: `src/lib/commercial-admin/actions.ts`
- Create: `tests/commercial-post-live-admin-service.test.ts`

**Interfaces:**
- Produces `loadCommercialAdminSnapshot()` and `executeCommercialAdminCommand()`.
- Produces server actions for organisation/site/settings/staff/assignment/membership/work-area/closure/device/PIN operations.

- [ ] Write failing parser, command-mapping and error-contract tests.
- [ ] Implement strict Zod schemas and request-bound context loading.
- [ ] Implement actions with UUID idempotency, expected revisions, revalidation and safe messages.
- [ ] Run service tests, typecheck and lint.

### Task 3: Permission-aware commercial shell

**Files:**
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/lib/navigation/manager-navigation.ts`
- Create: `src/components/commercial-admin/commercial-admin-shell.tsx`
- Create: `tests/commercial-admin-navigation.test.ts`

**Interfaces:**
- Produces commercial navigation filtered from server-authoritative permissions.
- Reuses the signed/verified organisation and site preference only for navigation context.

- [ ] Write failing navigation visibility and selected-site tests.
- [ ] Implement permission-tagged navigation and organisation/site context presentation.
- [ ] Verify keyboard navigation, mobile drawer and 44px targets.

### Task 4: Post-live administration screens

**Files:**
- Create: `src/app/admin/page.tsx`
- Create: `src/app/admin/organisation/page.tsx`
- Create: `src/app/admin/sites/page.tsx`
- Create: `src/app/admin/staff/page.tsx`
- Create: `src/app/admin/access/page.tsx`
- Create: `src/app/admin/devices/page.tsx`
- Create: `src/app/admin/settings/page.tsx`
- Create: `src/components/commercial-admin/admin-overview.tsx`
- Create: `src/components/commercial-admin/organisation-admin.tsx`
- Create: `src/components/commercial-admin/site-admin.tsx`
- Create: `src/components/commercial-admin/staff-admin.tsx`
- Create: `src/components/commercial-admin/access-admin.tsx`
- Create: `src/components/commercial-admin/device-admin.tsx`
- Create: `src/components/commercial-admin/settings-admin.tsx`
- Modify: `src/app/visual-commercial-preview/page.tsx`

**Interfaces:**
- Consumes only the safe commercial administration snapshot and server actions.
- Provides organisation profile, sites/settings/closures/work areas, staff lifecycle/assignments, access/invitations, device lifecycle and PIN readiness.

- [ ] Add component tests for permissions, empty states, safe destructive copy and validation retention.
- [ ] Implement reusable page headers, summary/list panels, forms and status states using the established commercial visual language.
- [ ] Add a fictional `state=admin` visual fixture with no production or Jan data.
- [ ] Run component tests and production build.

### Task 5: Regression, Preview and release checkpoint

**Files:**
- Modify: `docs/commercial/README.md`
- Create: `docs/commercial/post-live-administration.md`

- [ ] Run full Vitest, tenant/site isolation, identity, attendance, payroll, rota/leave, invitation, kiosk, entitlement and migration suites.
- [ ] Run TypeScript, ESLint, build, dependency audit and browser sensitive-marker scan.
- [ ] Review desktop/tablet/mobile, keyboard, focus, 200% zoom and horizontal overflow.
- [ ] Push the milestone to the Draft PR, wait for Docker replay, pgTAP, schema lint, CodeQL, Gitleaks and dependency review.
- [ ] Apply only to `commercial-dev`, exercise the fictional post-live E2E and compare Supabase advisor counts/surface.
- [ ] Confirm offline-enabled devices and offline authorisations remain zero, Jan production is untouched and no Production deployment occurred.
- [ ] Commit as `Commercial Post-Live Administration` and report exact SHA/worktree state.
