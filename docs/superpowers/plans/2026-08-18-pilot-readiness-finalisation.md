# Pilot Readiness Finalisation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the confirmed supervised-pilot blockers by adding provider-neutral staging email delivery, a safe complete owner export, kiosk abuse controls, privileged-seat enforcement, exact-SHA staging deployment authority, and focused recovery UX without changing Commercial Production, Jan Production, offline attendance, or unrelated product scope.

**Architecture:** Add one additive Supabase migration that strengthens the existing commercial invitation, kiosk, entitlement, and audit boundaries without rewriting their domain models. Keep provider delivery behind a server-only TypeScript contract, use Resend only in Commercial Staging, render invitation URLs transiently inside the worker, and project exports through explicit database allowlists into a canonically serialized JSON bundle. Every database mutation remains tenant-fenced, transactional, RLS-protected, and replay-safe.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Zod, Supabase/PostgreSQL/RLS/Vault/pgTAP, Vitest/PGlite, Resend HTTP API, Vercel Cron and GitHub Actions.

## Global Constraints

- Work only on `codex/commercial-production` in `Cloukyo/sh-workforce-platform`; do not merge into `main`.
- Resend is the Commercial Staging transactional-email adapter only; Supabase Auth retains verification, password-reset, MFA and security email.
- Never display, log, persist in rendered form, commit, or return invitation tokens, acceptance URLs, provider keys, Vault values, service-role keys, or recipient payloads.
- Retrieve the raw invitation token and render its acceptance URL only inside the trusted delivery worker, holding both in memory for one delivery attempt.
- Use canonical JSON serialization with recursively sorted object keys and projection-defined stable array ordering for every customer-export digest.
- Rate limiting must be scoped to the server-issued registration ID and must not let one shared IP/network block unrelated organisations or registrations.
- Invitation creation success and email-delivery failure are distinct durable states in both contracts and UI; delivery failure must remain recoverable without creating a duplicate invitation.
- Staging acceptance uses only fictional identities and controlled `resend.dev` test recipients.
- Keep offline attendance and offline authorisation disabled.
- Preserve original clock events and store corrections separately.
- Do not create Commercial Production, configure Production email, access Jan Production, add automated deletion, begin a redesign, or add speculative architecture.
- Use UK date/time/currency formats and `Europe/London` presentation.

---

### Task 1: Establish red tests and additive migration shell

**Files:**
- Create: generated migration under `supabase/migrations/`
- Create: `tests/pilot-readiness-db.test.ts`
- Modify: `tests/helpers/onboarding-persistence-db.ts`
- Modify: `supabase/tests/onboarding_bootstrap.sql`

**Interfaces:**
- Consumes: current organisation invitations, `message_outbox`, commercial kiosk registrations, `staff_kiosk_settings`, memberships, roles, entitlements, attendance evidence, and onboarding/post-live RPCs.
- Produces: migration-owned functions and tables used by Tasks 2-6, with all privileged helpers execute-revoked from `PUBLIC`, `anon`, and `authenticated` unless explicitly customer-facing.

- [ ] **Step 1: Generate the migration with the installed Supabase CLI**

Run: `npx supabase migration new pilot_readiness_finalisation`

Expected: one timestamped empty migration after `20260817145038_harden_commercial_staging_function_grants.sql`.

- [ ] **Step 2: Write failing PGlite database tests for each confirmed break**

Add behavioral cases that prove: a fourth PIN attempt is locked without creating an event; three concurrent failures cannot lose increments; missing registration UUID creates no attempt row; two registrations remain independently claimable; ten active-or-pending privileged seats reject the eleventh; acceptance rechecks capacity; outbox direct writes are denied; export audit updates/deletes are denied; cancellation leaves clock/correction fingerprints unchanged.

- [ ] **Step 3: Run the focused database test and observe the red state**

Run: `npm test -- --run tests/pilot-readiness-db.test.ts`

