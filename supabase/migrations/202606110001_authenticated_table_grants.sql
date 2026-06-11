grant usage on schema public to authenticated;

grant select, insert, update on table
  public.staff_accounts,
  public.leave_requests,
  public.staff_profiles,
  public.staff_qualifications,
  public.staff_certificates,
  public.staff_central_records,
  public.staff_central_record_items,
  public.staff_reference_checks,
  public.staff_import_reviews
to authenticated;

grant select on table public.staff_compliance_summary to authenticated;
