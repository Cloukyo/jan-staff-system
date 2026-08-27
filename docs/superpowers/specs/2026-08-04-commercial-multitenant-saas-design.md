# Commercial Multi-Tenant SaaS Architecture Specification

**Status:** Architecture approved on 4 August 2026. This document is the formal specification for review before implementation planning.

**Baseline:** Git commit `8f03702f229530839f127e825bfbbb871f26a646`, the production-ready Jan system after PR #7.

**Working branch:** `codex/commercial-production`, isolated from Jan production.

## Purpose

Transform the Jan nursery staff system into a commercially sellable UK multi-tenant SaaS for independent nurseries and nursery groups. One customer organisation may operate one or more nursery sites. A single-site nursery is an organisation with one site.

The commercial system must preserve the existing attendance evidence model, correction audit, pay-preparation boundary, accessible workflows, UK formatting and Europe/London operational behaviour while adding hard organisation and site isolation.

## Approved architectural decision

Use one shared application deployment and one shared Supabase database schema per environment. Enforce tenancy through mandatory relational ownership, composite foreign keys, explicit grants, Row Level Security and server-validated RPCs.

- `organisation` is the customer account and primary tenant boundary.
- `site` is an individual nursery premises owned by one organisation.
- Every customer-owned operational record has a non-null `organisation_id`.
- Every premises-specific record also has a non-null `site_id`.
- Organisation-wide records do not use a synthetic or sentinel site. A nullable `site_id` is permitted only where the record is explicitly organisation-wide and the schema constrains that scope.
- Client-supplied ownership identifiers are routing hints only. Database policies and server operations validate them against current membership and permission records.
- Cross-organisation access is denied unless a separately controlled platform-support grant is active.
- White-label and reseller hierarchies are excluded. They may later be added above organisations without redefining the organisation/site security boundary.

## Alternatives considered

### Shared schema with row tenancy

Selected. It aligns with Supabase Auth, PostgREST, RLS, generated types, database migrations and organisation-wide reporting. It supports single-site and multi-site customers without duplicating infrastructure.

### Schema per organisation

Rejected. It would multiply migrations and generated API surfaces, complicate PostgREST exposure, and make pooled reporting and operations harder without providing the operational isolation of separate projects.

### Supabase project per organisation

Rejected for the initial product. It provides stronger physical isolation but multiplies deployments, secrets, migrations, backups, monitoring and incident handling. A dedicated enterprise deployment may be evaluated later without changing the logical organisation/site model.

## Scope

This specification covers:

- tenant and site ownership;
- membership, role and permission models;
- database integrity, RLS and RPC boundaries;
- safe migration of existing Jan data;
- organisation billing and product entitlements;
- customer onboarding, invitations and offboarding;
- support and break-glass administration;
- environment separation, CI/CD and release controls;
- security, privacy, accessibility and commercial operations;
- implementation workstream decomposition and acceptance gates.

## Non-goals

- White-label or reseller organisations.
- Child records or child-to-staff ratio calculations in the initial conversion.
- Tax, PAYE, National Insurance, pensions, statutory pay, deductions, payslips or HMRC submissions.
- Biometric, GPS or facial-recognition attendance.
- Deploying, migrating or connecting to Jan production as part of specification or planning.
- Destructive rewriting of original clock events or correction evidence.
- A physical database per customer in the initial product.
- International localisation. Initial commercial operation remains UK-focused, uses UK date, time and currency formats, and uses `Europe/London` for attendance operational dates.

## Baseline audit

### Strengths to retain

- Original `clock_events` are immutable evidence.
- Manager corrections are separate and append-only.
- Attendance exceptions and idempotent action requests have explicit audit records.
- Kiosk PIN verification is server-side and pay information is not exposed on the kiosk.
- Demo and production data paths fail separately rather than silently mixing.
- RLS, narrow function grants and manager/staff access patterns already exist.
- Pay preparation does not claim to perform statutory payroll calculations.
- The baseline has 54 passing test files and 572 passing tests.