Expected: FAIL on the first unimplemented security/export/outbox assertion, not on fixture setup.

- [ ] **Step 4: Add migration replay helpers without implementing behavior**

Extend the existing helper only with source migrations/tables needed to execute the new migration against the commercial fixture. Do not duplicate production SQL inside test helpers.

- [ ] **Step 5: Rerun and confirm failures now name missing behavior**

Run: `npm test -- --run tests/pilot-readiness-db.test.ts`

Expected: FAIL with stable missing-function, missing-table, or incorrect-result evidence.

---

### Task 2: Provider-neutral durable notification delivery

**Files:**
- Modify: generated migration from Task 1
- Create: `src/lib/notifications/contracts.ts`
- Create: `src/lib/notifications/config.ts`
- Create: `src/lib/notifications/templates.ts`
- Create: `src/lib/notifications/provider.ts`
- Create: `src/lib/notifications/resend-provider.ts`
- Create: `src/lib/notifications/worker.ts`
- Create: `src/app/api/internal/notifications/process/route.ts`
- Modify: `src/lib/config/environment.ts`
- Modify: `vercel.json`
- Create: `tests/notification-provider.test.ts`
- Create: `tests/notification-worker.test.ts`
- Modify: `tests/pilot-readiness-db.test.ts`

**Interfaces:**
- Produces: `TransactionalEmailProvider.send(message: TransactionalEmailMessage): Promise<DeliveryResult>` where `DeliveryResult` is `{ outcome: "accepted"; providerReference: string } | { outcome: "retryable_failure" | "permanent_failure"; code: string }`.
- Produces: `processNotificationBatch(deps, limit): Promise<{ claimed: number; accepted: number; retryableFailures: number; permanentFailures: number }>`.
- Produces: service-role RPCs `private.claim_next_notification_delivery(integer)` and `private.record_notification_delivery(uuid,text,text,text)`; claimed invitation material includes a raw token only in the service-role response and never a URL.
- Consumes: `APP_ENV`, `NEXT_PUBLIC_SITE_URL`, `RESEND_API_KEY`, `RESEND_FROM_ADDRESS`, `RESEND_STAGING_RECIPIENT`, `NOTIFICATION_WORKER_SECRET`.

- [ ] **Step 1: Write failing contract/template tests**

Test literal outputs for manager invitation, staff invitation, trial-ending, and payment-failure messages; reject unknown template versions; assert no template/result contains `invitationToken`, Vault ID, Jan wording, or a persisted/rendered URL field. Test staging rewrites every destination to the configured `resend.dev` recipient and Production config is rejected in this milestone.

- [ ] **Step 2: Run the provider tests red**

Run: `npm test -- --run tests/notification-provider.test.ts`

Expected: FAIL because the notification modules do not exist.

- [ ] **Step 3: Implement the smallest provider-neutral types, config, renderer, and Resend adapter**

Use `fetch("https://api.resend.com/emails", ...)` behind the adapter, send `Idempotency-Key: notification/<outbox-id>/<template-version>`, map only bounded provider status codes, and never log the request/response body. Build invitation links in `worker.ts` from an in-memory claimed token and immediately discard the claimed object after recording the result.

- [ ] **Step 4: Run provider tests green**

Run: `npm test -- --run tests/notification-provider.test.ts`

Expected: PASS with a fake HTTP boundary and no network access.

- [ ] **Step 5: Write failing worker/outbox tests**

Test atomic claim-next, `FOR UPDATE SKIP LOCKED`, stale-processing recovery, stable idempotency key, provider acceptance evidence, retry backoff, terminal secret removal, duplicate-worker reconciliation, recipient rewrite, and absence of token/URL from persisted payloads and safe results. Test post-live invitation enqueue in the same transaction and unique billing-warning milestone keys.

- [ ] **Step 6: Run worker/database tests red**

Run: `npm test -- --run tests/notification-worker.test.ts tests/pilot-readiness-db.test.ts`

