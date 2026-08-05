# Tenant Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish additive organisation, site, membership, role, site-access, staff-assignment and settings primitives with database-enforced tenant isolation while leaving existing single-organisation workflows unchanged.

**Architecture:** New tenant-owned tables live in `public`, carry `organisation_id`, use composite tenant foreign keys and enable RLS. Stable authorization helpers live in the unexposed `private` schema; the small helpers that must read RLS-protected membership data use `SECURITY DEFINER`, pin an empty search path, validate `auth.uid()` internally and expose only boolean or membership-ID results. Existing `staff_profiles` receives only a nullable ownership bridge and composite unique key; no existing row is backfilled and no operational table is converted.

**Tech Stack:** PostgreSQL 17, Supabase Auth and RLS, Supabase CLI 2.111, PGlite, TypeScript, Vitest.

## Global Constraints

- Work only on `codex/commercial-production`; do not merge into `main`, deploy, or connect to Jan production.
- Use additive migrations only. Do not rewrite existing migrations or remove compatibility layers.
- Do not change attendance, payroll, onboarding, billing, offline attendance, UI behaviour or existing operational-table names.
- Do not migrate Jan data or make ownership mandatory on existing operational records.
- Preserve UK formats and `Europe/London` defaults.
- Use fixed roles only: `organisation_owner`, `organisation_admin`, `hr_admin`, `payroll_admin`, `site_manager`, `scheduler`, `staff`.
- Use explicit grants, RLS on every new public table, composite tenant foreign keys and indexed RLS/FK columns.

---

### Task 1: Executable two-tenant harness

**Files:**
- Create: `tests/helpers/tenant-primitives-db.ts`
- Create: `tests/tenant-primitives-db.test.ts`
- Create with CLI: `supabase/migrations/<timestamp>_tenant_primitives.sql`

**Interfaces:**
- Produces `createTenantPrimitivesDatabase()` returning a PGlite database with `auth.uid()`, `anon`, `authenticated`, a minimal inherited `staff_profiles` table and the tenant migration applied.
- Produces deterministic IDs for Organisation A, Organisation B, Sites A1/A2/B1, owner/admin/site-manager/multi-organisation users, memberships and staff.
- Produces `setTenantAuthUser(db, authUserId)` and `setTenantDatabaseRole(db, role)` helpers.

- [ ] **Step 1: Generate the blank migration through the CLI**

Run: `npm.cmd exec -- supabase migration new tenant_primitives`

Expected: one empty timestamped migration after the neutralisation migration.

- [ ] **Step 2: Write the database harness and behaviour-first tests**

The tests must execute SQL as `authenticated`, use literal fixture IDs, and assert real query results or PostgreSQL errors. Cover:

```ts
expect(await visibleOrganisationIds(db, USER_A_OWNER)).toEqual([ORG_A]);
expect(await visibleOrganisationIds(db, USER_MULTI)).toEqual([ORG_A, ORG_B]);
await expect(insertCrossTenantSiteAccess(db)).rejects.toThrow();
expect(await hasSitePermission(db, USER_A_SITE_MANAGER, ORG_A, SITE_A1, "rota.manage")).toBe(true);
expect(await hasSitePermission(db, USER_A_SITE_MANAGER, ORG_A, SITE_A2, "rota.manage")).toBe(false);
```

Also assert organization-owner access across A1 and A2, revoked membership denial, cross-organisation insert/update denial, composite-FK rejection, no orphan staff/site references and no cross-tenant join rows.

- [ ] **Step 3: Run the tests and verify RED**

Run: `npm.cmd test -- tests/tenant-primitives-db.test.ts`

Expected: FAIL because the blank migration creates none of the required tables or helpers.

---

### Task 2: Additive tenant schema and relational fences

**Files:**
- Modify: `supabase/migrations/<timestamp>_tenant_primitives.sql`
- Test: `tests/tenant-primitives-db.test.ts`

**Interfaces:**
- Creates `public.organisations`, `public.organisation_sites`, `public.organisation_memberships`, `public.membership_role_assignments`, `public.membership_site_access`, `public.staff_site_assignments`, `public.organisation_settings`, `public.site_settings`, `public.organisation_invitations`, `public.organisation_invitation_roles`, and `public.organisation_invitation_site_access`.
- Creates `public.organisation_role`, `public.organisation_status`, `public.organisation_membership_status`, `public.membership_scope_type`, and `public.organisation_invitation_status` enums.
- Adds nullable `public.staff_profiles.organisation_id`, `unique (organisation_id, id)` and an organisation FK without changing existing rows.

- [ ] **Step 1: Define organisations and sites**

Use UUID primary keys, archive fields, `unique (organisation_id, id)`, `unique (organisation_id, slug)`, UK defaults, non-sensitive address/contact columns and `on delete restrict` ownership.

- [ ] **Step 2: Define memberships and role/site authorization records**

Memberships reference `auth.users`, optionally reference `(organisation_id, staff_id)`, allow one Auth user in many organisations, and enforce `unique (organisation_id, auth_user_id)`. Role assignments constrain site scope so `site_id` is present exactly when `scope_type = 'site'`. Site-access records carry grant/revocation timestamps and composite organisation/site/membership FKs.

- [ ] **Step 3: Define staff site assignments**

Require composite organisation/staff and organisation/site FKs, valid effective ranges, multiple non-primary assignments and at most one overlapping primary assignment. Implement overlap validation in a private trigger function with a fixed search path.

- [ ] **Step 4: Define organisation/site settings and invitation structure**

