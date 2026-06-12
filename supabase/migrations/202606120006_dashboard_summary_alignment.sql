alter function public.get_manager_dashboard_summary(date)
rename to get_manager_dashboard_summary_base;

revoke all on function public.get_manager_dashboard_summary_base(date) from public, anon, authenticated;

create or replace function public.get_manager_dashboard_summary(reference_date date default null)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  manager_account public.staff_accounts;
  dashboard_date date := coalesce(reference_date, (now() at time zone 'Europe/London')::date);
  result jsonb;
  incomplete_count integer;
  missing_pay_count integer;
begin
  manager_account := public.current_staff_account();
  if manager_account.id is null or manager_account.role <> 'manager' then
    raise exception 'Manager access required';
  end if;

  result := public.get_manager_dashboard_summary_base(dashboard_date);

  with active_staff as (
    select id
    from public.staff_profiles
    where active = true
  ),
  item_status as (
    select
      staff.id as staff_id,
      count(items.id)::integer as item_count,
      count(items.id) filter (where items.status in ('complete', 'not_applicable'))::integer as completed_count
    from active_staff staff
    left join public.staff_central_record_items items on items.staff_id = staff.id
    group by staff.id
  ),
  legacy_status as (
    select
      staff.id as staff_id,
      (
        coalesce(record.appointment_induction_completed, false)::integer +
        coalesce(record.contract_form, false)::integer +
        coalesce(record.id_checked, false)::integer +
        coalesce(record.address_evidence_checked, false)::integer +
        coalesce(record.additional_employment_tax_evidence_checked, false)::integer +
        coalesce(record.dbs_recorded, false)::integer +
        coalesce(record.references_complete, false)::integer +
        coalesce(record.starter_form, false)::integer +
        coalesce(record.suitability_declaration, false)::integer +
        coalesce(record.medical_declaration, false)::integer +
        coalesce(record.employee_information_form, false)::integer
      ) as completed_count
    from active_staff staff
    left join public.staff_central_records record on record.staff_id = staff.id
  )
  select count(*) into incomplete_count
  from item_status items
  join legacy_status legacy on legacy.staff_id = items.staff_id
  where case
    when items.item_count > 0 then items.item_count < 12 or items.completed_count < 12
    else legacy.completed_count < 11
  end;

  select count(*) into missing_pay_count
  from public.staff_profiles staff
  where staff.active = true
    and not exists (
      select 1
      from public.staff_accounts account
      where account.staff_id = staff.id
        and account.active = true
        and account.role = 'manager'
    )
    and not exists (
      select 1
      from public.staff_pay_arrangements arrangement
      where arrangement.staff_id = staff.id
        and arrangement.is_active = true
        and arrangement.effective_from <= dashboard_date
        and (arrangement.effective_to is null or arrangement.effective_to >= dashboard_date)
    );

  return result || jsonb_build_object(
    'incomplete_central_records', incomplete_count,
    'staff_missing_pay_arrangement', missing_pay_count
  );
end;
$$;

revoke all on function public.get_manager_dashboard_summary(date) from public, anon, authenticated;
grant execute on function public.get_manager_dashboard_summary(date) to authenticated;
