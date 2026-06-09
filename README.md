# Jan Staff

Rota, Attendance and Pay Preparation for Jan Pre-School and Nursery.

This is a local prototype. It replaces the paper weekly rota and sign-in sheet with a manager-controlled rota, shared staff clocking kiosk, attendance review, pay-preparation estimates and CSV exports.

It is not a payroll system. It does not calculate PAYE, National Insurance, pensions, statutory pay, deductions, payslips or HMRC submissions.

## Local Setup

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

Demo manager credentials:

- Email: `manager@janpreschool.local`
- Password: `JanDemo123!`

## Main Routes

- `/login`: development-only manager login.
- `/dashboard`: operational summary.
- `/staff`: staff directory, add staff and edit staff.
- `/rota`: weekly rota editor.
- `/clock`: public kiosk for staff PIN clocking.
- `/attendance`: manager review and correction.
- `/payroll`: pay-preparation summaries and CSV export.
- `/settings`: prototype settings and demo data reset.

## Demo Data and Persistence

The app uses seeded fictional demo data and browser localStorage. Changes survive refreshes in the same browser. Use Settings, then `Reset and reseed demo data`, to restore the seed records.

The data layer lives behind a repository abstraction in `src/lib/repositories/demo-store.tsx` so Supabase can replace the local implementation later without spreading storage code through UI components.

Current local data schema version: `4`.

Version 3 migrated earlier demo records by:

- Repairing legacy contracted weekly hour values that were stored as hours instead of minutes.
- Backfilling attendance approval records.
- Backfilling holiday, sickness and training pay-treatment fields.
- Adding attendance pagination, bulk approval and pay-adjustment settings.

Version 4 adds approval audit metadata and development date/scenario settings. It preserves existing clock events, adjustments and approvals, and backfills older approvals with demo manager audit fields.

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
