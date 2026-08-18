# Pilot Readiness Finalisation Design

Status: approved design

Date: 18 August 2026

Repository: `Cloukyo/sh-workforce-platform`

Baseline: `1cae09669f984af53fb45fc6f8c308271f97303f`

## Objective

Make the existing commercial platform safe and complete enough for product UX review, marketing-site work, and one closely supervised external pilot. This pass fixes confirmed pilot blockers only. It does not introduce a new platform architecture, redesign working workflows, create Commercial Production, enable offline attendance, or touch Jan Production.

## Confirmed pilot blockers

1. Commercial invitation and operational notifications have durable intent but no real delivery worker.
2. Organisation owners cannot retrieve a complete, safe customer-data export.
3. Online kiosk PIN verification permits unlimited guesses after a device credential is obtained.
4. Anonymous kiosk registration claims can evade rate limiting by rotating guessed codes.
5. Pending privileged invitations do not reserve plan capacity, allowing manager-seat limits to be exceeded.
6. The exact-SHA staging promotion workflow cannot authenticate because its commercial-only Vercel token is absent.

## Global constraints

- Resend is the Commercial Staging transactional-email adapter only.
- Transactional-email domain logic must depend on a provider-neutral interface, not Resend types.
- Supabase Auth continues to own verification, password-reset, MFA and other Auth security email.
- Staging acceptance uses only controlled fictional Resend test recipients.
- No Jan recipient, credential, environment, database, deployment or branding may be used.
- No Production email, Vercel deployment, Stripe configuration or Supabase project is created.
- Offline attendance and offline authorisation remain disabled.
- Original clock events remain immutable; corrections remain separate evidence.
- No automated customer deletion, native application, major redesign, new industry or speculative module is added.
- UK date/time/currency presentation and `Europe/London` remain authoritative.

## 1. Provider-neutral notification delivery

### Domain boundary

Create a server-only `TransactionalEmailProvider` contract whose input contains only a versioned notification message:

- stable message ID;
- message type and template version;
- recipient address;
- subject and rendered HTML/text bodies;
- deterministic idempotency key;
- safe tags needed for provider correlation.

The result is either provider-accepted with a provider reference, retryable failure with a bounded safe code, or permanent failure with a bounded safe code. Provider errors, request bodies, recipient addresses, tokens and secrets are never written to general logs.

The Resend adapter implements this contract. No database function, invitation action, billing lifecycle function or UI component imports Resend directly.

Invitation-token retrieval and acceptance-link rendering occur only inside the trusted delivery worker after a message is atomically claimed. The worker holds the raw token only in memory for that attempt. It does not persist or return a rendered acceptance URL, and neither application actions nor customer-facing responses can retrieve the raw token.

### Durable outbox

Retain the existing invitation-token model:

- the invitation table stores only the token hash;
- the raw token remains encrypted in Supabase Vault while delivery is pending;
- browser clients cannot read the outbox or Vault material;
- only guarded service-role boundaries can claim and complete delivery;
- terminal delivery, invitation acceptance, revocation, supersession or expiry removes delivery secret material.

Extend the durable message model so it can represent manager invitations, staff invitations, trial-ending warnings and payment-failure warnings without requiring an invitation ID for non-invitation messages. Each message has a unique durable notification key, claim state, retry count, next-attempt time, provider reference, accepted timestamp and terminal failure evidence.

The database exposes narrow service-role commands to:

1. claim the next due message atomically using `FOR UPDATE SKIP LOCKED`;
2. recover a stale processing claim;
3. return only the fields needed to render and deliver that message;
4. record provider acceptance or bounded failure;
5. reconcile a repeated delivery using the same stable message and provider idempotency key.

Post-live invitation creation and resend enqueue delivery within the same database transaction as invitation creation. Production-visible manual acceptance paths are removed from the customer result. Existing environment-gated preview helpers may remain for automated tests, but cannot operate in Production.

### Worker and scheduling

