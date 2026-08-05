# Core Platform Neutralisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor the isolated commercial branch into an industry-neutral workforce operations platform while preserving existing nursery behaviour through profiles and compatibility readers.

**Architecture:** Central platform modules will own product identity, industry terminology, demo presets and compliance-pack descriptors. Application code will consume those modules instead of customer strings. Neutral database columns and browser identifiers will be introduced additively, with legacy fields and keys retained as compatibility inputs.

**Tech Stack:** Next.js 16, React 19, TypeScript, Supabase/Postgres, Vitest, ExcelJS, service workers and IndexedDB.

## Global Constraints

- Work only on `codex/commercial-production`.
- Do not modify Jan production or merge into `main`.
- Do not implement tenant primitives, organisations, sites, memberships, billing or onboarding.
- Do not change attendance logic, permissions, payroll calculations or business rules.
- Preserve original clock events and all existing migration files.
- Keep offline attendance disabled by default.
- Preserve legacy browser data, device cookies, service-worker caches and API consumers.
- Use UK date, time and currency formats and Europe/London timezone.

---

### Task 1: Product identity and industry profiles

**Files:**
- Create: `src/lib/platform/branding.ts`
- Create: `src/lib/platform/industry-profile.ts`
- Test: `tests/platform-profile.test.ts`

**Interfaces:**
- Produces: `getPlatformBranding(env)`, `IndustryProfileId`, `IndustryProfile`, `getIndustryProfile(value)` and `getActiveIndustryProfile(env)`.
- Profiles: `nursery`, `care_home`, `tuition_centre`, `clinic`.

- [ ] Write tests asserting placeholder branding, configurable branding, all four profile labels, compliance pack IDs, work-area labels, role examples and compatibility fallback.
- [ ] Run `npm.cmd test -- tests/platform-profile.test.ts` and verify failure because the modules do not exist.
- [ ] Implement immutable branding and profile descriptors without UI or database dependencies.
- [ ] Re-run the focused test and verify it passes.

### Task 2: Neutral demo presets and core settings types

**Files:**
- Create: `src/lib/demo-data/presets.ts`
- Modify: `src/lib/demo-data/seed.ts`
- Modify: `src/lib/compliance/demo-data.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/dates/app-clock.ts`
- Modify: `src/lib/calculations/attendance.ts`
- Modify: `src/lib/repositories/demo-store.tsx`
- Modify: `src/lib/repositories/local-persistence.ts`
- Test: `tests/demo-presets.test.ts`
- Test: `tests/repository-persistence.test.ts`

**Interfaces:**
- Produces: `PlatformSettings`, deprecated compatibility alias `NurserySettings`, `createDemoSeed(profileId)` and sector-specific role, work-area, email-domain and compliance examples.

- [ ] Write failing tests showing each profile produces distinct neutralised demo content and old serialized settings still hydrate into `PlatformSettings`.
- [ ] Run the focused tests and verify the missing APIs fail.
- [ ] Extract the nursery fixture into a nursery preset, add care-home, tuition-centre and clinic presets, and make seed creation profile-driven.
- [ ] Keep legacy `nurseryDisplayName` as an input-only hydration alias while writing organisation/site display names.
- [ ] Re-run focused tests and verify they pass.

### Task 3: Compliance pack descriptors

**Files:**
- Create: `src/lib/compliance/modules.ts`
- Modify: `src/lib/calculations/compliance.ts`
- Modify: `src/components/compliance/production-compliance-screen.tsx`
- Modify: `src/components/compliance/production-compliance-detail.tsx`
- Modify: `src/components/compliance/staff-compliance-screen.tsx`
- Modify: `src/components/compliance/staff-compliance-detail.tsx`
- Test: `tests/compliance-modules.test.ts`
- Test: `tests/compliance.test.ts`

**Interfaces:**
- Produces: `CompliancePack`, `ComplianceRequirement`, `getCompliancePack(id)` and profile-selected requirement labels.
- Keeps existing DBS, safeguarding, central-record and paediatric-first-aid storage and actions unchanged.

- [ ] Write failing tests proving different profiles select different visible requirements while the nursery pack retains existing checks.
- [ ] Run focused compliance tests and verify the new behavior is absent.
- [ ] Implement descriptor-driven requirement summaries and labels; do not delete or rewrite stored legacy compliance evidence.
- [ ] Re-run focused compliance tests and verify they pass.

### Task 4: Neutral work-area persistence and DTOs

**Files:**
- Create: `supabase/migrations/<timestamp>_core_platform_neutralisation.sql` using `supabase migration new`.
- Modify: `src/lib/rota/types.ts`
- Modify: `src/lib/rota/template-types.ts`
- Modify: `src/lib/rota/server.ts`
- Modify: `src/lib/rota/template-server.ts`
- Modify: `src/lib/rota/actions.ts`
- Modify: `src/lib/rota/template-actions.ts`
- Modify: rota, template, dashboard and self-service components that consume `roomOrArea`.
- Test: `tests/platform-neutral-migration.test.ts`
- Test: existing rota tests.

