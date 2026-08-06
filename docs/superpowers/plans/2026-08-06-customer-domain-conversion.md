# Customer Domain Conversion Implementation Plan

> **Execution note:** Implement this plan on `codex/commercial-production` only. Use test-first development for behavioural code and database contracts. Do not connect to Jan production, merge to `main`, deploy, backfill Jan rows, or begin Workstream 5.

**Goal:** Make non-attendance, non-payroll customer operational data organisation/site aware while preserving existing Jan behaviour through explicit compatibility paths.

**Architecture:** Add a single additive migration that fences commercial staff-owned records with composite organisation keys, introduces neutral compliance, work-area, site-operations and import primitives, and retains legacy tables as adapters. Application services resolve settings, assignments, compliance packs and imports from authoritative tenant context. Existing unowned Jan rows remain valid and unchanged; new commercial writes cannot rely on client-provided ownership without database validation.

**Technology:** PostgreSQL/Supabase migrations and RLS, PGlite integration tests, TypeScript, Zod, Vitest, Next.js.

---

## Task 1: Establish failing domain tests

**Files:**
- Create: `tests/customer-domain.test.ts`
- Create: `tests/staff-imports.test.ts`
- Create: `tests/settings-inheritance.test.ts`
- Modify: `tests/compliance-modules.test.ts`
- Modify: `tests/work-areas.test.ts`

1. Add literal, behaviour-focused tests for effective-dated staff-site assignment resolution, organisation/site settings inheritance, neutral compliance pack metadata, work-area labelling, and import preview validation.
2. Run the focused tests and confirm each new test fails because the production interfaces are absent.

## Task 2: Establish failing database isolation tests

**Files:**
- Create: `tests/helpers/customer-domain-db.ts`
- Create: `tests/customer-domain-db.test.ts`

1. Build an ephemeral two-organisation, multi-site fixture on top of the existing tenant and identity migrations plus minimal inherited customer-domain tables.
2. Add tests proving organisation ownership, composite staff ownership, site ownership, site-manager scoping, commercial-write requirements, settings inheritance, neutral compliance module isolation, import validation/atomicity and legacy-row compatibility.
3. Add a schema-boundary assertion proving no attendance, clock-event, correction, exception, payroll-processing or kiosk-device table is altered by the Workstream 4 migration.
4. Run the focused database test and confirm failure because the migration and interfaces do not exist.

## Task 3: Implement commercial domain services

**Files:**
- Create: `src/lib/customer-domain/assignments.ts`
- Create: `src/lib/customer-domain/settings.ts`
- Create: `src/lib/customer-domain/imports.ts`
- Create: `src/types/customer-domain.ts`
- Modify: `src/types/index.ts`
- Modify: `src/lib/compliance/modules.ts`
- Modify: `src/lib/platform/work-areas.ts`

1. Implement deterministic effective-date assignment helpers.
2. Implement organisation defaults plus site override resolution without treating entitlement as tenant authority.
3. Implement Zod-based import preview validation that derives staff and assignment commands, rejects duplicate source keys and cross-site targets, and exposes no commit side effects.
4. Model core compliance capabilities as qualifications, credentials, requirements and documents; keep DBS, safeguarding and central-record concepts only inside industry packs and compatibility mappings.
5. Implement neutral work-area records and profile-specific labels while retaining legacy room payload aliases.
6. Run focused tests until green, refactor, then rerun.

## Task 4: Implement the additive database conversion

**Files:**
- Create with Supabase CLI: `supabase/migrations/*_customer_domain_conversion.sql`
- Modify: `tests/helpers/customer-domain-db.ts` only if the real migration exposes a required fixture contract

1. Create the migration using `supabase migration new customer_domain_conversion`.
2. Add nullable `organisation_id` ownership to inherited staff-related tables and composite foreign keys to `staff_profiles`, preserving all unowned legacy rows.
3. Fence staff qualifications, certificates/credentials, references, central-record compatibility, central-record items, pay arrangements and legacy import reviews by organisation for commercial rows.
4. Introduce neutral `compliance_modules`, `compliance_requirements`, `staff_compliance_documents`, `work_areas`, `site_closures`, `staff_import_batches` and `staff_import_rows` tables with indexed composite ownership constraints and RLS.
5. Add validated settings inheritance and atomic staff-import RPCs in a non-destructive form. Privileged functions must have fixed search paths, explicit identity/membership checks, revoked `PUBLIC` execution and minimal grants.
6. Replace commercial policies on converted tables with tenant- and site-aware policies while retaining narrowly defined legacy policies for `organisation_id is null`.
7. Keep `staff_accounts` and current attendance/payroll/kiosk consumers operational through compatibility columns and adapters. Do not alter attendance, payroll-processing or kiosk tables/functions.
8. Run PGlite tests after each schema slice and confirm the intended failing test turns green.

## Task 5: Wire membership-aware compatibility adapters

**Files:**
- Create: `src/lib/customer-domain/context.ts`
- Modify: `src/lib/compliance/repository.ts`
- Modify: `src/lib/compliance/actions.ts`
- Modify: `src/lib/staff/actions.ts`
- Modify: `src/lib/settings/server.ts`
- Modify: `src/lib/settings/actions.ts`

1. Resolve the authoritative commercial organisation/site context from the Workstream 3 server membership resolver.
2. Scope commercial reads and writes by server-derived organisation/site. Do not accept browser ownership identifiers as proof.
3. Preserve the existing legacy path when no commercial membership context exists so current Jan behaviour is unchanged.
4. Ensure new commercial staff creation links organisation ownership and a site assignment atomically through a database command.
5. Retain `staff_accounts` as a compatibility source; membership is authoritative for commercial access.
6. Add or update action/repository tests first, observe failures, implement minimally and rerun.

## Task 6: Document the conversion and remaining boundaries

**Files:**
- Create: `docs/commercial/customer-domain-conversion.md`
- Modify: `docs/commercial/tenant-primitives.md`
- Modify: `docs/commercial/identity-and-membership.md`
- Modify: `README.md`

1. Add the post-Workstream-4 ER diagram and ownership matrix.
2. Document settings inheritance, compliance packs, work-area terminology and staff import transactions.
3. Record migration ordering, legacy compatibility paths, the absence of Jan backfill, and the remaining attendance/payroll/kiosk boundaries.
4. State Workstream 5 scope exactly without implementing it.

## Task 7: Verify and commit

1. Run focused customer-domain tests and the tenant isolation suite.
2. Run migration verification and a complete PGlite migration replay.
3. Run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run audit:dependencies`, and `npm run verify:browser-bundle`.
4. Inspect the final diff for attendance/payroll/kiosk scope violations, accidental environment references and fictional-data compliance.
5. Confirm the worktree is otherwise clean, stage only Workstream 4 files, and commit exactly `Customer Domain Conversion`.
6. Report the commit SHA and final worktree status. Do not begin Workstream 5.