### Blocking gaps

- All 32 customer operational tables are single-organisation.
- No organisation, site, membership, entitlement or scoped permission tables exist.
- Account identity assumes one globally unique `staff_accounts` row per Auth user.
- The only application roles are effectively manager and staff.
- Kiosk devices and attendance records have no site ownership.
- RLS policies cannot distinguish customers or authorised sites.
- Privileged functions were written for a single tenant and require full review.
- No customer onboarding, invitation acceptance, billing, support-access or offboarding workflow exists.
- No repository CI workflows or formal staging promotion path exists.
- No CSP or complete production security-header policy exists.
- Dependency audit reports seven high-severity packages: `next`, `xlsx`, `postcss`, `sharp`, `undici`, `js-yaml` and `brace-expansion`.
- No formal DPIA, data retention schedule, customer processor agreement, subprocessor record, DSAR workflow or breach runbook exists.

## Environment architecture

Each environment has its own Supabase project or fully isolated Supabase branch credentials and its own Vercel environment variables.

| Environment | Data | Database purpose | Deployment purpose |
| --- | --- | --- | --- |
| Local | Fictional seeds only | Migration replay and automated database tests | Developer testing |
| Pull request | Fictional deterministic seeds only | Ephemeral schema and tenant-isolation verification | Preview review and automated smoke tests |
| Staging | Fictional and approved synthetic data | Persistent integration, migration rehearsal and release candidate testing | Persistent pre-production |
| Production | Customer data | Commercial service | Customer-facing release |

Production data must not be copied into local, pull-request or ordinary staging environments. A separately controlled, sanitised migration rehearsal dataset may be generated when required.

Jan production remains a separate deployment and database until a later, explicitly approved migration programme.

## Core tenancy data model

### Organisations

`organisations`

- `id uuid primary key`
- `legal_name text not null`
- `display_name text not null`
- `slug text not null unique`
- `status text not null` constrained to `trial`, `active`, `past_due`, `suspended`, `offboarding`, `closed`
- `country_code text not null default 'GB'`
- `timezone text not null default 'Europe/London'`
- `billing_email text`
- `created_at`, `updated_at`, `archived_at`

An organisation is archived, not deleted, while retained customer evidence references it.

### Sites

`organisation_sites`

- `id uuid primary key`
- `organisation_id uuid not null`
- `name text not null`
- `slug text not null`
- `timezone text not null default 'Europe/London'`
- `active boolean not null default true`
- non-sensitive address and contact fields required for operational identification
- `created_at`, `updated_at`, `archived_at`
- `unique (organisation_id, id)`
- `unique (organisation_id, slug)`

Sites are archived rather than deleted once referenced by rotas, devices or attendance evidence.

### Relational tenant fences

Every tenant-owned parent table has `unique (organisation_id, id)`. Child tables reference both values:

```sql
foreign key (organisation_id, staff_id)
  references staff_profiles (organisation_id, id)
  on delete restrict
```

Site-owned records also use:

```sql
foreign key (organisation_id, site_id)
  references organisation_sites (organisation_id, id)
  on delete restrict
```

These constraints prevent cross-tenant links even when a privileged process bypasses RLS.

## Existing table ownership classification

