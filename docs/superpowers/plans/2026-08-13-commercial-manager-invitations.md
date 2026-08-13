# Commercial Manager Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add secure, resumable manager invitations with durable delivery state, transactional acceptance, and an explicit sole-manager acknowledgement to the commercial onboarding flow.

**Architecture:** Extend the existing `organisation_invitations`, intended-role/site tables, identity acceptance RPC, and onboarding command envelope. A new additive migration owns guarded creation, resend, revoke, acceptance, outbox, safe snapshots, and workflow events; TypeScript server actions are adapters over these database authorities. The owner and invitee pages reuse the commercial onboarding design system and never treat browser role, site, organisation, or token state as authoritative.

**Tech Stack:** Next.js App Router, React 19 server actions, TypeScript, Zod, Supabase Auth/Postgres/RLS, PGlite/Vitest, pgTAP, CSS.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge into `main` or deploy Vercel Production.
- Use only `commercial-dev` (`perxeotveoxjibkcybnq`) for Preview verification.
- Do not implement staff invitations, kiosk registration, readiness, Go Live, billing-provider work, payment collection, trial activation, support access, or offline attendance.
- Preserve hashed, expiring, single-use tokens; never persist raw tokens or include them in logs/events.
- Preserve the existing Workstream 2 role catalogue, Workstream 3 AAL2 guard, durable onboarding sessions, expected revisions, idempotency receipts, tenant fencing, and privacy-safe metadata.
- Use neutral platform copy, UK conventions, accessible 44px+ controls, mobile layouts without horizontal overflow, and no em dashes in user-facing copy.

---

### Task 1: Invitation contracts and workflow surface

**Files:**
- Create: `src/lib/onboarding/manager-invitation-contracts.ts`
- Modify: `src/lib/onboarding/contracts.ts`
- Modify: `src/lib/onboarding/navigation.ts`
- Test: `tests/onboarding-manager-invitation-contracts.test.ts`
- Test: `tests/onboarding-navigation.test.ts`

**Interfaces:**
- Produces `managerInvitationPayloadSchema`, `managerInvitationSnapshotSchema`, `managerInvitationAcceptanceStateSchema`, and fixed grantable-role presentation metadata.
- Adds `create_manager_invitation`, `resend_manager_invitation`, `revoke_manager_invitation`, `acknowledge_sole_manager`, and `complete_manager_invitation_step` to version 1 onboarding commands.

- [ ] Write tests proving only the five approved roles and valid scope combinations parse, owner/custom roles fail, email is normalised, site roles require site IDs, organisation roles reject site IDs, and safe snapshots expose delivery and acceptance separately.
- [ ] Run the focused tests and verify they fail because the 7E contracts and navigation are absent.
- [ ] Implement the minimal schemas, command/event unions, snapshot parsing, and staffing-to-managers navigation.
- [ ] Re-run the focused tests and keep them green.

### Task 2: Database invitation, outbox, and guarded owner commands

**Files:**
- Create: `supabase/migrations/20260813120726_commercial_manager_invitations.sql`
- Modify: `supabase/tests/onboarding_bootstrap.sql`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Create: `tests/onboarding-manager-invitations-db.test.ts`

**Interfaces:**
- Produces `public.message_outbox`, append-only invitation audit events, the manager snapshot helper, and guarded onboarding command handling.
- Creation returns a safe invitation reference and Preview delivery reference, never a raw token in persisted tables or audit metadata.

- [ ] Add failing PGlite and pgTAP tests for atomic invitation/outbox creation, fixed roles, scope validation, inviter grant authority, AAL2, suspended inviter, cross-organisation site rejection, duplicate membership, stale revision, receipt replay, and direct-write denial.
- [ ] Run the database tests and verify failure on the missing migration.
- [ ] Add the migration with strict constraints, RLS/grants, append-only audit, configurable lifetime, cryptographic token hashing, outbox states, authoritative role/site checks, event metadata allowlists, and session revision updates.
- [ ] Add failing tests for resend supersession, revoke idempotency, unauthorised mutation denial, delivery failure preservation, retry without duplicate invitation, and outbox invisibility.
- [ ] Implement resend/revoke/delivery boundaries and rerun the database/pgTAP tests.

### Task 3: Secure acceptance and MFA continuation

**Files:**
- Modify: `supabase/migrations/20260813120726_commercial_manager_invitations.sql`
- Create: `src/lib/invitations/manager-invitation-server.ts`
- Create: `src/lib/invitations/continuation.ts`
- Create: `tests/manager-invitation-acceptance-db.test.ts`
- Create: `tests/manager-invitation-continuation.test.ts`

