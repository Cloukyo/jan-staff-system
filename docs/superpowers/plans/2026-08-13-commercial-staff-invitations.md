# Commercial Staff Invitations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorised commercial managers invite existing staff profiles to create or link login accounts without permitting role, site, staff-profile or tenant escalation.

**Architecture:** Extend the 7E invitation, Vault and transactional-outbox boundary with a distinct `staff` invitation kind linked by a composite organisation/staff foreign key. Creation derives the fixed `staff` role and eligible site scope from authoritative staff assignments; acceptance revalidates the invitation, email, staff lifecycle, account capacity and same-organisation identity before atomically linking the membership. The onboarding snapshot remains server-authoritative and supports both reviewed invitations and a reversible “Invite staff later” decision.

**Tech Stack:** Next.js App Router, React server actions, TypeScript, Zod, Supabase Auth/Postgres/RLS, PostgreSQL Vault, PGlite, pgTAP and Vitest.

## Global Constraints

- Stay on `codex/commercial-production`; do not merge into `main` or deploy to production.
- Use only the `commercial-dev` Supabase branch `perxeotveoxjibkcybnq` for Preview verification.
- Do not create staff profiles; Workstream 7D remains authoritative.
- Do not implement kiosk registration, readiness, Go Live, payment-provider integration, trial activation or offline attendance.
- Ordinary invitations always resolve to the fixed `staff` role and authoritative same-organisation site assignments.
- Preserve legacy Jan compatibility without migration or backfill, and do not access Jan production.
- Use fictional identities only and never persist or expose raw invitation tokens.
- Use UK formats and Europe/London where a date or time is presented.

---

### Task 1: Versioned staff invitation contracts

**Files:**

- Create: `src/lib/onboarding/staff-invitation-contracts.ts`
- Modify: `src/lib/onboarding/contracts.ts`
- Modify: `src/lib/onboarding/navigation.ts`
- Test: `tests/onboarding-staff-invitation-contracts.test.ts`
- Test: `tests/onboarding-navigation.test.ts`

**Interfaces:**

- Produces `staffInvitationSelectionPayloadSchema`, `staffInvitationReferencePayloadSchema`, `staffInvitationSkipPayloadSchema`, `staffInvitationSnapshotSchema` and the staff acceptance-state schema.
- Adds `staff_invitations` after `manager_invitations` to workflow navigation and bootstrap parsing.

- [ ] Write contract tests proving staff IDs are bounded and unique, client roles/sites are rejected, skip requires the exact acknowledgement, and snapshots distinguish linked, pending, failed, expired and PIN-only profiles.
- [ ] Run the focused tests and confirm failure because the 7F contracts and eighth step do not exist.
- [ ] Implement the minimal schemas and navigation changes.
- [ ] Re-run the focused tests and keep all previous contract/navigation tests green.

### Task 2: Additive persistence, workflow and eligibility boundary

**Files:**

- Create: `supabase/migrations/<generated>_commercial_staff_invitations.sql`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Test: `tests/onboarding-staff-invitations-db.test.ts`
- Modify: `supabase/tests/onboarding_bootstrap.sql`

**Interfaces:**

- Extends `organisation_invitations` with a same-organisation `staff_id` link and `staff` invitation kind.
- Adds privacy-safe staff invitation audit events and reuses `message_outbox`, Vault delivery secrets and onboarding receipts.
- Routes `create_staff_invitations`, `resend_staff_invitation`, `revoke_staff_invitation`, `skip_staff_invitation_step` and `complete_staff_invitation_step` through `execute_onboarding_bootstrap_command(jsonb)`.

- [ ] Generate the migration filename with `supabase migration new commercial_staff_invitations`.
- [ ] Write failing PGlite tests for eligibility, cross-tenant rejection, lifecycle/email checks, duplicate linked/pending protection, fixed role, derived multi-site access, atomic reviewed selection, idempotency, stale revision, skip/resume and direct-write denial.
- [ ] Confirm the tests fail for the missing 7F persistence boundary.
- [ ] Implement composite ownership constraints, indexes, expiry cleanup, snapshot derivation, guarded commands, safe events, RLS and grants.
- [ ] Add pgTAP assertions for table/RPC grants, fixed-role enforcement, cross-tenant isolation and outbox secrecy.
- [ ] Re-run PGlite and pgTAP-focused checks until green.