| Existing table | Required ownership | Site rule |
| --- | --- | --- |
| `staff_profiles` | Organisation | Site access through dated assignments |
| `staff_accounts` | Replaced by membership and optional staff link | No direct site ownership |
| `staff_qualifications` | Organisation | Organisation-wide |
| `staff_certificates` | Organisation | Organisation-wide, optional site applicability added separately if required |
| `staff_central_records` | Organisation | Organisation-wide |
| `staff_central_record_items` | Organisation | Organisation-wide |
| `staff_reference_checks` | Organisation | Organisation-wide |
| `staff_import_reviews` | Organisation | Optional importing site context |
| `staff_account_access_audit` | Organisation | Optional site context for scoped changes |
| `staff_kiosk_settings` | Organisation | Site eligibility comes from staff-site assignment and optional site kiosk access |
| `staff_pay_arrangements` | Organisation | Organisation-wide with site-filtered costing derived from attendance |
| `leave_requests` | Organisation | Leave belongs to the worker; site impact derives from assignments and rotas |
| `rota_settings` | Organisation and site | Replaced or extended by `site_settings` |
| `rota_weeks` | Organisation and site | Mandatory site |
| `rota_shifts` | Organisation and site | Same site as rota week, enforced by composite FK |
| `rota_templates` | Organisation | Either organisation-wide or site-limited through explicit scope |
| `rota_template_shifts` | Organisation | Inherits template scope; applied shifts always receive a site |
| `rota_template_applications` | Organisation and site | Mandatory target site |
| `kiosk_devices` | Organisation and site | One active site binding at a time |
| `clock_events` | Organisation and site | Site snapshot is immutable evidence |
| `clock_event_corrections` | Organisation and site | Inherits original site; added evidence requires an authorised site |
| `attendance_day_reviews` | Organisation and site | Site of reviewed evidence |
| `attendance_correction_requests` | Organisation and site | Site of requested correction |
| `attendance_operation_requests` | Organisation and site | Site of operation |
| `attendance_action_requests` | Organisation and site | Derived from kiosk device and staff eligibility |
| `attendance_exceptions` | Organisation and site | Site of source evidence |
| `attendance_exception_operations` | Organisation and site | Same site as exception |
| `kiosk_offline_authorisations` | Organisation and site | Derived from device; disabled until separately released |
| `kiosk_offline_rate_limits` | Organisation and site | Derived from device |
| `kiosk_sync_health` | Organisation and site | Derived from device and authorisation |
| `payroll_import_batches` | Organisation | Optional site filter is explicit metadata |
| `payroll_import_review_rows` | Organisation | Same organisation as batch and staff |

## Staff and site assignments

`staff_site_assignments`

- `id uuid primary key`
- `organisation_id uuid not null`
- `staff_id text not null`
- `site_id uuid not null`
- `effective_from date not null`
- `effective_to date`
- `is_primary boolean not null default false`
- `employment_role_at_site text`
- audit actor and timestamps

Constraints prevent invalid date ranges and more than one active primary site per staff member. Multiple concurrent non-primary site assignments are permitted.

Site access for managers is independent from employment assignment. A manager may work at one site but hold authorised operational access to another.

## Identity and membership

Supabase `auth.users` remains the global login identity. Customer membership and employment are distinct.

`organisation_memberships`

- `id uuid primary key`
- `organisation_id uuid not null`
- `auth_user_id uuid not null`
- `staff_id text` nullable, constrained to the same organisation
- `status text not null` constrained to `invited`, `active`, `suspended`, `revoked`
- `joined_at`, `suspended_at`, `revoked_at`
- `created_by_membership_id`
- `unique (organisation_id, auth_user_id)`
- `unique (organisation_id, id)`

A user may hold active memberships in multiple organisations. The current organisation selected in the application is stored as a signed session preference and is revalidated on each server request. It is not an authorisation claim.

An ordinary staff member's membership links to their organisation's staff profile. Platform support identities do not receive permanent customer memberships.

## Roles and permissions

### Roles

- `organisation_owner`
- `organisation_admin`
- `hr_admin`
- `payroll_admin`
- `site_manager`
- `scheduler`
- `staff`

Roles are system-defined in the first commercial release. Customer-defined roles are deferred until permission usage and support requirements are proven.

### Scope

`membership_role_assignments` records:

- membership;
- role;
- `scope_type` constrained to `organisation` or `site`;
- `site_id`, required only for site scope;
- grantor, granted time and revocation time.