Expected: FAIL at claim-next/enqueue/record boundaries.

- [ ] **Step 7: Implement the durable outbox extension and worker route**

Add a durable `notification_key`, provider reference, claim token/version, and non-invitation warning support without weakening existing invitation FKs. Enqueue post-live invitations transactionally. Add one idempotent warning-enqueue function called by billing reconciliation. Require a constant-time worker-secret comparison, service-role client, commercial staging environment check, and a bounded batch of at most 25.

- [ ] **Step 8: Configure staging-only scheduling and validation**

Add a Vercel cron for `/api/internal/notifications/process`; require all four email/worker variables only when `APP_ENV=staging` and notification delivery is enabled. Do not add secret values to files or examples that resemble credentials.

- [ ] **Step 9: Run notification tests green**

Run: `npm test -- --run tests/notification-provider.test.ts tests/notification-worker.test.ts tests/pilot-readiness-db.test.ts`

Expected: PASS; fake provider sees only the staging test recipient and stable idempotency keys.

---

### Task 3: Recoverable invitation-delivery state and seat reservation

**Files:**
- Modify: generated migration from Task 1
- Modify: `src/lib/commercial-admin/contracts.ts`
- Modify: `src/lib/commercial-admin/actions.ts`
- Modify: `src/components/commercial-admin/commercial-admin-screen.tsx`
- Modify: onboarding invitation snapshot/contracts only where needed for delivery status
- Create: `tests/commercial-invitation-delivery-ui.test.tsx`
- Modify: `tests/onboarding-manager-invitations-db.test.ts`
- Modify: `tests/commercial-post-live-admin-db.test.ts`

**Interfaces:**
- Produces safe invitation delivery state: `queued | processing | accepted_by_provider | retrying | permanently_failed`, independent from invitation lifecycle `pending | accepted | revoked | expired | superseded`.
- Produces stable command results `privileged_capacity_reached` and `delivery_retry_throttled` without provider internals.
- Consumes the notification outbox and worker from Task 2.

- [ ] **Step 1: Write failing database tests for capacity and cooldown**

Test active privileged memberships plus pending unexpired manager invitations, exact tenth reservation, eleventh rejection, concurrent create/accept at the final seat, expired/revoked/superseded release, acceptance recheck, onboarding bypass closure, post-live bypass closure, and resend per-invitation/per-organisation cooldown.

- [ ] **Step 2: Run manager invitation tests red**

Run: `npm test -- --run tests/onboarding-manager-invitations-db.test.ts tests/commercial-post-live-admin-db.test.ts`

Expected: FAIL where pending invitations are excluded or acceptance can exceed the limit.

- [ ] **Step 3: Implement locked fail-closed privileged capacity**

Use one transaction-scoped advisory lock derived from organisation UUID before create or accept. Resolve the `members.privileged.limit` entitlement server-side; count active privileged memberships plus pending unexpired privileged invitations; fail closed when entitlement is absent; recheck before membership/role writes.

- [ ] **Step 4: Run capacity tests green**

Run: `npm test -- --run tests/onboarding-manager-invitations-db.test.ts tests/commercial-post-live-admin-db.test.ts`

Expected: PASS including concurrent cases.

- [ ] **Step 5: Write failing UI tests for split creation/delivery state**

Assert that a created invitation with retrying/permanent delivery failure remains listed as created, explains that the email was not delivered, offers a bounded retry action, and never suggests creating another invitation. Assert provider codes and token material are absent.

- [ ] **Step 6: Run the UI test red**

Run: `npm test -- --run tests/commercial-invitation-delivery-ui.test.tsx`

Expected: FAIL because the current UI conflates queued/created state and has no durable recovery copy.

- [ ] **Step 7: Implement the minimal recovery UI and safe contract fields**

Render invitation lifecycle and delivery state separately. Preserve the entered email after validation/delivery errors, disable retry during cooldown/processing, and use plain commercial wording with accessible live regions and 44px controls.

