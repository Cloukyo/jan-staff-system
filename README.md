# Jan Staff

Rota, Attendance and Pay Preparation for Jan Pre-School and Nursery.

This is a local prototype with a Supabase production path. It replaces the paper weekly rota and sign-in sheet with a manager-controlled rota, shared staff clocking kiosk, attendance review, leave requests, pay-preparation estimates and CSV exports.

It is not a payroll system. It does not calculate PAYE, National Insurance, pensions, statutory pay, deductions, payslips or HMRC submissions.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

For the local demo, leave Supabase variables as placeholders and use the seeded browser data. For production-style authentication, create a Supabase project, fill in `.env.local`, run the migration and seed the first manager account as described below.

## Main Routes

- `/login`: Supabase email and password login with password reset.
- `/dashboard`: operational summary.
- `/staff`: staff directory, add staff and edit staff.
- `/rota`: weekly rota editor.
- `/leave`: staff leave history.
- `/leave/request`: staff leave request form.
- `/leave/requests`: manager leave review dashboard.
- `/accounts`: manager account-linking area.
- `/compliance`: manager-only staff compliance, central-record and certificate tracking.
- `/profile`: signed-in staff profile.
- `/clock`: public kiosk for staff PIN clocking.
- `/attendance`: manager review and correction.
- `/payroll`: pay-preparation summaries and CSV export.
- `/settings`: prototype settings and demo data reset.

## Demo Data and Persistence

The app uses seeded fictional demo data and browser localStorage. Changes survive refreshes in the same browser. Use Settings, then `Reset and reseed demo data`, to restore the seed records.

The data layer lives behind a repository abstraction in `src/lib/repositories/demo-store.tsx` so Supabase can replace the local implementation later without spreading storage code through UI components.

Current local data schema version: `5`.

Version 3 migrated earlier demo records by:

- Repairing legacy contracted weekly hour values that were stored as hours instead of minutes.
- Backfilling attendance approval records.
- Backfilling holiday, sickness and training pay-treatment fields.
- Adding attendance pagination, bulk approval and pay-adjustment settings.

Version 4 adds approval audit metadata and development date/scenario settings. It preserves existing clock events, adjustments and approvals, and backfills older approvals with demo manager audit fields.

Version 5 adds linked staff-account demo records and leave-request demo records. It does not alter original clock events or manager attendance corrections.

## Authentication and Database

Production authentication uses Supabase Auth with email and password. Passwords are stored and reset by Supabase, not by this application. App-specific account links are stored in `public.staff_accounts`, which connects a Supabase Auth user to an existing staff record, role and active/inactive status.

Production leave requests use Supabase Postgres table `public.leave_requests`. The migration in `supabase/migrations/202606100001_auth_leave_requests.sql` creates constrained enums, audit fields, duplicate-account protections, row-level security policies and manager/staff access rules.

Required environment variables:

```bash
APP_MODE=production
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-supabase-publishable-key
```

No real secrets should be committed. `.env.example` contains placeholder names only.

### Compliance data mode

- `APP_MODE=demo`: compliance pages use clearly labelled, non-sensitive browser-only demo records.
- `APP_MODE=production`: compliance pages read exclusively from Supabase through the authenticated manager session.

In a production Next.js build, the default mode is `production`. In development, the default mode is `demo`. Set `APP_MODE` explicitly in Vercel. Missing Supabase configuration or a failed Supabase query displays an error and never falls back to demo staff data.

## Supabase Setup

1. Create a Supabase project.
2. Enable Email provider in Authentication.
3. Set Site URL to your local URL for development and your Vercel URL for production.
4. Run the migration:

```bash
supabase db push
```

Or paste `supabase/migrations/202606100001_auth_leave_requests.sql` into the Supabase SQL editor.

5. Create the first manager in Supabase Auth. Use a temporary password or invite email, then require the manager to reset it.
6. Copy `supabase/seed-first-manager.example.sql`, replace the placeholder Auth user ID and email, then run it in Supabase SQL editor.

Managers create further staff account links from `/accounts`, then invite the matching email in Supabase Auth and update `auth_user_id` on the account link. Disabled accounts are blocked by server login checks and RLS policies.

## Vercel Deployment