`membership_site_access` records the sites a membership may enter operationally. Role assignment and site access are both required for site-scoped privileged actions.

### Permission catalogue

The initial stable permissions are:

- `organisation.manage`
- `organisation.audit.read`
- `billing.manage`
- `membership.read`
- `membership.manage`
- `site.read`
- `site.manage`
- `staff.read`
- `staff.manage`
- `compliance.read`
- `compliance.manage`
- `leave.read`
- `leave.manage`
- `rota.read`
- `rota.manage`
- `attendance.read`
- `attendance.review`
- `attendance.correct`
- `payroll.read`
- `payroll.prepare`
- `payroll.export`
- `kiosk.read`
- `kiosk.manage`
- `settings.manage`

### Role boundaries

- Organisation owners receive all organisation permissions and control billing and ownership. The last active owner cannot be removed, suspended or downgraded.
- Organisation administrators manage sites, staff and access but do not automatically receive billing or ownership authority.
- HR administrators manage organisation-wide staff, compliance and leave records.
- Payroll administrators manage pay arrangements and pay preparation without receiving DBS or unrelated compliance detail by default.
- Site managers manage assigned sites' rotas, attendance, local staff visibility and kiosk devices.
- Schedulers manage rotas and leave impact only at authorised sites.
- Staff read only their permitted self-service records and cannot edit attendance history.

Owners, organisation administrators, payroll administrators, HR administrators and platform-support operators require MFA at AAL2 for privileged operations. Site managers are required to enrol MFA before commercial launch. Staff MFA may be optional initially.

## Authorisation rules

### Database authority

The database is authoritative for membership, permission and site access.

- Do not use `raw_user_meta_data` or any client-editable claim for authorisation.
- Custom JWT claims may contain a membership revision or UI hint but cannot grant access without a current database membership.
- Membership revocation must take effect on the next request to a sensitive RPC, even if the access token has not refreshed.
- Sensitive operations validate session identity and membership status server-side.

### Permission helpers

Privileged helper functions live in a non-exposed schema such as `private`.

Representative interfaces:

```sql
private.is_active_member(target_organisation_id uuid) returns boolean
private.has_permission(target_organisation_id uuid, requested_permission text) returns boolean
private.has_site_permission(target_organisation_id uuid, target_site_id uuid, requested_permission text) returns boolean
private.current_membership_id(target_organisation_id uuid) returns uuid
```

These functions are stable, have fixed search paths, expose no customer data, and are executable only by the roles that need them.

### RLS pattern

Organisation-wide reads require active membership plus the relevant permission or self-service relationship. Site-specific reads additionally require site permission.

Writes require both `USING` and `WITH CHECK` predicates where applicable. The resulting row must remain within the caller's authorised organisation and site.

Public kiosk access is restricted to narrow device RPCs. Anonymous roles receive no direct access to staff, attendance, rota, compliance or pay tables.

### RPC pattern

- RPCs do not accept an organisation identifier as proof of ownership.
- Manager RPCs resolve and validate the caller's membership.
- Kiosk RPCs resolve organisation and site from a hashed device token.
- Target staff must be active in the same organisation and eligible at the device site.
- Manager-created attendance evidence requires a site where the manager has `attendance.correct`.
- RPC outputs contain only fields needed by the caller and never expose pay or private HR data on kiosks.
- Every privileged function revokes default `PUBLIC` execution before explicit grants.
- `SECURITY INVOKER` is preferred. Necessary `SECURITY DEFINER` functions use a fixed or empty search path and perform their own membership validation.

## Kiosk and attendance ownership

Each kiosk device belongs to exactly one organisation and site. Rebinding a device revokes the old token and creates an audited new registration rather than rewriting historical ownership.

Every clock event stores immutable `organisation_id` and `site_id` snapshots. These values do not change if the staff member later transfers sites or a device is retired.

