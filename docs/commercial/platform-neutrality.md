# Core platform neutrality

This document records the implementation boundary for Workstream 1.5. It does not replace or revise the approved commercial architecture specifications.

## Neutral core

The core platform uses organisation, site, staff, attendance, shift, leave, kiosk, work area, compliance, qualification, credential, document and requirement terminology. Product branding and customer display names come from environment configuration. No final commercial product name is selected by this workstream.

The presentation profile is selected with `NEXT_PUBLIC_INDUSTRY_PROFILE`. The supported values are `nursery`, `care_home`, `tuition_centre` and `clinic`. A profile provides work-area terminology, example roles and work areas, demo content, help context and a default compliance pack. Nursery is the explicit compatibility fallback for inherited Jan data.

## Work areas

`work_area`, `available_work_areas` and `operational_context` are the canonical database fields. The additive neutralisation migration backfills them from the legacy room and nursery-context fields. Compatibility triggers synchronise old and new fields so a staged application rollout does not lose values. Application DTOs prefer canonical values and retain deprecated aliases where existing callers require them.

Display wording is profile-specific:

- Nursery: Room
- Care home: Unit
- Tuition centre: Classroom
- Clinic: Department

## Compliance packs

The platform calculates generic requirement gaps from the active compliance pack. The initial packs are Early Years UK, Care UK, Education Safeguarding UK and Clinical UK. DBS, safeguarding, central-record tracking and paediatric first aid remain available but are requirements of selected packs rather than universal core assumptions.

This milestone does not redesign the existing compliance storage schema. Further pack-specific forms and record types may be added only in a later scoped workstream.

## Browser compatibility

Canonical local storage keys, the kiosk device cookie, IndexedDB database, service-worker cache and background-sync tag now use neutral identifiers. Readers accept the complete previous Jan identifier set and copy stored values to the canonical key without deleting the legacy value. The offline IndexedDB migration copies all compatible stores into the neutral database and preserves the old database. The service worker removes only obsolete shell caches; attendance evidence is not stored in those caches.

## Exports and service identity

New export filenames use the configured site slug and export type. Workbook creators, subjects and information sheets use configured product, organisation and site names. Health and readiness responses expose `PLATFORM_SERVICE_IDENTIFIER`, which defaults to `workforce-platform`.

## Intentionally retained compatibility names

The following nursery-specific names remain intentionally:

- Legacy browser keys, cookie names, database names and background-sync tags needed to recover existing client data.
- Legacy database columns and trigger backfills needed for a non-breaking rollout.
- Deprecated TypeScript aliases used by existing callers and fixtures.
- Nursery demo/profile content and Early Years compliance requirements, isolated in their profile and pack modules.
- Jan operational and offline hardware documents that describe the existing customer deployment rather than the commercial core.
- Historical migration files, which are immutable.

Tenant primitives, organisation and site records, memberships, billing, onboarding and attendance tenancy migration remain out of scope until Workstream 2.