- [ ] **Step 8: Run invitation tests green**

Run: `npm test -- --run tests/commercial-invitation-delivery-ui.test.tsx tests/onboarding-manager-invitations-db.test.ts tests/commercial-post-live-admin-db.test.ts`

Expected: PASS.

---

### Task 4: Canonical owner-only customer export

**Files:**
- Modify: generated migration from Task 1
- Create: `src/lib/exports/canonical-json.ts`
- Create: `src/lib/exports/customer-export.ts`
- Create: `src/app/admin/organisation/export/route.ts`
- Modify: `src/components/commercial-admin/commercial-admin-screen.tsx`
- Modify: `src/types/tenancy.ts`
- Create: `tests/canonical-json.test.ts`
- Create: `tests/customer-export.test.ts`
- Modify: `tests/pilot-readiness-db.test.ts`

**Interfaces:**
- Produces: `canonicalJson(value: JsonValue): string`, sorting object keys recursively while preserving explicitly sorted projection arrays.
- Produces: `buildCustomerExport(deps): Promise<{ filename: string; canonicalBody: string; digest: string; counts: Record<string,number> }>`.
- Produces: owner/AAL2 route `GET /admin/organisation/export` returning versioned JSON with `Cache-Control: private, no-store`.
- Produces immutable `customer_export_audits` and owner-only `organisation.export` permission.

- [ ] **Step 1: Write canonical serialization tests first**

Use hand-derived literal JSON for differently ordered nested objects, Unicode, nulls, booleans, numbers, and arrays. Assert equal semantic objects produce identical bytes/digests and array order remains explicit rather than globally sorted.

- [ ] **Step 2: Run canonical tests red**

Run: `npm test -- --run tests/canonical-json.test.ts`

Expected: FAIL because the serializer is absent.

- [ ] **Step 3: Implement canonical JSON and digest helper**

Recursively sort plain-object keys by code point, reject `undefined`, non-finite numbers and non-JSON prototypes, emit UTF-8 compact JSON, hash the manifest and data before adding the digest field, and document the exact digest envelope version.

- [ ] **Step 4: Run canonical tests green**

Run: `npm test -- --run tests/canonical-json.test.ts`

Expected: PASS with literal byte strings and SHA-256 values.

- [ ] **Step 5: Write failing export authorization/projection tests**

Test unauthenticated, AAL1, non-owner, wrong-tenant and missing-entitlement denial; full/grace/restricted/cancelled-period-end/effective-cancellation access; all required category counts; stable ordering; forbidden-field recursive scan; no raw provider/Auth/device/invitation secrets; original event and correction ancestry inclusion; immutable audit receipt; no evidence mutation.

- [ ] **Step 6: Run export tests red**

Run: `npm test -- --run tests/customer-export.test.ts tests/pilot-readiness-db.test.ts`

Expected: FAIL because permission/projection/audit boundaries do not exist.

- [ ] **Step 7: Implement explicit SQL projection and server route**

Add `organisation.export` and owner grant. Expose one guarded owner/AAL2 export RPC that resolves the organisation from the selected membership, runs in a consistent transaction snapshot, aliases every allowed column, sorts every category by stable IDs/timestamps, and writes an immutable audit receipt after digest calculation through a narrow completion RPC. Keep document bytes explicitly omitted.

- [ ] **Step 8: Add the owner export control**

Show a single “Download organisation data” action in the organisation admin area with explanatory non-destructive cancellation copy. Do not expose the control to non-owners or imply automated deletion.

- [ ] **Step 9: Run export tests green**

Run: `npm test -- --run tests/canonical-json.test.ts tests/customer-export.test.ts tests/pilot-readiness-db.test.ts`

Expected: PASS, including a recursive forbidden-marker scan and unchanged evidence hashes.

---

### Task 5: Kiosk PIN and registration-claim abuse controls