Organisation settings hold work-week defaults plus JSON policy/configuration documents. Site settings hold local times, closures and operational policies. Invitations store a normalized email, SHA-256 token hash only, expiry/state/audit fields, while normalized child rows enforce intended roles and site ownership.

- [ ] **Step 5: Add indexes and timestamp triggers**

Index every FK and RLS lookup beginning with `organisation_id`, plus active membership, active role, active site access, staff/site assignment and pending invitation lookup paths. Use a private `touch_updated_at()` trigger function.

- [ ] **Step 6: Run the focused tests**

Run: `npm.cmd test -- tests/tenant-primitives-db.test.ts`

Expected: schema/composite-integrity tests pass; authorization tests remain RED until Task 3.

---

### Task 3: Permission helpers and initial RLS framework

**Files:**
- Modify: `supabase/migrations/<timestamp>_tenant_primitives.sql`
- Test: `tests/tenant-primitives-db.test.ts`

**Interfaces:**
- Creates private role-permission catalogue covering the approved stable permission keys.
- Creates:

```sql
private.current_membership_id(target_organisation_id uuid) returns uuid
private.current_membership(target_organisation_id uuid) returns uuid
private.is_active_member(target_organisation_id uuid) returns boolean
private.has_permission(target_organisation_id uuid, requested_permission text) returns boolean
private.has_site_permission(target_organisation_id uuid, target_site_id uuid, requested_permission text) returns boolean
```

- [ ] **Step 1: Seed the immutable fixed-role permission matrix**

Owners receive the complete catalogue. Organisation administrators receive organisation/site/member/operational administration except billing/ownership. HR and payroll roles receive only their approved organisation-wide areas. Site managers and schedulers receive only relevant site-capable permissions. Staff receive no privileged mutation permission.

- [ ] **Step 2: Implement private helpers**

Each helper must explicitly require non-null `auth.uid()`, an active membership and active role assignments. Organisation-scoped roles can authorize all sites; site-scoped roles require the matching role assignment and an unrevoked `membership_site_access` row. Revoke default execution and grant only named helpers to `authenticated`.

- [ ] **Step 3: Add last-owner protection**

A private trigger rejects suspending/revoking the final active owner membership and rejects revoking or changing the final active owner role assignment. It must not interfere with organisations that have at least one other active owner.

- [ ] **Step 4: Enable RLS and explicit least-privilege grants**

Enable RLS on every new public table. Grant no access to `anon`. Grant `authenticated` only the table verbs covered by policies, with no direct deletes. Policies use `(select private.helper(...))`, include both `USING` and `WITH CHECK` for updates, permit self-membership reads, restrict role granting so only owners can grant owner, and preserve composite ownership on all writes.

- [ ] **Step 5: Verify GREEN and mutation boundaries**

Run: `npm.cmd test -- tests/tenant-primitives-db.test.ts`

Expected: all two-organisation and two-site tests pass. Mentally mutating membership status, organisation predicates, site-access predicates or composite FKs must cause a named test to fail.

---

### Task 4: Domain model and implementation documentation

**Files:**
- Create: `src/types/tenancy.ts`
- Modify: `src/types/index.ts`
- Create: `docs/commercial/tenant-primitives.md`
- Test: `tests/tenant-domain.test.ts`

**Interfaces:**
- Exports `OrganisationRole`, `OrganisationStatus`, `OrganisationMembershipStatus`, `MembershipScopeType`, `TenantPermission`, `Organisation`, `OrganisationSite`, `OrganisationMembership`, `MembershipRoleAssignment`, `MembershipSiteAccess`, `StaffSiteAssignment`, `OrganisationSettings`, and `SiteSettings`.

- [ ] **Step 1: Write the failing domain-contract test**

Assert that fixed role/permission arrays reject unknown values through exported type guards and contain every approved literal.

- [ ] **Step 2: Run the test and verify RED**

Run: `npm.cmd test -- tests/tenant-domain.test.ts`

Expected: FAIL because `src/types/tenancy.ts` does not exist.

- [ ] **Step 3: Implement minimal neutral tenancy types and guards**

Use ISO strings for timestamps/dates, UUID strings at the TypeScript boundary and no application data fetching or UI state.

- [ ] **Step 4: Add the ER and compatibility document**

Document tables, composite relationships, helper contracts, RLS boundaries, migration filename, nullable `staff_profiles` bridge, absence of data backfill, and intentionally deferred operational-table conversion. Include a Mermaid ER diagram.

- [ ] **Step 5: Run focused tests and type checking**

Run: `npm.cmd test -- tests/tenant-domain.test.ts tests/tenant-primitives-db.test.ts && npm.cmd run typecheck`

Expected: PASS.

---

### Task 5: Full review, verification and milestone commit

**Files:**
- Review all changed files; no new scope.

- [ ] **Step 1: Verify migration history and database behaviour**

Run: `npm.cmd run verify:migrations` and the executable PGlite tenant suite. If Docker is available, also run a fresh local Supabase migration replay; otherwise report that limitation accurately.

- [ ] **Step 2: Verify unchanged application behaviour**

Run: `npm.cmd run lint`, `npm.cmd run typecheck`, `npm.cmd test`, and `npm.cmd run build`.

- [ ] **Step 3: Run security and scope review**

Confirm every new public table has RLS, no new table is granted to `anon`, each foreign key has a supporting index, helper functions are in `private` with fixed search paths and revoked defaults, and no attendance/payroll/offline/onboarding/billing file or historic migration changed.

- [ ] **Step 4: Commit the milestone**

Stage the exact scope and commit with subject `Tenant Primitives`. Do not push, merge, deploy or begin Workstream 3.