**Interfaces:**
- Produces safe inspection and acceptance functions that accept only a token and authenticated identity; roles and sites are reloaded from stored intent.
- Produces a validated fixed-route continuation for sign-in, sign-up, email verification, and `/mfa` recovery; the opaque token remains the database lookup secret and never carries role/site/email authority.

- [ ] Add failing tests for valid existing-user acceptance, new-user continuation, email mismatch, expired/revoked/superseded tokens, accepted replay, authority loss, role/scope drift, site archival, AAL1 denial, AAL2 success, duplicate membership, and cross-organisation tampering.
- [ ] Add failing continuation tests for tampering, expiry, fixed-route enforcement, and safe round-trip.
- [ ] Implement transactional membership/role/site-access creation, accepted audit/event updates, neutral unavailable responses, and idempotent same-user replay.
- [ ] Implement strict fixed-route continuation validation; never encode role/site/email claims as authority or permit an open redirect.
- [ ] Rerun acceptance and continuation tests.

### Task 4: Server actions and owner workflow

**Files:**
- Create: `src/lib/onboarding/manager-invitation-actions.ts`
- Modify: `src/lib/onboarding/bootstrap-service.ts`
- Modify: `src/lib/onboarding/server.ts`
- Create: `tests/onboarding-manager-invitation-service.test.ts`

**Interfaces:**
- Produces server actions for create, resend, revoke, sole-manager acknowledgement, and step completion.
- All owner mutations reload identity/AAL2, bootstrap session, authoritative sites, permission/grantability, and expected revision before database execution.

- [ ] Add failing service tests for typed validation preservation, stale-tab responses, MFA routing, idempotent retries, sole-manager warning without fake membership, and accepted state surviving resume.
- [ ] Implement the minimal server action adapters and bootstrap snapshot integration.
- [ ] Rerun service and prior 7A-7D onboarding tests.

### Task 5: Owner and invitee UI

**Files:**
- Create: `src/app/onboarding/managers/page.tsx`
- Create: `src/components/onboarding/manager-invitations.tsx`
- Create: `src/app/invitations/manager/page.tsx`
- Create: `src/components/invitations/manager-invitation-acceptance.tsx`
- Modify: `src/components/onboarding/onboarding-shell.tsx`
- Modify: `src/app/onboarding/next/page.tsx`
- Modify: `src/app/platform.css`
- Test: `tests/onboarding-manager-invitation-ui.test.tsx`
- Test: `tests/manager-invitation-acceptance-ui.test.tsx`

**Interfaces:**
- Owner UI consumes the safe manager snapshot and fixed role explanations; invitee UI consumes only the safe inspection/acceptance state.
- Forms submit server actions with idempotency keys and current expected session revision.

- [ ] Add failing UI tests for role explanations, separate site scope, pending/delivery/acceptance status, resend/revoke confirmation, sole-manager acknowledgement, all invitee recovery states, accessibility labels, and production no-demo fallback.
- [ ] Implement the owner step using the reusable onboarding shell and clear non-permission-key language.
- [ ] Implement the neutral invitee landing, sign-in/sign-up/email verification/MFA recovery, expired/revoked/already-accepted/membership-exists states, and success state.
- [ ] Add mobile-first CSS with visible focus, 44px controls, reduced motion, and no wide-table dependency.
- [ ] Rerun UI tests, then inspect desktop and mobile pages in a browser and correct visible accessibility/usability defects.

### Task 6: Regression, security review, Preview, and checkpoint

**Files:**
- Modify only files required by verified failures.

- [ ] Run focused 7E tests, onboarding regression, identity/membership, tenant/site isolation, RLS/grants, MFA, migration history, PGlite replay, TypeScript, ESLint, full Vitest, production build, dependency audit, browser sensitive-marker scan, and `git diff --check`.
- [ ] Confirm trial remains `trial_pending` with null start/end timestamps; no kiosk, staff invitation, offline entitlement, or offline device is created.
- [ ] Request a focused review of migration/RLS/token/outbox/acceptance/UI boundaries and fix only reproduced findings with a failing test first.
- [ ] Commit as `Commercial Manager Invitations` and push normally to `codex/commercial-production`.
- [ ] Verify Draft PR #8 remains open, Draft, and unmerged; Docker migration replay, pgTAP, schema lint, CodeQL, Gitleaks, dependency checks, application tests/build, and Vercel Preview all pass for the exact SHA.
- [ ] Run the fictional Preview manager invitation and sole-manager flows without using Jan identities, and report the exact 7F boundary without beginning it.