A guarded server route processes a small bounded batch. It requires a separate cron bearer secret, rejects interactive/browser authentication, validates the commercial environment, and performs no work outside `staging` or a separately approved future `production` environment.

The guarded route is invoked directly during Commercial Staging acceptance because the staging project deliberately remains on Vercel's Preview target, where Vercel Cron is not invoked. The committed cron declaration is dormant in Preview and is not treated as automatic-delivery evidence. A separately approved scheduler or future commercial Production target is required before an external pilot relies on unattended delivery. Each provider request uses a deterministic idempotency key based on the durable outbox ID and template version. A worker crash after provider acceptance can therefore reconcile without sending a duplicate within the provider idempotency window.

Payment-failure and trial-ending messages are enqueued from authoritative billing state, not directly sent from the Stripe webhook or browser. Unique milestone keys prevent repeated webhook delivery and the hourly billing reconciler from creating duplicate warnings.

### Templates and recipient safety

Templates use the platform branding abstraction and contain no Jan, nursery or preschool wording. The first version includes:

- manager invitation;
- staff invitation;
- trial ending;
- payment failure/grace warning.

Onboarding continuation uses the relevant invitation template. Supabase Auth continues to send verification, reset and essential Auth security notifications.

Staging delivery is fail-closed to an explicit test-recipient policy. Acceptance uses Resend addresses such as `delivered+manager@resend.dev`, never invented domains or real Jan users. Production later requires a verified sending subdomain, approved sender/reply-to address, DKIM, SPF, DMARC policy, provider webhook configuration and a separate key.

## 2. Complete owner customer-data export

### Authority

Add a dedicated `organisation.export` permission granted only to the organisation-owner role. Export requires:

- authenticated commercial identity;
- active membership in the selected organisation;
- organisation-scoped owner role;
- AAL2;
- current `exports.customer` entitlement decision;
- server-side organisation resolution with no client-authoritative organisation ID.

The capability remains available in full, grace, restricted, scheduled-cancellation and effective-cancellation states, matching the frozen entitlement matrix.

### Versioned bundle

The pilot format is one versioned JSON bundle. JSON avoids a new archive dependency, preserves nested evidence and can be converted later without changing the authoritative projection. The response uses `private, no-store`, content-disposition attachment headers and a neutral safe filename.

The top-level manifest records:

- export schema/version;
- organisation ID;
- generated timestamp in UTC;
- presentation timezone `Europe/London`;
- per-category counts;
- deterministic SHA-256 digest;
- explicit omissions or retrieval errors.

The digest is computed over a canonical JSON serialization with recursively sorted object keys, stable array ordering defined by each projection, UTF-8 encoding, and no insignificant whitespace. The digest field itself is excluded from the bytes being hashed, so another implementation can reproduce and verify it exactly.

The bundle includes explicit allowlisted projections for:

- organisation;
- sites and closures;
- staff profiles;
- staff-site assignments;
- qualifications, credentials, compliance requirements and document metadata;
- original clock events;
- attendance corrections and ancestry;
- attendance exceptions;
- rota weeks, shifts and templates;
- leave requests and decisions;
- payroll periods, preparations, rows, adjustments, approvals and export audits;
- organisation and site settings;
- safe membership, role and site-access metadata;
- invitation lifecycle metadata without tokens.

Historical, archived, cancelled and ended records remain included where they belong to the organisation. The export reads a consistent database snapshot and does not recalculate or mutate operational evidence.

### Exclusions

The bundle never contains:

- password or Auth hashes;
- Auth user IDs or session metadata;
- PIN hashes/verifiers or failure counters;
- kiosk/device tokens or token hashes;
- registration secrets, nonces or fingerprints;
- invitation token hashes or raw tokens;
- Vault IDs or values;
- service credentials;
- Stripe customer/subscription/price/session/webhook identifiers;
- onboarding command receipts, request hashes or raw drafts;
- private storage paths;
- encrypted DBS/reference values.

Compliance document metadata is included. File bytes are explicitly recorded as deferred for the supervised pilot unless the current authorised storage path can be exported without exposing internal paths or weakening access controls.

