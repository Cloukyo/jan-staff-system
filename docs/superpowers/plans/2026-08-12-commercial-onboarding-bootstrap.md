# Commercial Onboarding Bootstrap Implementation Plan

**Scope:** Workstream 7A only on `codex/commercial-production`. No site, billing, production deployment, offline attendance, Jan data access, or later onboarding phases.

## Compatibility decisions

- Preserve the frozen `commercial_customer_v1` top-level workflow. Represent `owner_security` and `legal_acceptance` as durable bootstrap substeps beneath `owner_account`; retain `organisation` as the existing top-level step.
- Extend the existing append-only events, command receipts, expected-revision checks, and server-authoritative readiness service rather than adding a parallel workflow engine.
- Keep all privileged mutations behind guarded PostgreSQL functions. Browser code receives typed, privacy-safe results and never chooses organisation IDs, roles, memberships, permissions, or readiness.
- Use the existing Supabase Auth assurance-level contract and `/mfa` route. Do not create a second MFA authority.

## Tasks

1. Establish a reusable commercial onboarding visual language using the existing neutral design tokens, then inspect the concept before implementation.
2. Add failing contract, database, RLS, service, and UI tests covering bootstrap concurrency/resume, security gates, legal versioning, atomic/idempotent organisation creation, tenant fencing, stale revisions, safe metadata, and no demo fallback.
3. Add one additive migration for legal-document configuration, immutable acceptances, bootstrap/resume functions, guarded commands, constraints, grants, RLS, and transactional organisation creation without creating a site.
4. Extend the TypeScript onboarding contracts and server application layer with strict command/result schemas and authoritative bootstrap state.
5. Implement neutral signup, account-readiness, legal-acceptance, organisation, MFA, resume, and next-step routes using reusable onboarding shell, progress, form, validation, status, save/exit, and support components.
6. Run focused tests while iterating, then run the complete local verification matrix, migration replay, pgTAP, security/data scans, and desktop/mobile browser accessibility and visual review.
7. Create the single requested `Commercial Onboarding Bootstrap` commit, push it to Draft PR #8, apply only the new migration to `commercial-dev`, deploy only the Vercel Preview, run the safe fictional manual flow, and wait for remote CI. Stop without beginning Workstream 7B.

## Rollback and safety

- Database changes are additive and isolated to the commercial preview branch.
- Organisation creation is a single transaction; any error rolls back the organisation, membership, owner role, defaults, session link, events, and workflow revisions together.
- Preview verification will use clearly fictional accounts and will document or remove any retained preview seed. No Jan project reference or Vercel Production target is used.
