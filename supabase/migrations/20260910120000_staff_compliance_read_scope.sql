-- Align read-only Staff/Compliance access with the existing commercial capability matrix.
-- Write policies remain unchanged and continue to require compliance.manage.

create policy staff_central_records_commercial_read
on public.staff_central_records for select to authenticated
using (
  organisation_id is not null
  and private.can_access_staff(organisation_id, staff_id, 'compliance.read')
);

create policy staff_central_record_items_commercial_read
on public.staff_central_record_items for select to authenticated
using (
  organisation_id is not null
  and private.can_access_staff(organisation_id, staff_id, 'compliance.read')
);

create policy staff_reference_checks_commercial_read
on public.staff_reference_checks for select to authenticated
using (
  organisation_id is not null
  and private.can_access_staff(organisation_id, staff_id, 'compliance.read')
);
