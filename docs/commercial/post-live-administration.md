# Commercial Post-Live Administration

Workstream 8B introduces the normal administration boundary used after an organisation reaches Go Live. It does not reopen or update onboarding state.

## Authority boundary

`public.get_commercial_admin_snapshot` resolves the authenticated active membership and returns only organisation/site data permitted by the existing tenant model. `public.execute_commercial_admin_command` is the only new mutation boundary. It requires a live organisation, AAL2, permission checks, site fencing, an expected organisation revision and an idempotency key.

Browser clients do not choose an organisation, membership, owner role or permission set. Server actions resolve those from signed commercial membership context. Direct writes to administration receipts and audit evidence are denied.

## Supported administration

- Organisation profile and postal contact details.
- Site creation, editing and safe archival.
- Staff creation, safe editing/deactivation and effective-dated site assignments.
- Attendance eligibility and PIN resets without exposing stored PIN material.
- Membership roles/site scope, suspension and revocation with existing final-owner protection.
- Manager and ordinary-staff invitations, resend and revocation.
- Online kiosk registration, replacement, revocation and reprovisioning.
- Work areas, site closures, organisation defaults and site operating hours.

Site, staff and privileged-member growth commands call the central capability evaluator inside the transaction. An entitlement failure returns `upgrade_required`; it does not change RLS visibility.

## Evidence and concurrency

Every successful sensitive command advances `organisations.admin_revision` and appends one privacy-safe `commercial_admin_events` row. Payload values, PINs, invitation tokens and device credentials are not copied into audit metadata. Command receipts make same-payload retries deterministic and reject reuse of a key with changed content.

Sites, staff, assignments, work areas, closures and settings carry local revisions for display and future narrower concurrency controls. Membership authority continues to use `authorisation_revision`.

## History preservation

The customer UI archives or deactivates records. It does not delete organisations, sites, staff, devices, work areas or closures. Site archival is blocked while active staff assignments or kiosk devices remain. Staff transfers use effective dates and never rewrite attendance, rota, leave or payroll attribution.

A never-used site is still archived in Workstream 8B. Customer deletion and offboarding remain separately controlled future work.

## Offline attendance

Offline attendance is not an entitlement or administration option. Every kiosk command writes `offline_enabled = false`, no offline verifier or authorisation is issued, and no offline queue is activated.

## Compatibility and limits

The new `/admin` routes use commercial identity only. Existing Jan compatibility routes and unowned records are unchanged. The initial post-live UI supports manual staff creation; the already-tenant-fenced CSV import service remains available for a later dedicated commercial import screen. Production email delivery remains deferred, so invitation creation returns a one-time acceptance path for safe manual Preview testing.

Kiosk count enforcement will attach to the central capability evaluator when a kiosk-count capability is added to a versioned plan. No separate UI limit has been invented.

## Remaining launch work

- Billing provider and subscription lifecycle.
- Production email/notification delivery.
- Customer export, retention and offboarding.
- Dedicated security-advisor remediation.
- Commercial Production readiness and external pilot.