Attendance locks include organisation and staff identity. Idempotency records include organisation, site, device and request key. Offline authorisations, when separately enabled in a future release, include the same ownership and are valid for one device and site only.

The kiosk roster is the intersection of:

- active staff in the device organisation;
- active staff-site assignment for the device site;
- enabled kiosk access;
- any explicit temporary site access;
- subscription entitlement that does not compromise already-recorded evidence.

## Rota, leave and local settings

Rota weeks and shifts are site-specific. Cross-site views aggregate authorised sites but never remove the site identity from individual shifts.

Leave requests belong to an organisation and staff member. Leave normally applies to the worker across all assigned sites. Site impact is derived by comparing approved leave with site-specific shifts and assignments. A future partial-site leave case must be explicit rather than inferred.

Settings split into:

- organisation settings: work-week policy defaults, pay-preparation policy, compliance defaults and organisation branding;
- site settings: premises name, local rota rules, opening hours, kiosk policy, closure dates and site-specific operational defaults.

Site settings may inherit organisation defaults while storing explicit overrides with audit history.

Future room and staffing-operation records are site-specific from their first migration. Rooms, room assignments, staffing requirements, local capacity settings and ratio evidence must carry both `organisation_id` and `site_id`; no organisation-wide room record is permitted.

## Compliance and sensitive HR information

Staff identity, qualifications, central-record status, selected HR data and pay arrangements are organisation-wide. Site managers receive only the minimum staff and compliance fields needed for their sites.

DBS and suitability information requires stricter permissions than ordinary staff directory information. Full DBS identifiers, health evidence, identity documents and reference documents must not be stored in exposed tables or public storage. Document metadata and private object paths require organisation-scoped storage policies and narrow server access.

The commercial programme must complete a Data Protection Impact Assessment covering attendance monitoring, employment data, sickness information, DBS/criminal-offence information, support access, exports and retention. It must document lawful bases, special-category conditions where applicable, minimisation and retention decisions.

Biometric attendance remains excluded.

## Billing and entitlements

Billing is organisation-level.

### Billing tables

- `plans`
- `plan_entitlements`
- `organisation_subscriptions`
- `organisation_entitlements`
- `organisation_usage`
- `billing_webhook_events`

Provider identifiers and billing status are server-only. Signed webhook events are stored idempotently by provider event ID. Billing state is not trusted from client input or JWT claims.

### Entitlement dimensions

- active site limit;
- active staff limit;
- privileged membership limit;
- storage limit;
- enabled feature set;
- export or API usage where commercially required;
- offline kiosk availability, which remains disabled until separately released.

Entitlements are enforced at server mutation boundaries and in trusted database operations. UI hiding is informational only.

Subscription failure must not delete data, alter attendance or prevent a worker from completing an already-started attendance action. It may block new sites, new staff, premium features or new billing-period operations. Customers retain an offboarding export path and access to legally required evidence according to contract and retention policy.

## Invitations and onboarding

### Invitation model

`organisation_invitations` stores:

- organisation;
- normalised invited email;
- intended roles;
- intended site access;
- hashed token;
- expiry;
- inviter membership;
- accepted, revoked and expired states;
- terms/version metadata where required.

Raw invitation tokens are shown only in delivery URLs and are never stored. Acceptance is transactional and revalidates inviter authority, organisation state, role grantability, site ownership, expiry and current email identity.

### Customer onboarding sequence

1. Verify owner email.
2. Enrol owner MFA.
3. Present and record acceptance of terms, privacy information and the processor agreement.
4. Create the organisation and owner membership transactionally.
5. Create the first site.
6. Start the selected trial or subscription.
7. Configure organisation and site settings.
8. Import or create staff with reviewed validation results.
9. Create staff-site assignments.
10. Invite administrators, managers and staff with explicit scope.
11. Register a kiosk to one site.
12. Complete an organisation readiness checklist before live attendance.

Production mode never falls back to demo data during onboarding failure.

