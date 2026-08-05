# Identity and Membership Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Establish server-authoritative commercial identity, membership, site scope, MFA assurance, invitation acceptance and legacy compatibility without converting inherited operational data or changing Jan behaviour.

**Architecture:** Supabase Auth remains the global identity. A narrow authenticated database snapshot RPC returns only the caller's current membership state, role-derived permissions, site access and revision; a pure TypeScript resolver turns that snapshot into a selected membership context. A signed HTTP-only cookie stores only a membership and optional site preference, and every server resolution reloads current database state. Invitation acceptance is one transactional, idempotent database command that derives role and site scope from stored invitation rows.

**Tech Stack:** PostgreSQL 17, Supabase Auth/RLS/RPC, Supabase SSR, Next.js 16 App Router, React 19, TypeScript, Web Crypto, PGlite and Vitest.

## Global Constraints

- Work only on `codex/commercial-production`; do not merge, push, deploy or connect to Jan production.
- Use additive migrations only and preserve `staff_accounts`, attendance, payroll, kiosk, onboarding and billing behaviour.
- Never put organisation access, roles, permissions or AAL in client-editable Auth metadata or preference cookies.
- Revalidate current membership, role, permission and site state on every sensitive server request.
- Use UK formats, `Europe/London`, accessible controls and no new dependency unless unavoidable.
- Keep direct authenticated membership, role and site-access writes denied.
- Use fictional data only and do not begin Workstream 4.

---

### Task 1: Database lifecycle, revisions and safe identity snapshot

**Files:**
- Create with CLI: `supabase/migrations/<timestamp>_identity_membership_conversion.sql`
- Modify: `tests/helpers/tenant-primitives-db.ts`
- Create: `tests/identity-membership-db.test.ts`

**Interfaces:**
- Adds `organisation_memberships.authorisation_revision bigint`.
- Adds append-only `membership_status_events`.
- Produces `public.current_commercial_identity_snapshot()` returning only the authenticated user's memberships as JSONB.
- Snapshot membership objects contain IDs, organisation display state, status, staff link, revision, active roles, permitted site IDs and stable permission keys.

- [ ] Write database tests proving invited, suspended and revoked memberships are not active contexts; role and site changes increment the revision; status transitions append evidence; staff rows survive revocation; and cross-organisation linkage remains rejected.
- [ ] Run `npm.cmd test -- --run tests/identity-membership-db.test.ts` and verify RED because the new revision, event table and RPC do not exist.
- [ ] Generate the migration with `npm.cmd exec -- supabase migration new identity_membership_conversion`.
- [ ] Add revision columns and narrowly scoped triggers that bump the affected membership after role, site-access, status or staff-link changes.
- [ ] Add `membership_status_events` with composite tenant foreign keys, RLS, read-only authenticated grants, a trigger-only insert path and no delete/update grants.
- [ ] Implement the snapshot RPC as `SECURITY DEFINER SET search_path = ''`, validate `auth.uid()`, fully qualify relations, exclude revoked role/access rows, derive permissions from `private.role_permissions`, and return no other user's rows.
- [ ] Revoke execute from `PUBLIC`, `anon`, `authenticated` and `service_role`, then grant only `authenticated`.
- [ ] Revoke direct insert/update/delete on memberships, role assignments and site access from `authenticated` while preserving their read policies.
- [ ] Run the focused database tests until GREEN.

### Task 2: Transactional invitation acceptance foundation

**Files:**
- Modify: `supabase/migrations/<timestamp>_identity_membership_conversion.sql`
- Modify: `tests/helpers/tenant-primitives-db.ts`
- Create: `tests/invitation-acceptance-db.test.ts`

**Interfaces:**
- Produces `public.accept_organisation_invitation(invitation_token text)` returning `organisation_id`, `membership_id`, `outcome` and `authorisation_revision`.
- Token lookup uses `sha256(convert_to(token, 'UTF8'))`; role/site inputs never come from the caller.