### Audit receipt

Create an immutable customer-export audit receipt containing organisation, actor membership, access mode, schema version, filename, digest, per-category counts and completion time. Direct customer writes and updates/deletes are denied. Repeated downloads may create distinct receipts, but must never alter customer data.

## 3. Cancellation and manual closure safety

Cancellation remains period-end and non-destructive. Scheduled or effective cancellation does not delete organisation, staff, attendance, corrections, rota, leave, payroll, compliance, settings or membership evidence. Authorised owners retain export access.

Add concise customer copy explaining that cancellation stops future renewal, preserves records and requires a separate verified closure request for deletion. Do not imply automatic deletion.

Document the supervised pilot administrator procedure:

1. verify the requester and owner authority at AAL2;
2. record the request and legal-hold decision;
3. provide and verify a final customer export;
4. record retention obligations and the approved closure date;
5. revoke interactive access and provider credentials only after approval;
6. preserve immutable attendance and audit evidence for the required period;
7. perform deletion/anonymisation only under a later approved runbook;
8. record completion evidence.

No automated deletion or retention engine is added in this pass.

## 4. Kiosk abuse controls

### PIN verification and attendance

All commercial online PIN verification and attendance commands share one server-authoritative attempt state per staff/site/device security boundary. The command locks the PIN row before evaluation.

- A failed PIN increments the counter atomically.
- Three consecutive failures cause a 15-minute lockout.
- A locked PIN cannot verify or create attendance.
- A successful verification after the lockout expires clears the counter and lock timestamp.
- Concurrent failures cannot lose increments or permit an attendance event between the threshold and lock update.
- Error responses remain non-enumerating and do not reveal whether a staff identifier or PIN was closer to valid.

Existing historic counters are normalised safely without altering clock events.

### Kiosk registration claims

Manual claims must include the server-issued registration UUID as well as the human-readable code. Rate-limit scope is derived from that registration UUID, never from attacker-controlled guessed code material. Missing or malformed identifiers are rejected through one bounded, non-persistent path rather than creating attacker-selected rows.

Varied wrong codes for the same registration ID converge on the same bounded rate limit. Invalid attempts cannot create an unbounded number of rows. No broad IP-only or shared-network lock may prevent unrelated organisations or devices from claiming their own registration. Expired attempt rows are removed by a guarded retention function and scheduled cleanup when `pg_cron` is available. Successful claim, replay recovery and replacement-device behavior remain unchanged.

## 5. Privileged invitation capacity and abuse controls

Privileged capacity counts both active privileged memberships and pending, unexpired privileged invitations. An organisation-level advisory/row lock serialises invitation creation and acceptance at the capacity boundary.

- Onboarding and post-live manager creation reserve one seat atomically.
- The eleventh reserved seat on a ten-seat plan is rejected with a stable capacity result.
- Acceptance rechecks capacity inside the same transaction before creating membership and role assignments.
- Revoked, superseded or expired invitations release their reservation.
- Concurrent create/accept operations cannot exceed the plan limit.
- Resend is throttled per invitation and per organisation.
- Direct RPC calls cannot bypass the entitlement or cooldown checks.

Customer UI treats invitation creation and email delivery as two durable states. A successfully created invitation remains visible and recoverable when delivery is retrying or permanently failed; copy must not imply that creation failed or invite the user to create a duplicate. Authorised users can retry delivery only through the bounded resend workflow and can inspect a safe status without provider details or recipient leakage beyond the already-authorised address.

Existing owner-last-role protection and organisation/site scope validation remain unchanged.

## 6. Staging deployment automation

The existing `Promote Commercial Staging` workflow remains the deployment boundary:

- manual `workflow_dispatch` with an exact SHA;
- fixed repository guard for `Cloukyo/sh-workforce-platform`;
- protected `commercial-staging` GitHub environment;
- fixed commercial Vercel organisation and project IDs;
- Preview-target Vercel build/deploy only;
- no Production alias or Production secret;
- no Jan repository, project or credential authority.

