# Jan Staff Project Rules

This is a nursery staff attendance and pay-preparation application for Jan Pre-School and Nursery.

## Permanent Rules

- Use UK date, time and currency formats.
- Use the Europe/London timezone.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Preserve original clock events.
- Manager corrections must be stored separately from original clock records.
- Do not silently overwrite historic hourly rates or salary values.
- Never expose salary or pay-rate information on the public clocking kiosk.
- Staff must not be able to edit their own attendance history.
- Keep touch targets large and accessible.
- Prioritise simple workflows for non-technical users.
- Avoid unnecessary dependencies and abstraction.
- Run lint, type checking and tests after significant changes.
- Do not claim a feature works until it has been tested.
- Do not delete demo functionality when adding a production database later.
- Do not use em dashes in user-facing application copy.

## Commands

- `npm run dev`: start the local development server.
- `npm run lint`: run ESLint.
- `npm run typecheck`: run TypeScript checks.
- `npm test`: run Vitest business-logic tests.
- `npm run build`: create a production build.

## Folder Conventions

- `src/app`: Next.js App Router routes.
- `src/components`: reusable layout, UI and feature components.
- `src/lib/demo-data`: seeded local prototype data.
- `src/lib/repositories`: repository abstraction and local persistence.
- `src/lib/calculations`: pure business calculations.
- `src/lib/validation`: Zod schemas.
- `src/lib/exports`: CSV export helpers.
- `src/types`: shared TypeScript domain types.
- `tests`: focused business logic tests.

## Definition of Done

- The requested workflow works locally with realistic demo data.
- Original clock events remain immutable and adjustments are separate.
- Pay preparation is clearly labelled as estimated or manager-entered.
- Kiosk screens do not expose pay or private manager information.
- Lint, typecheck, tests and build have been run and fixed where possible.