- [ ] Write failing database tests for valid existing-user acceptance, expired/revoked/replayed token, email mismatch, duplicate membership, lost inviter permission, foreign-site tampering, privileged AAL1 denial, AAL2 success and idempotent same-user retry.
- [ ] Extend the PGlite Auth fixture with `auth.jwt()` and request AAL settings, plus token fixtures derived from literal fictional values.
- [ ] Run the invitation test and verify RED because the acceptance RPC is absent.
- [ ] Add invitation supersession audit columns and a trigger that revokes an older pending token for the same organisation/email before a replacement is inserted.
- [ ] Implement acceptance as a single `SECURITY DEFINER` function: authenticate; compare normalized Auth email; validate pending status/expiry; revalidate active inviter and `membership.manage`; validate stored role/site rows; require AAL2 for privileged roles; reject active duplicates; activate or create the invited membership; copy stored role/site assignments; mark accepted; and return the original accepted result on a same-user retry.
- [ ] Ensure failures use tenant-neutral error codes and do not reveal whether a guessed organisation, site or email exists.
- [ ] Restrict execute exactly as for the snapshot RPC and keep direct invitation child writes denied.
- [ ] Run both database suites until GREEN.

### Task 3: Membership context and permission resolution

**Files:**
- Modify: `src/types/tenancy.ts`
- Create: `src/lib/commercial-identity/errors.ts`
- Create: `src/lib/commercial-identity/context.ts`
- Create: `src/lib/commercial-identity/supabase-store.ts`
- Create: `tests/commercial-membership-context.test.ts`

**Interfaces:**
- Produces `CommercialIdentitySnapshot`, `CommercialMembershipSummary`, `CommercialMembershipContext`, `CommercialIdentityStore` and `resolveMembershipContext(input, snapshot)`.
- Input accepts `authUserId`, optional requested membership/organisation/site and a selection mode of `navigation | sensitive`.
- Errors are typed codes: `not_authenticated`, `membership_required`, `organisation_selection_required`, `membership_unavailable`, `site_unavailable`, `permission_denied`, `linked_staff_required`, `mfa_required`, `invalid_continuation`.

- [ ] Write failing table-driven tests for no/one/multiple memberships, explicit organisation selection, inaccessible archived organisation, suspended/revoked selection, stale revision, organisation switching, site selection, site access without role, role without access, permission union and revoked role removal.
- [ ] Run the focused test and verify RED on missing modules.
- [ ] Add safe tenant interfaces without exposing Auth metadata.
- [ ] Implement a pure resolver that never accepts caller roles or permissions, fails closed on multi-organisation ambiguity, permits automatic fallback only when exactly one active membership remains, and requires exact current revision for sensitive preference use.
- [ ] Implement a Supabase data source that calls only `current_commercial_identity_snapshot`; it must not use `service_role` or query private tables.
- [ ] Run the focused test until GREEN and run `npm.cmd run typecheck`.

### Task 4: Authenticated identity, signed preference and MFA guards

**Files:**
- Create: `src/lib/commercial-identity/identity.ts`
- Create: `src/lib/commercial-identity/preference.ts`
- Create: `src/lib/commercial-identity/guards.ts`
- Create: `tests/commercial-identity-guards.test.ts`
- Modify: `.env.example`
- Modify: `src/lib/config/environment.ts`

**Interfaces:**
- Produces `resolveAuthenticatedCommercialIdentity()`, `encodeCommercialPreference()`, `decodeCommercialPreference()`, `readCommercialPreference()`, `writeCommercialPreference()`, `clearCommercialPreference()`, `requireCommercialIdentity()`, `requireActiveMembership()`, `requirePermission()`, `requireSitePermission()`, `requireLinkedStaffProfile()` and `requireAal2()`.
- Cookie payload is versioned and contains only `membershipId`, optional `siteId`, and `authorisationRevision`; signature is HMAC-SHA-256.

- [ ] Write failing tests proving valid signature round-trip, tamper rejection, expiry/version rejection, site clearing on organisation switch, stale membership denial, safe typed errors, AAL1 privileged rejection, AAL2 acceptance and AAL1 staff self-service allowance.
- [ ] Run the focused tests and verify RED.
- [ ] Implement Web Crypto signing with constant-time signature comparison and no new package.
- [ ] Add optional commercial session-secret validation that fails only when commercial preference functions are invoked, preserving current single-organisation startup.
- [ ] Resolve the Auth user with `auth.getUser()`, fetch AAL server-side with `auth.mfa.getAuthenticatorAssuranceLevel()`, and load a fresh database snapshot for every request.
- [ ] Implement guards over the central context only; log redacted denial codes and correlation IDs without user email, token, cookie or foreign identifiers.
- [ ] Expose `/organisations/select` and `/mfa` as fixed safe continuation contracts; reject external, protocol-relative and malformed continuation paths.
- [ ] Run focused tests and typecheck until GREEN.