Create a dedicated Vercel access token for this workflow and transfer it directly into the GitHub `commercial-staging` environment as `COMMERCIAL_VERCEL_TOKEN` without displaying, logging or committing it. Verify the workflow deploys an approved exact SHA and that `/api/health/ready` reports that SHA and `environment: staging`.

If Vercel cannot restrict the token to the staging project, document the platform limitation, use the narrowest available team scope and a short expiry, and retain the fixed project/repository/environment guards as defence in depth.

## 7. Pilot UX scope

No redesign is included. Staging acceptance exercises these existing workflows:

- add staff;
- create/publish rota;
- request and approve leave;
- online kiosk PIN clock-in/out;
- attendance correction and review;
- payroll preparation, approval and export;
- site management;
- manager invitation and acceptance;
- settings update;
- owner customer-data export.

Only a defect that prevents task completion, causes dangerous ambiguity, loses entered data, exposes another tenant, or makes an essential control inaccessible is fixed. Other findings are ranked as Important or Nice to have for the later UX pass.

## 8. Security and Supabase advisor boundary

The 113 dispositioned notices remain accepted unless implementation exposes a new Category A finding. New tables use RLS and explicit grants. Privileged functions use an empty/fixed search path, check service role or authenticated organisation authority internally, and revoke default `PUBLIC` execution. No client-supplied organisation ID becomes authoritative.

After database changes, run clean migration replay, pgTAP, tenant isolation tests and the Supabase advisor. The acceptance rule remains zero unresolved externally exploitable Critical/Important findings, not zero notices.

## 9. Backups, rollback and Production checklist

Documentation will provide two concise checklists.

The operational recovery checklist covers Supabase backups/PITR, additive migration policy, previous-SHA application rollback, Stripe webhook replay/reconciliation, environment-variable inventory and recovery, incident contacts, evidence preservation and non-destructive rollback.

The Production checklist separates requirements before the supervised pilot from later enhancements. Before-pilot items include final product/domain/support identity, approved legal URLs, independent Commercial Production Supabase and Vercel projects, live Stripe resources, verified transactional-email subdomain, backups, monitoring/error reporting, production secrets, DNS/TLS, privacy/cookie decisions, release authority and a rehearsal. Deferred items include sophisticated deletion automation, advanced analytics, native apps, offline attendance, elaborate preferences and broad UX redesign.

## 10. Verification

Implementation follows test-first development. Required focused evidence includes:

- outbox claim/retry/idempotency and no-token leakage;
- Resend adapter mapping using a fake HTTP/provider boundary;
- staging recipient restrictions;
- post-live and onboarding invitation enqueue/delivery;
- billing-warning deduplication;
- owner/AAL2/tenant/export-entitlement enforcement;
- complete export categories, counts, digest and forbidden-field recursive scan;
- export availability throughout billing lifecycle states;
- export/cancellation leaves clock-event and correction hashes unchanged;
- PIN failure threshold, lockout, concurrency, expiry and successful reset;
- rotating kiosk claim codes cannot bypass one rate bucket;
- pending privileged invitations reserve capacity and acceptance rechecks it;
- resend cooldown;
- unauthorised direct outbox/audit mutation denial.

Final verification runs the changed-feature tests, full application suite, TypeScript, ESLint, production build, migration history, PGlite replay, clean Docker-backed Supabase replay, pgTAP, dependency audit, Gitleaks/security, browser sensitive-marker scan, Supabase advisor and a focused Commercial Staging smoke. Previously accepted Stripe lifecycle and unrelated visual matrices are not repeated unless affected.

## Definition of done

The pass is complete when the five functional/security blockers and staging automation issue are resolved, staging-only Resend delivery is proven with fictional test recipients, the owner export works without secret leakage, cancellation remains non-destructive, exact-SHA staging promotion works, critical workflows pass focused staging acceptance, no new pilot-blocking security issue remains, offline stays disabled, Jan Production stays untouched, no Commercial Production exists, and the repository is committed and clean.