## Customer offboarding

Offboarding includes:

- subscription cancellation state separate from data deletion;
- organisation-wide export of customer-owned data and evidence;
- documented retention and legal-hold evaluation;
- revocation of memberships, invitations, devices and integration credentials;
- deletion or irreversible anonymisation after the approved retention period where legally permitted;
- immutable evidence that the export and deletion workflow was completed;
- special handling for backups and private storage objects.

Organisation deletion cannot be a direct UI `DELETE`. It is an auditable workflow with cooling-off and approval stages.

## Platform support and administration

Platform operators are not customer members by default.

`support_access_grants` requires:

- linked support case;
- organisation;
- optional site scope;
- explicit permissions;
- named platform operator;
- customer approver by default;
- reason;
- start and expiry times;
- read-only default;
- revocation details.

Support mode requires AAL2, displays a persistent banner, prevents hidden impersonation, and writes immutable access/audit records. Customer-visible audit shows who accessed the organisation, why, when and what privileged operations were performed.

Break-glass access is separate, time-limited, requires dual platform approval, creates a security incident record, and triggers retrospective review and customer notification according to policy.

Ordinary support tooling never exposes or uses the Supabase service-role key in the browser. Service-role operations are confined to narrow server processes and remain tenant-scoped in application logic.

## Audit and observability

Commercial audit events include:

- organisation and optional site;
- actor type and actor identifier;
- membership or support grant;
- action;
- target type and identifier;
- timestamp;
- request/correlation ID;
- safe change summary;
- source application or system process.

PINs, password material, tokens, service keys, salary values and unnecessary personal data are never written to general logs.

Application telemetry includes pseudonymous organisation/site identifiers, route, status, latency, deployment SHA and correlation ID. Error monitoring must support tenant-level incident investigation without making customer data broadly visible to platform staff.

## Security requirements

- Patch or replace all seven high-severity dependency findings before commercial pilot. Replace `xlsx` because no patched npm release is available.
- Pin dependency versions and commit the lockfile.
- Add Content Security Policy, HSTS, Referrer-Policy, Permissions-Policy, frame protection and content-type protection.
- Apply rate limits to authentication, invitations, kiosk PIN verification, device registration, exports and public endpoints.
- Use bot and abuse controls on anonymous surfaces.
- Keep secrets separated by environment and rotate them on a defined schedule.
- Require least-privilege GitHub, Vercel and Supabase team roles.
- Protect preview deployments and prevent preview credentials from reaching production.
- Store private documents in non-public storage with organisation-aware policies.
- Back up database and Storage objects under separate tested procedures.
- Enable persistent security and application log retention.
- Complete independent penetration testing before customer onboarding.
- Maintain vulnerability disclosure, incident response and breach-notification procedures.
- Review international transfer and subprocessor arrangements before sale.

## Privacy and legal readiness

Before commercial pilot, the product owner must obtain appropriate legal review and complete:

- customer terms of service;
- privacy notice;
- UK GDPR controller/processor allocation;
- Article 28-compliant data processing agreement;
- subprocessor list and change process;
- records of processing activities;
- DPIA;
- lawful basis and special-category/criminal-offence processing records;
- retention and deletion schedule;
- DSAR, correction, restriction, portability and deletion procedures;
- breach response and notification process;
- international-transfer assessment and safeguards;
- acceptable-use and support-access policies;
- service availability, backup and recovery commitments.

The product must not present these items as legal advice or claim compliance solely because technical controls exist.

## Accessibility and product quality

- Target WCAG 2.2 AA for manager, staff, onboarding, billing and kiosk journeys.
- Preserve large kiosk touch targets and plain-language workflows.
- Support keyboard, screen-reader, zoom, contrast and reduced-motion use.
- Publish an accessibility statement before sale.
- Include automated accessibility tests plus manual assistive-technology review.
- Define supported browsers, kiosk hardware and network requirements.
- Provide customer help, release notes, incident communication and a support escalation path.