### Task 5: Invitation server adapter and legacy compatibility

**Files:**
- Create: `src/lib/commercial-identity/invitations.ts`
- Create: `src/lib/commercial-identity/legacy-adapter.ts`
- Create: `tests/commercial-identity-adapters.test.ts`

**Interfaces:**
- Produces `acceptCommercialInvitation(token)` with safe outcomes `accepted | already_accepted | authentication_required | mfa_required | unavailable`.
- Produces `toLegacyAccountCapability(identity)` returning `manager | staff` plus linked staff ID, or a fail-closed typed error.

- [ ] Write failing tests for unauthenticated continuation, database outcome mapping, redacted errors, one-organisation manager mapping, one-organisation linked-staff mapping, unlinked staff denial and multi-organisation ambiguity denial.
- [ ] Run the focused test and verify RED.
- [ ] Implement the invitation adapter using the authenticated Supabase client and the token-only RPC.
- [ ] Implement the compatibility adapter so manager capability requires current approved commercial manager permissions, staff capability requires an active linked membership, and no organisation is silently selected when more than one is active.
- [ ] Document removal markers as structured comments referencing Workstream 4 rather than scattering runtime conditionals through legacy routes.
- [ ] Run focused tests until GREEN.

### Task 6: Minimal organisation-selection experience

**Files:**
- Create: `src/app/organisations/select/page.tsx`
- Create: `src/components/auth/organisation-selector.tsx`
- Create: `src/lib/commercial-identity/actions.ts`
- Create: `tests/organisation-selection.test.tsx`

**Interfaces:**
- Server page renders no-membership, selection-required and unavailable-preference states.
- `selectCommercialOrganisation(formData)` accepts only membership ID and an allowlisted relative continuation.

- [ ] Write failing component/action tests for no membership, one membership, multiple membership choices, suspended/archived exclusion, stale preference warning, switching that clears site state, safe persistence flags and open-redirect rejection.
- [ ] Run focused tests and verify RED.
- [ ] Implement a minimal accessible selector with organisation names, clear status copy and large radio/button targets.
- [ ] Implement the server action: authenticate, reload snapshot, resolve selected active membership, sign the cookie server-side, clear selected site, log the correlation ID and redirect only to an allowlisted local route.
- [ ] Do not alter the existing login or legacy operational routes.
- [ ] Run focused tests until GREEN.

### Task 7: Documentation and full security verification

**Files:**
- Create: `docs/commercial/identity-and-membership.md`
- Modify: `docs/commercial/tenant-primitives.md`
- Create: `scripts/verify-browser-bundle.mjs`
- Modify: `package.json`

**Interfaces:**
- Documents Auth versus membership versus employment, selection, site scope, permissions, AAL2, lifecycle, invitation acceptance, caching, compatibility and the Workstream 4 removal boundary.

- [ ] Add the approved multi-organisation identity diagram and exact request-resolution sequence.
- [ ] State that membership/permission snapshots are request-local only, have no cross-request cache, and sensitive actions always reload; UI state may be briefly stale but cannot authorise a write.
- [ ] Inventory every remaining `staff_accounts` compatibility path and state that Workstream 4 converts inherited operational identity references and route consumers, but does not include onboarding, billing, attendance tenancy or Jan migration unless separately approved.
- [ ] Add `verify:browser-bundle`, which scans only `.next/static` browser assets and fails if the configured commercial session-secret sentinel or known server credential markers occur there.
- [ ] Run focused tenant, identity, invitation, guard, compatibility and UI tests.
- [ ] Run `npm.cmd test`, `npm.cmd run verify:migrations`, `npm.cmd run typecheck`, `npm.cmd run lint`, `npm.cmd run build`, `npm.cmd run audit:dependencies` and `npm.cmd run verify:browser-bundle`.
- [ ] Review grants, all `SECURITY DEFINER` functions, fixed search paths, direct-write revocations, staged scope and `git diff --check`.
- [ ] Commit the verified milestone as `Identity and Membership Conversion`; leave the branch unpushed, unmerged and the worktree clean.