**Files:**
- Modify: generated migration from Task 1
- Modify: `src/lib/onboarding/kiosk-actions.ts`
- Modify: `src/components/onboarding/commercial-kiosk-registration.tsx`
- Modify: `tests/onboarding-kiosk-db.test.ts`
- Modify: attendance tenancy/commercial kiosk focused tests

**Interfaces:**
- Produces shared atomic PIN evaluation with threshold `3` and lock duration `15 minutes` for verification and attendance writes.
- Produces `claim_commercial_kiosk(registration_id uuid, registration_secret text, claimant_nonce text)` that requires a valid registration UUID and stores at most one bounded attempt row per registration scope.

- [ ] **Step 1: Write failing PIN threshold/concurrency tests**

Test first and second generic failures, third sets lock, correct PIN during lock creates no event, lock expiry plus correct PIN clears state, three concurrent wrong attempts reach exactly three, and all commercial wrapper paths share the same state.

- [ ] **Step 2: Run PIN tests red**

Run: `npm test -- --run tests/pilot-readiness-db.test.ts tests/attendance-tenancy-db.test.ts`

Expected: FAIL because commercial functions do not enforce the lock.

- [ ] **Step 3: Implement one row-locked PIN guard in SQL**

Lock `staff_kiosk_settings` before checking the hash, increment atomically, set `locked_until` on the third failure, clear only after a successful post-lock verification, and return the existing generic safe outcome. Never alter clock events during failure/lock handling.

- [ ] **Step 4: Run PIN tests green**

Run: `npm test -- --run tests/pilot-readiness-db.test.ts tests/attendance-tenancy-db.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing kiosk-claim scope tests**

Assert omitted/malformed UUID is rejected without an attempt-row insert; varied wrong codes against one registration consume one counter; rate-limiting registration A does not block registration B even from the same test client/network; successful claim/replay/replacement remain valid; expired rows are purged.

- [ ] **Step 6: Run claim tests red**

Run: `npm test -- --run tests/onboarding-kiosk-db.test.ts tests/pilot-readiness-db.test.ts`

Expected: FAIL on the null-ID legacy path and attacker-controlled scope.

- [ ] **Step 7: Implement registration-scoped claims and update UI/actions**

Require the UUID in Zod, action and component inputs. Hash only the server-issued registration UUID into the attempt key. Reject null/invalid IDs before inserting. Keep per-registration thresholds and no IP-only global lock, then add guarded expiry cleanup.

- [ ] **Step 8: Run kiosk tests green**

Run: `npm test -- --run tests/onboarding-kiosk-db.test.ts tests/pilot-readiness-db.test.ts tests/attendance-tenancy-db.test.ts`

Expected: PASS with zero offline device/authorisation changes.

---

### Task 6: Operational documentation and exact-SHA staging authority

**Files:**
- Modify: `.github/workflows/promote-staging.yml`
- Modify: `docs/commercial/environments-and-releases.md`
- Create: `docs/commercial/pilot-manual-closure.md`
- Create: `docs/commercial/pilot-backup-rollback-checklist.md`
- Modify: `docs/commercial/workstream-9-5-completion-report.md`
- Modify: `.env.example` only for variable names with obviously inert values

**Interfaces:**
- Consumes: existing protected `commercial-staging` GitHub environment and fixed commercial Vercel org/project IDs.
- Produces: exact-SHA Preview-target staging promotion with no Production/Jan authority, plus manual non-destructive closure and rollback procedures.

- [ ] **Step 1: Harden workflow assertions before credential transfer**

Require the workflow ref to resolve to the independent commercial repository, verify Vercel inspect reports the exact requested SHA and staging environment, and fail before deploy if token/org/project inputs are absent. Keep Preview target only.

- [ ] **Step 2: Document manual closure and recovery procedures**

Record owner/AAL2 verification, legal hold, final export, retention approval, access/provider revocation, evidence preservation, later separately approved deletion/anonymisation, backups/PITR, additive schema rollback, previous-SHA app rollback, Stripe replay, secret inventory and incident contacts.

- [ ] **Step 3: Update environment documentation**

List staging-only Resend and worker variable names, recipient redirection policy, Supabase Auth ownership, domain/DKIM/SPF/DMARC requirements for future Production, and the rule that no secret is copied into repository/chat/log output.

- [ ] **Step 4: Transfer the staging deployment token without exposing it**

Create/use a least-privilege short-lived Vercel token and place it directly in the GitHub `commercial-staging` environment as `COMMERCIAL_VERCEL_TOKEN`; confirm the old absent/invalid state cannot authenticate. Do not use shell output or chat for the token value.

---

### Task 7: Complete verification, staging acceptance, and milestone commit

**Files:**
- Modify: `scripts/staging-admin-acceptance.mjs`
- Modify: `docs/commercial/workstream-9-5-completion-report.md`
- Modify: only files with reproduced acceptance-blocking defects

**Interfaces:**
- Consumes: Tasks 1-6.
- Produces: reproducible local/CI/staging evidence and the final `Pilot Readiness Finalisation` commit.

- [ ] **Step 1: Extend focused staging acceptance**

Exercise with fictional data: add staff, rota create/publish, leave request/approval, online PIN clock-in/out and lockout, correction/original-event preservation, payroll prepare/approve/export, site management, manager invitation creation plus delivery recovery/acceptance, settings update, and owner export download/digest verification.

- [ ] **Step 2: Run local focused and full verification**

Run: `npm test -- --run tests/notification-provider.test.ts tests/notification-worker.test.ts tests/commercial-invitation-delivery-ui.test.tsx tests/canonical-json.test.ts tests/customer-export.test.ts tests/pilot-readiness-db.test.ts tests/onboarding-kiosk-db.test.ts tests/onboarding-manager-invitations-db.test.ts tests/commercial-post-live-admin-db.test.ts`

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run lint`