**Interfaces:**
- Canonical database fields: `available_work_areas`, `work_area`, `operational_context`.
- Legacy compatibility fields: `available_rooms`, `room_or_area`, `nursery_context` remain synchronized.
- Canonical TypeScript fields: `availableWorkAreas`, `workArea`; legacy aliases remain accepted at boundaries.

- [ ] Write a failing migration-contract test for additive neutral columns, backfill and bidirectional compatibility triggers.
- [ ] Use `npm.cmd exec -- supabase migration new core_platform_neutralisation` to create the migration file.
- [ ] Implement additive columns and trigger-based legacy synchronization without touching attendance tables or permissions.
- [ ] Write failing mapper/action tests that expect neutral fields and legacy fallback.
- [ ] Update DTOs, repositories, actions and UI to use neutral fields while accepting legacy data.
- [ ] Run migration-history and rota test suites and verify they pass.

### Task 5: Browser, cookie and service-worker compatibility

**Files:**
- Create: `src/lib/platform/browser-identifiers.ts`
- Modify: `src/lib/repositories/demo-store.tsx`
- Modify: `src/lib/repositories/local-persistence.ts`
- Modify: `src/lib/compliance/demo-data.ts`
- Modify: `src/lib/kiosk/device-session.ts`
- Modify: `middleware.ts`
- Modify: `src/lib/kiosk/offline/database.ts`
- Modify: `src/components/kiosk/use-offline-kiosk.ts`
- Modify: `src/components/app/prototype-app.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `public/sw.js`
- Test: persistence, offline database, service-worker and kiosk tests.

**Interfaces:**
- Neutral identifiers use a stable placeholder namespace such as `workforce-platform-*`.
- Every old `jan-*` key remains readable or actively migrated; old cookies and sync tags remain accepted.

- [ ] Write failing tests for legacy local-storage migration, legacy cookie fallback, IndexedDB migration, legacy cache cleanup and legacy sync-tag acceptance.
- [ ] Run the focused suites and verify each missing compatibility path fails.
- [ ] Implement shared identifier constants and one-way migrations to neutral identifiers.
- [ ] Re-run focused suites and verify they pass without dropping legacy data.

### Task 6: Neutral UI, help, settings and product metadata

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/manifest.ts`
- Modify: `src/components/ui/brand.tsx`
- Modify: login, dashboard, profile, settings, kiosk, rota, leave and help components identified by the audit.
- Modify: `src/lib/settings/server.ts`
- Modify: `src/lib/settings/actions.ts`
- Modify: `src/lib/navigation/manager-navigation.ts`
- Modify: `src/lib/help/manager-help.ts`
- Test: `tests/platform-copy.test.tsx`
- Test: navigation and help tests.

**Interfaces:**
- Core screens display neutral defaults; industry-specific labels come from `IndustryProfile`.
- Old nursery-named settings exports remain compatibility aliases only.

- [ ] Write failing rendering tests for placeholder branding and profile-driven Site Settings, work-area, job-role and help labels.
- [ ] Run focused tests and verify hardcoded copy causes expected failures.
- [ ] Replace scattered product/customer strings with branding and industry-profile values.
- [ ] Re-run focused tests and verify they pass.

### Task 7: Neutral exports, service identity and API compatibility

**Files:**
- Modify: `src/lib/exports/csv.ts`
- Modify: `src/lib/exports/xlsx.ts`
- Modify: `src/lib/exports/payroll-excel.ts`
- Modify: `src/lib/exports/rota-excel.ts`
- Modify: `src/app/payroll/export/route.ts`
- Modify: `src/lib/observability/health.ts`
- Test: export, health and route tests.

**Interfaces:**
- Export identity comes from branding plus configured organisation/site placeholders.
- Health service identifier is neutral and stable.
- Existing route paths and attendance/kiosk RPC names remain unchanged.

- [ ] Write failing tests for neutral filenames, workbook metadata/headings and health service identity.
- [ ] Run focused tests and verify current Jan strings fail expectations.
- [ ] Route metadata through central branding and export identity helpers.
- [ ] Re-run focused tests and verify they pass.

### Task 8: Documentation, audit sweep and milestone verification

**Files:**
- Modify: `README.md`
- Create: `docs/commercial/platform-neutrality.md`
- Modify: `.env.example`
- Modify: tests affected by intentional terminology changes.

**Interfaces:**
- Documents describe one core platform, four industry profiles, compliance packs, work areas, branding placeholders and compatibility guarantees.

- [ ] Document configuration variables and module boundaries without changing approved tenancy or onboarding architecture.
- [ ] Run `rg` across application, public assets and new migration; classify every remaining Jan/nursery term as a deliberate legacy compatibility alias or nursery-profile value.
- [ ] Run `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, `npm.cmd run verify:migrations`, `npm.cmd audit --audit-level=high` and a production build using isolated preview values.
- [ ] Review `git diff --check`, confirm no attendance-engine or permission behavior changes, stage the exact scope and commit as `Core Platform Neutralisation`.