## CI requirements

Every pull request must run:

1. clean lockfile install;
2. lint;
3. TypeScript checking;
4. unit and component tests;
5. fresh migration replay;
6. Supabase database tests;
7. generated database type drift check;
8. two-organisation tenant-isolation tests;
9. two-site permission-scope tests;
10. Playwright critical journeys;
11. automated accessibility tests;
12. dependency and licence checks;
13. secret scanning and CodeQL/SAST;
14. migration checksum validation;
15. production build;
16. protected preview smoke tests.

Required tenant tests attempt cross-organisation access through direct table operations, joins, views, RPC parameters, guessed identifiers, stale JWTs, invitations, exports, storage paths, kiosk tokens and service-side actions.

## Release requirements

- Protect `main` and require CI plus human review.
- Add CODEOWNERS review for migrations, RLS, auth, billing and platform support.
- Use persistent staging and ephemeral pull-request environments.
- Promote an immutable tested SHA through staging to production.
- Require a separate production approver and prevent self-approval.
- Permit only one production deployment at a time.
- Record application and migration versions for every release.
- Verify backup/PITR state and perform scheduled restore drills.
- Review expand/contract compatibility before every schema deployment.
- Run tenant isolation, permissions and evidence-integrity diagnostics after deployment.
- Maintain evidence-preserving application rollback and forward database repair procedures.
- Define incident severity, escalation, customer communications, RPO and RTO targets before pilot.

## Jan migration specification

Jan data migration is designed and rehearsed without touching Jan production.

### Preparation

1. Create a commercial staging organisation for Jan.
2. Create explicit Jan site records from an approved site inventory.
3. Create a written mapping for each kiosk, staff assignment, rota and site-local setting.
4. Generate a sanitised or access-controlled rehearsal copy outside ordinary preview environments.
5. Record table counts, clock-event hash, correction hash, correction-chain integrity and migration versions.

### Expand and backfill

1. Add nullable organisation and site columns.
2. Backfill organisation ownership for every customer row.
3. Backfill site ownership where source evidence proves the site.
4. Derive kiosk attendance sites from the device binding only when the historic mapping is reliable.
5. Require reviewed manager mapping for ambiguous manager-added or imported site evidence.
6. Add composite unique keys and foreign keys as `NOT VALID` where appropriate.
7. Validate constraints after zero unmapped or inconsistent rows are confirmed.

### Application cutover

1. Deploy tenant-aware reads and writes against the rehearsal environment.
2. Run all Jan workflows under one organisation and its authorised sites.
3. Confirm original events and corrections are unchanged.
4. Confirm every RPC rejects a second test organisation.
5. Confirm site managers cannot cross site boundaries.
6. Make ownership columns non-null only after the application no longer uses single-tenant paths.
7. Remove compatibility paths in a later contract migration.

### Stop conditions

- Unmapped customer row.
- Ambiguous attendance site without approved evidence.
- Decreased or altered original event count/hash.
- Broken correction chain.
- Cross-organisation or unauthorised cross-site access.
- Migration rerun or checksum mismatch.
- Unexpected payroll, weekly-hours or manager-hours difference.

No Jan production migration occurs without a separate approval, current backup, quiet-window checks, a rehearsed rollback target and a complete deployment report.

## Delivery workstreams

The implementation plan must decompose this specification into independently reviewable workstreams in this dependency order:

1. Commercial security and environment foundation.
2. Organisation, site, membership and permission primitives.
3. Tenant integrity helpers and test harness.
4. Jan clone ownership backfill rehearsal.
5. Authentication, organisation selection and invitations.
6. Staff, site assignment and compliance tenancy.
7. Site settings, kiosk and device tenancy.
8. Rota and leave tenancy.
9. Attendance, correction, exception and offline-record tenancy.
10. Payroll preparation, exports and reporting tenancy.
11. Billing and entitlement enforcement.
12. Support access, audit and offboarding.
13. Commercial assurance, accessibility, performance and pilot readiness.

