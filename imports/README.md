# Staff Compliance Imports

Use `staff-compliance-template.csv` as the non-sensitive format reference.

Place real imports in `private-imports/` using one of these ignored file names:

- `private-imports/staff-compliance.private.csv`
- `private-imports/staff-compliance.private.json`
- `private-imports/staff-compliance.private.sql`

Do not commit real dates of birth, DBS numbers, identity-document details, medical notes, reference details or evidence files.

Recommended review statuses:

- `imported_successfully`
- `imported_with_warning`
- `skipped_invalid_data`
- `duplicate_suspected`
- `missing_required_information`

Known source-document review cases to flag manually before import:

- Appointment date written as `31/04/22`
- DBS date that appears to match a date of birth
- Potentially reversed appointment-date and DOB fields
- Qualification dated in the future that may be an expected completion date
- Missing or unclear expiry dates
- Inconsistent course-title formatting

Create staff profiles first. Add emails and Supabase Auth user links later through account management.
