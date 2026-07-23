# Staff lifecycle management design

## Purpose

Make the Staff section the single, intuitive place for managers to add, deactivate and reactivate staff members. Compliance will manage compliance information for existing staff rather than creating canonical staff profiles.

## Scope

This change covers:

- creating staff profiles from People > Staff;
- removing the create-staff form from People > Compliance;
- safely deactivating staff without deleting historic records;
- reactivating an inactive staff profile;
- disabling login and kiosk access when a staff member is deactivated;
- keeping login and kiosk re-enablement as separate, deliberate manager actions.

Permanent deletion of staff profiles and historic data is out of scope.

## Manager workflow

### Add a staff member

People > Staff will show an Add staff member panel above the search and staff list. The form will collect:

- full name, required;
- preferred name, optional and defaulted from the full name when omitted;
- role, required;
- main qualification level, optional;
- start date, optional;
- active status, selected by default.

Saving will use the existing manager-authorised staff-profile creation path. On success, the manager will be taken to the new staff record, where they can add compliance details if required.

People > Compliance will no longer show an Add staff member form.

### Deactivate a staff member

Every active staff card will offer a Deactivate staff member action. Selecting it will reveal a confirmation step explaining that:

- the staff member will be removed from active staff, rota and kiosk lists;
- their staff login will be disabled when an account exists;
- kiosk clocking will be disabled when kiosk settings exist;
- attendance, rota, pay, account-audit and compliance history will be retained.

The manager must explicitly confirm or cancel. The manager cannot deactivate the staff profile linked to the manager account currently in use.

After a successful deactivation, the staff member will disappear from the default active list. They remain visible when Include inactive staff is selected.

### Reactivate a staff member

Inactive staff cards will offer Reactivate staff member. Reactivation sets the canonical staff profile to active so the person can return to active staff workflows.

For security, reactivation will not automatically restore login or kiosk access. The manager must deliberately enable those through Accounts and Kiosk setup.

## Data integrity and security

Deactivation will be implemented as one manager-only database operation so the following changes succeed or fail together:

1. set `staff_profiles.active` to false;
2. set a linked `staff_accounts.active` to false and retain its audit history;
3. set linked `staff_kiosk_settings.kiosk_enabled` to false.

The database operation will record account deactivation through the existing account-access audit mechanism when an account exists. It will reject attempts to deactivate the profile connected to the manager account executing the operation.

Reactivation will set only `staff_profiles.active` to true. It will not modify linked account or kiosk status.

No attendance events, manager attendance corrections, rota records, pay arrangements, compliance records, account records or kiosk history will be deleted or overwritten.

## Components and actions

- The production Staff screen owns the create form and lifecycle controls.
- The production Compliance screen only displays and edits compliance records for existing staff.
- A focused server action validates manager access, invokes the atomic staff-deactivation database operation, refreshes affected routes and returns a plain-language result.
- A focused reactivation action validates manager access, reactivates the profile and refreshes affected routes.
- Demo mode keeps its existing add-staff capability and gains equivalent explicit deactivate/reactivate controls using local demo persistence, without deleting demo data.

## Error handling

- Full name and role remain required for creation.
- Creation errors appear beside the add form without losing entered values.
- Deactivation and reactivation failures appear within the relevant staff card.
- If coordinated deactivation cannot complete, none of the profile, account or kiosk status changes are committed.
- Messages use plain language and do not expose database details.

## Accessibility and copy

- Buttons and confirmation controls retain the application's large touch targets.
- The destructive-looking action uses the danger treatment but is labelled Deactivate staff member rather than Delete.
- The confirmation text states that history is preserved.
- Controls are keyboard accessible and do not depend on colour alone.
- User-facing copy uses UK terminology and contains no em dashes.

## Verification

Automated coverage will verify:

- the Staff production screen contains the add-staff form;
- the Compliance production screen no longer contains it;
- only managers can invoke lifecycle actions;
- deactivation updates the profile, account and kiosk settings together;
- deactivation preserves related historic records;
- the current manager cannot deactivate their own linked profile;
- reactivation restores only the staff profile and leaves login and kiosk access disabled;
- inactive staff can be revealed and reactivated in the Staff screen;
- creation validation still requires full name and role.

The full lint, typecheck, Vitest and production build commands will be run before the feature is reported complete.