Run: `npm run build`

Expected: all PASS with no demo fallback and no sensitive-marker output.

- [ ] **Step 3: Run database/security verification**

Run the repository’s migration-history verification, PGlite replay, clean Docker-backed Supabase replay, pgTAP suite, dependency audit, Gitleaks, browser sensitive-marker scan and Supabase advisor commands documented in `package.json` and the commercial release guide.

Expected: zero unresolved externally exploitable Critical/Important findings; any retained advisor notices have unchanged documented dispositions.

- [ ] **Step 4: Review the diff and evidence invariants**

Confirm no Jan URL/credential/data, no Production environment change, no offline authority, no rendered invitation URL persistence, canonical digest reproducibility, unchanged original clock-event/correction hashes, and no unrelated UI redesign.

- [ ] **Step 5: Commit the complete milestone**

Run: `git add` only the reviewed pilot-finalisation files, then `git commit -m "Pilot Readiness Finalisation"`.

Expected: one local milestone commit after the approved design commit and a clean worktree.

- [ ] **Step 6: Push only the independent commercial branch and wait for CI**

Push `codex/commercial-production` to `commercial-origin` without force. Wait for every required workflow and fix only failures caused by this milestone.

- [ ] **Step 7: Deploy the exact passing SHA to Commercial Staging**

Dispatch `Promote Commercial Staging` for the verified SHA. Confirm `/api/health/ready` reports the same SHA and `environment: staging`; no Production deployment is created.

- [ ] **Step 8: Run fictional staging email/export/security acceptance**

Send only to controlled Resend test recipients, prove provider acceptance/retry/permanent failure, invitation recovery UI, owner export/digest, PIN lockout, independent claim limits, privileged-seat cap, online attendance, and offline count zero.

- [ ] **Step 9: Publish the exact pilot verdict**

Update the completion report with files, migration, test totals, CI/deployment IDs, fictional fixture disposition, remaining manual domain/provider work, Jan/Production non-access confirmations, worktree state, and either `## PILOT READY` or `## NOT PILOT READY` with concrete blockers.