### Task 3: Transactional account linking and secure continuation

**Files:**

- Create: `src/lib/invitations/staff-invitation-server.ts`
- Create: `src/lib/invitations/staff-invitation-actions.ts`
- Modify: `src/lib/invitations/continuation.ts`
- Create: `tests/staff-invitation-acceptance-db.test.ts`
- Create: `tests/staff-invitation-continuation.test.ts`
- Modify: `tests/commercial-identity-adapters.test.ts`

**Interfaces:**

- Produces server-only inspection/acceptance helpers and strict `/invitations/staff?token=...` continuation.
- Acceptance returns typed safe outcomes including accepted, already linked, conflict review, capacity changed, email verification required and unavailable.

- [ ] Write failing tests for existing/new Auth identities, email mismatch, expired/revoked/superseded/replayed tokens, deactivated staff, authority loss, capacity change, same-user cross-organisation membership, conflicting same-organisation profile links and ambiguous legacy compatibility.
- [ ] Confirm failures are caused by the absent staff acceptance RPC and continuation allowlist.
- [ ] Implement token inspection and transactional acceptance with fixed role, exact profile link, derived current site access, replay reconciliation and event/outbox cleanup.
- [ ] Keep ordinary staff at AAL1 unless an existing global guard requires stronger assurance; do not weaken privileged MFA.
- [ ] Re-run acceptance, identity and manager-invitation regression tests.

### Task 4: Owner onboarding UI and actions

**Files:**

- Create: `src/lib/onboarding/staff-invitation-actions.ts`
- Create: `src/app/onboarding/staff-invitations/page.tsx`
- Create: `src/components/onboarding/staff-invitations.tsx`
- Modify: `src/components/onboarding/onboarding-shell.tsx`
- Modify: `src/app/platform.css`
- Test: `tests/onboarding-staff-invitation-ui.test.tsx`

**Interfaces:**

- Presents the authoritative eligible-staff snapshot and submits only selected staff IDs, expected revision and idempotency key.
- Exposes reviewed bulk send, status, resend/revoke and “Invite staff later” without exposing roles, permission keys or raw tokens.

- [ ] Write failing UI contract tests for account-status wording, reviewed selection, PIN-only explanation, accessible list semantics, 44px controls, confirmation states and mobile overflow rules.
- [ ] Implement server actions that revalidate every selection through the database command boundary.
- [ ] Implement a reusable, neutral onboarding screen for large and small staff lists with clear account versus staff-profile explanations.
- [ ] Re-run UI and onboarding regression tests.

### Task 5: Invitee UI and end-to-end verification

**Files:**

- Create: `src/app/invitations/staff/page.tsx`
- Create: `src/components/invitations/staff-invitation-acceptance.tsx`
- Test: `tests/staff-invitation-acceptance-ui.test.tsx`

**Interfaces:**

- Reuses the 7E invitation shell while presenting staff-specific valid, authentication, verification, expired, revoked, superseded, linked, conflict and success states.

- [ ] Write failing UI tests for safe state-specific copy, sign-in/signup continuation, no manager navigation and successful profile-link explanation.
- [ ] Implement the minimal polished invitee route and component.
- [ ] Run focused 7F, onboarding, identity, tenant, customer-domain and invitation suites.
- [ ] Run migration history, PGlite replay, typecheck, ESLint, full Vitest, production build, dependency audit and browser sensitive-marker scan.
- [ ] Start the local app and review owner/invitee states at representative desktop and mobile viewports, checking focus, labels, touch targets and horizontal overflow.
- [ ] Commit exactly as `Commercial Staff Invitations`, push to Draft PR #8, and verify Docker replay, pgTAP, schema lint, CodeQL, Gitleaks, Supabase Preview and Vercel Preview for the exact SHA.

## Plan Self-Review

- The plan covers every 7F scope item and keeps profile creation, kiosks, readiness, Go Live, billing and offline work excluded.
- Role and site authority never come from browser input; only staff IDs are submitted and all ownership/state/site/account limits are re-derived server-side.
- Existing manager invitations remain a separate invitation kind and regression surface.
- No placeholders or unresolved architectural choices remain.