1. Push the repository to GitHub.
2. Import the project into Vercel.
3. Add the Supabase environment variables in Vercel Project Settings.
4. Set `NEXT_PUBLIC_SITE_URL` to the production URL.
5. Run the Supabase migration before first production use.
6. Configure Supabase Auth redirect URLs for the Vercel production URL and any preview URLs you intend to test.
7. Deploy with the default Next.js settings.

The public kiosk route must never expose salary, pay-rate or private manager information. It continues to use staff PIN clocking only.

## Staff Compliance and Central Records

Production staff compliance uses the migration in `supabase/migrations/202606100002_staff_compliance.sql`.

Tables added:

- `staff_profiles`: canonical production staff records. Auth links are optional and can be added later.
- `staff_qualifications`: permanent and expected qualifications.
- `staff_certificates`: renewable or non-expiring training and certificates.
- `staff_central_records`: manager-only central-record checklist, DBS status and masked DBS suffix.
- `staff_reference_checks`: current, previous and alternative reference checks.
- `staff_import_reviews`: audit trail for manual imports and warnings.

The central-record tables are manager-only through Supabase RLS. Ordinary staff can read only their own basic profile, qualifications and certificates. Staff cannot update roles, active status, qualifications, DBS status, central-record fields or account links.

Sensitive fields such as dates of birth, full DBS numbers, identity-document details, medical declarations and references must not be placed in demo seed files, browser storage or public Supabase storage. Use private storage or encrypted server-side storage for evidence references. List views should show only masked DBS values, such as the final four digits.

The local `/compliance` screen uses non-sensitive sample statuses so the manager workflow can be tested without committing real employment information.

Managers can use `/compliance` to add staff profiles, quick-edit role, qualification level and active status, then open `/compliance/staff/[staffId]` for full editable sections:

- Basic staff information and employment notes
- Account/login status
- Qualifications
- Training and certificates
- DBS and suitability
- Central-record checklist
- References
- Import warnings and audit information

Normal manager actions archive old qualification, certificate and reference records instead of deleting history. Production saves should go through server-side Supabase actions; local demo edits are clearly labelled and persist only in browser storage.

In production mode, `[staffId]` is the canonical `staff_profiles.id` returned by Supabase. Direct navigation and refresh reload the profile and all related records from Supabase.

### Manual cross-device verification

1. Set `APP_MODE=production` and configure Supabase.
2. Log in as a manager in browser A.
3. Create a test staff profile from `/compliance`.
4. Add a qualification, certificate and central-record checklist values.
5. Open the same deployment in browser B and sign in as a manager.
6. Confirm the profile, records and summary counts match.
7. Edit the certificate expiry date in browser B.
8. Refresh browser A and confirm the new expiry band appears.
9. Archive the test qualification/certificate/reference and confirm it disappears from active compliance calculations on both browsers.

## Manual Staff Import

Use `imports/staff-compliance-template.csv` as the safe format reference. Put real imports in `private-imports/`, which is ignored by Git:

```bash
private-imports/staff-compliance.private.csv
private-imports/staff-compliance.private.json
private-imports/staff-compliance.private.sql
```

Do not import unclear data silently. The import review table supports these statuses:

- `imported_successfully`
- `imported_with_warning`
- `skipped_invalid_data`
- `duplicate_suspected`
- `missing_required_information`

Known source-record warnings to review before import:

- Appointment date written as `31/04/22`
- DBS date that appears to match a date of birth
- Potentially reversed appointment-date and DOB fields
- Qualification dated in the future that may be an expected completion date
- Missing or unclear expiry dates
- Inconsistent course-title formatting

The supplied Vicarage Road source document includes 15 staff names. Use generated staff IDs based on names, not printed row numbers, because the document numbering is duplicated. Do not create Supabase Auth logins during import when email addresses are missing.

## Staff Login Invitations

Managers should:

1. Create or import the staff profile first.
2. Add the staff email when supplied.
3. Invite the user in Supabase Auth or through a future server-only invitation action.
4. Link the resulting Supabase Auth user ID to the existing staff profile/account.
5. Disable login by setting account/profile access inactive, without deleting staff history.

If a future invitation action uses Supabase Admin APIs, set `SUPABASE_SERVICE_ROLE_KEY` only as a server-side environment variable. Never expose it with a `NEXT_PUBLIC_` prefix.

## Supabase Migrations

Run migrations in order:

```bash
supabase db push
```

Or apply these files in the Supabase SQL editor:

1. `supabase/migrations/202606100001_auth_leave_requests.sql`
2. `supabase/migrations/202606100002_staff_compliance.sql`
3. `supabase/migrations/202606100003_compliance_editing.sql`

The second migration backfills `staff_profiles` from existing `staff_accounts` before adding the foreign key.

## Leave Requests

Staff can submit leave requests with a leave type, date range, full or partial day, optional times and notes. Managers can filter, approve or reject pending requests and save manager notes. Staff can cancel pending requests only.

Approved leave appears as a rota conflict warning. Pending leave appears as a softer rota warning. Rejected and cancelled leave do not block rota assignment. Existing shifts are never silently removed when leave is approved.

Working-day calculation currently excludes Saturdays and Sundays. Nursery closure dates are not stored yet; the leave calculation accepts a closure-date list so that a future closure calendar can be added without rewriting the workflow.

## Remaining Browser-Only Data

Until further migration work is completed, rota shifts, clock events, attendance approvals/corrections, pay-preparation summaries and demo settings still use browser localStorage in local demo mode. Production staff profiles, login links, leave requests, qualifications, certificates and central-record compliance are now modelled for Supabase. Production mode should be configured with Supabase and should not silently depend on browser demo staff records.

## Architecture Notes

Routes import feature-level entry points from `src/components/dashboard`, `src/components/staff`, `src/components/rota`, `src/components/attendance`, `src/components/payroll`, `src/components/kiosk` and `src/components/settings`. The current `src/components/app/prototype-app.tsx` remains as a compatibility surface while the feature modules are extracted incrementally.

Business logic remains in `src/lib`, including calculations, exports, date handling, repository migration and local persistence helpers. UI components should continue to call the repository layer rather than using localStorage directly.

## Demo Clock and Scenarios

Settings includes a development-only `Demo today` field. Dashboard, rota defaults, attendance periods, payroll periods and kiosk date handling use the central app clock in `src/lib/dates/app-clock.ts`.

In development, Settings also shows scenario controls for creating clean attendance, missing clock-outs, late arrivals, early departures, overtime, paid holiday, unpaid sickness and paid training examples. Scenario records use `scenario-` IDs so they can be removed without deleting unrelated demo records.

## Security and Production Readiness

The prototype PIN service is deliberately isolated in `src/lib/pin/service.ts`. It uses a clearly marked non-production representation so the UI workflow can be tested locally.

Before production use, add:

- Supabase database tables and migrations.
- Real authentication and role checks.
- Row Level Security policies.
- Server-side secure PIN hashing.
- Rate limiting and audit logging.
- Server timestamps for clock events.
- Backups and operational monitoring.

Never store production PINs in plain text.

## Money and Rounding

Money is represented as integer pence. Hourly pay is calculated as:

`approved minutes / 60 * hourly rate pence`

The result is rounded to the nearest penny using `Math.round`.

## Brand Asset

The prototype uses the public nursery flower/header image copied into `public/brand/jan-logo.png` as visual brand inspiration. If a final production asset is supplied, replace that file and keep the same dimensions or update `src/components/ui/brand.tsx`.

## Project Commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Deliberate Limitations

- No production authentication.
- No Supabase connection yet.
- No payroll tax, pensions, payslips or HMRC submissions.
- No child records or staff-to-child ratio calculations.
- No email, SMS, biometrics, GPS or external integrations.

## XLSX Dependency Risk

The prototype uses `xlsx` for browser-only workbook export.

- Package: `xlsx`
- Installed version: `0.18.5`
- Audit severity: high
- Advisory summary: prototype pollution and ReDoS advisories in SheetJS versions published to npm
- Fixed npm version: none available in the npm advisory data
- Current use: generating local workbooks from trusted in-app demo data, not parsing uploaded spreadsheets
- Browser impact: lower than server-side untrusted parsing, but still a production-readiness concern
- Alternative: evaluate maintained spreadsheet writers such as ExcelJS before production

Recommendation: keep `xlsx` for this local prototype, do not accept untrusted spreadsheet input, and replace or re-evaluate before production.

`npm audit` also reports a moderate PostCSS advisory through `next@16.2.7` using `postcss@8.4.31`. npm suggests `npm audit fix --force`, but that would install `next@9.3.3`, a breaking downgrade. Recommendation: do not force that change in this prototype; upgrade Next normally when a compatible patched release is available.