Each workstream must define TDD steps, exact files and interfaces, migration ordering, tenant-isolation tests, evidence-preservation checks, rollback compatibility and a review gate.

## Commercial pilot entry criteria

The product cannot onboard an external customer until all criteria are true:

- Two organisations with multiple sites pass the full tenant-fence suite.
- Cross-organisation access fails through every exposed table, view, RPC, export and storage path.
- Site managers are restricted to permitted sites.
- All original attendance evidence and correction chains remain intact after migration rehearsal.
- All high-severity dependency findings are resolved or replaced with an independently approved mitigation.
- CI, staging promotion, production approval and rollback are operational.
- Database and Storage restoration have been exercised.
- MFA is enforced for privileged roles.
- Security headers, rate limits, WAF and persistent monitoring are enabled.
- DPIA, processor agreement, privacy notice, retention schedule and incident process have approved owners.
- Accessibility review and critical manual journeys pass.
- Independent penetration-test findings are closed or explicitly risk-accepted.
- Billing cannot alter or delete attendance evidence.
- Customer export and support-access audits are verified.
- Offline clocking remains disabled unless a later separately approved pilot satisfies its physical-device checklist.

## Specification acceptance tests

The eventual implementation is accepted only when automated tests demonstrate:

1. A user in organisation A cannot read or mutate any organisation B customer row.
2. A multi-organisation user receives only the selected and authorised organisation's records.
3. A site manager at site A cannot read or mutate site B records without explicit site B access.
4. An organisation owner can view authorised organisation-wide data across sites.
5. Composite foreign keys reject cross-organisation staff, site, device and attendance links even under privileged SQL.
6. A kiosk token resolves exactly one organisation and site and cannot accept a staff member not eligible there.
7. Attendance records retain immutable organisation and site snapshots.
8. Corrections cannot move original evidence to another organisation or site.
9. Stale or revoked membership cannot authorise a sensitive operation.
10. Invitation acceptance cannot grant a role or site that the inviter cannot grant.
11. Entitlement limits cannot be bypassed through direct API calls.
12. Subscription failure does not destroy evidence or prevent safe completion of attendance.
13. Support access is impossible without a current scoped grant and AAL2.
14. Production mode never falls back to demo records.
15. Jan rehearsal preserves event counts, evidence hashes, correction chains and effective totals.

## Review gate

This specification must be reviewed and approved before the phased implementation plan and roadmap are written. No application code, database migration, dependency upgrade, environment connection or deployment is authorised by approval of this document alone.

## Authoritative references

- Supabase Row Level Security: <https://supabase.com/docs/guides/database/postgres/row-level-security>
- Supabase Data API security: <https://supabase.com/docs/guides/api/securing-your-api>
- Supabase custom claims and RBAC: <https://supabase.com/docs/guides/api/custom-claims-and-role-based-access-control-rbac>
- Supabase MFA: <https://supabase.com/docs/guides/auth/auth-mfa>
- Supabase branching: <https://supabase.com/docs/guides/deployment/branching>
- Supabase backups: <https://supabase.com/docs/guides/platform/backups>
- Vercel production checklist: <https://vercel.com/docs/production-checklist>
- GitHub deployment environments: <https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments>
- ICO worker-monitoring guidance: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/employment/monitoring-workers/data-protection-and-monitoring-workers/>
- ICO controller and processor contracts: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/accountability-and-governance/contracts-and-liabilities-between-controllers-and-processors-multi/>
- ICO international transfers: <https://ico.org.uk/for-organisations/uk-gdpr-guidance-and-resources/international-transfers/>
- GOV.UK accessibility requirements: <https://www.gov.uk/guidance/accessibility-requirements-for-public-sector-websites-and-apps>
