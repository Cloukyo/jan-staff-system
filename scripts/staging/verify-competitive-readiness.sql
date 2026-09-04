begin;

create temporary table competitive_readiness_context as
select profile.organisation_id, profile.id as staff_id, membership.id as membership_id, membership.auth_user_id
from public.staff_profiles profile
join public.organisation_memberships membership
  on membership.organisation_id=profile.organisation_id and membership.status='active'
where profile.organisation_id is not null
order by membership.joined_at nulls last, membership.invited_at
limit 1;
grant select on competitive_readiness_context to authenticated;

do $$
begin
  if (select count(*) from competitive_readiness_context)<>1 then
    raise exception 'staging_fixture_context_missing';
  end if;
end $$;

select set_config('request.jwt.claim.sub',(select auth_user_id::text from competitive_readiness_context),true);

update public.staff_profiles profile
set active=true, engagement_type='employee', appointment_date=date '2026-09-01'
from competitive_readiness_context context
where profile.organisation_id=context.organisation_id and profile.id=context.staff_id;

insert into public.staff_central_records(
  organisation_id,staff_id,dbs_recorded,dbs_requirement,dbs_check_level,dbs_status,
  dbs_certificate_received_date,dbs_reference_encrypted,dbs_verified_at,dbs_verified_by_membership_id,
  suitability_declaration,suitability_status,suitability_decided_at,suitability_decided_by_membership_id,
  start_authorised_at,start_authorised_by_membership_id,checked_by_membership_id,checked_at
)
select organisation_id,staff_id,true,'required','enhanced_childrens_barred_list','verified',
  date '2026-09-01','v1:AA:BB:CC',now(),membership_id,true,'suitable',now(),membership_id,
  now(),membership_id,membership_id,now()
from competitive_readiness_context
on conflict(staff_id) do update set
  dbs_recorded=true,dbs_requirement='required',dbs_check_level='enhanced_childrens_barred_list',dbs_status='verified',
  dbs_certificate_received_date=date '2026-09-01',dbs_reference_encrypted='v1:AA:BB:CC',
  dbs_verified_at=excluded.dbs_verified_at,dbs_verified_by_membership_id=excluded.dbs_verified_by_membership_id,
  volunteer_exception=null,suitability_declaration=true,suitability_status='suitable',
  suitability_decided_at=excluded.suitability_decided_at,suitability_decided_by_membership_id=excluded.suitability_decided_by_membership_id,
  start_authorised_at=excluded.start_authorised_at,start_authorised_by_membership_id=excluded.start_authorised_by_membership_id,
  checked_by_membership_id=excluded.checked_by_membership_id,checked_at=excluded.checked_at;

do $$
declare context competitive_readiness_context%rowtype;
declare audit_before integer;
declare audit_after integer;
declare verified_at_before timestamptz;
declare leave_id uuid;
begin
  select * into strict context from competitive_readiness_context;

  -- A: a complete employee record is operationally ready and can enable kiosk access.
  if not private.staff_may_begin_work(context.organisation_id,context.staff_id,date '2026-09-10') then
    raise exception 'case_a_verified_employee_not_ready';
  end if;
  insert into public.staff_kiosk_settings(staff_id,kiosk_enabled,pin_reset_required,onboarding_attendance_eligible)
  values(context.staff_id,false,true,false)
  on conflict(staff_id) do update set kiosk_enabled=false;
  update public.staff_kiosk_settings set kiosk_enabled=true where staff_id=context.staff_id;

  -- B: ordinary edits preserve verification time; only real recruitment-state changes create events.
  select dbs_verified_at into verified_at_before from public.staff_central_records where staff_id=context.staff_id;
  select count(*) into audit_before from public.staff_suitability_events where organisation_id=context.organisation_id and staff_id=context.staff_id;
  update public.staff_central_records set notes='Synthetic rolled-back verification' where staff_id=context.staff_id;
  select count(*) into audit_after from public.staff_suitability_events where organisation_id=context.organisation_id and staff_id=context.staff_id;
  if audit_after<>audit_before or (select dbs_verified_at from public.staff_central_records where staff_id=context.staff_id) is distinct from verified_at_before then
    raise exception 'case_b_non_state_edit_changed_verification_evidence';
  end if;
  update public.staff_central_records set dbs_application_date=date '2026-08-20' where staff_id=context.staff_id;
  if (select count(*) from public.staff_suitability_events where organisation_id=context.organisation_id and staff_id=context.staff_id)<>audit_before+1 then
    raise exception 'case_b_successful_state_change_not_audited';
  end if;
  begin
    update public.staff_central_records set dbs_reference_encrypted=null where staff_id=context.staff_id;
    raise exception 'case_b_invalid_state_was_accepted';
  exception when check_violation then null;
  end;
  if (select count(*) from public.staff_suitability_events where organisation_id=context.organisation_id and staff_id=context.staff_id)<>audit_before+1 then
    raise exception 'case_b_failed_change_created_audit';
  end if;

  -- C: an incomplete required check blocks readiness and the authoritative kiosk transition.
  update public.staff_kiosk_settings set kiosk_enabled=false where staff_id=context.staff_id;
  update public.staff_central_records set dbs_status='application_submitted',dbs_certificate_received_date=null,
    dbs_reference_encrypted=null,dbs_verified_at=null,dbs_verified_by_membership_id=null,
    suitability_declaration=false,suitability_status='not_assessed',suitability_decided_at=null,
    suitability_decided_by_membership_id=null,start_authorised_at=null,start_authorised_by_membership_id=null
  where staff_id=context.staff_id;
  if private.staff_may_begin_work(context.organisation_id,context.staff_id,date '2026-09-10') then
    raise exception 'case_c_incomplete_check_reported_ready';
  end if;
  begin
    update public.staff_kiosk_settings set kiosk_enabled=true where staff_id=context.staff_id;
    raise exception 'case_c_guard_did_not_block';
  exception when others then
    if position('staff_not_authorised_to_begin_work' in sqlerrm)=0 then raise; end if;
  end;

  -- D: only the explicit supervised occasional-volunteer exception follows the no-check route.
  update public.staff_profiles set engagement_type='volunteer' where organisation_id=context.organisation_id and id=context.staff_id;
  update public.staff_central_records set dbs_requirement='not_required',dbs_check_level=null,dbs_status='not_required',
    volunteer_exception='occasional_supervised',suitability_declaration=true,suitability_status='suitable',
    suitability_decided_at=now(),suitability_decided_by_membership_id=context.membership_id,
    start_authorised_at=now(),start_authorised_by_membership_id=context.membership_id
  where staff_id=context.staff_id;
  if not private.staff_may_begin_work(context.organisation_id,context.staff_id,date '2026-09-10') then
    raise exception 'case_d_documented_exception_not_ready';
  end if;

  -- F: statutory annual-leave evidence cannot be deleted before six years.
  insert into public.leave_requests(organisation_id,staff_id,leave_type,start_date,end_date,requested_minutes,status,
    requested_by_membership_id,reviewed_by_membership_id,reviewed_at)
  values(context.organisation_id,context.staff_id,'annual_leave',date '2026-09-14',date '2026-09-14',480,'approved',
    context.membership_id,context.membership_id,now()) returning id into leave_id;
  if (select retained_until from public.leave_requests where id=leave_id) is null then
    raise exception 'case_f_retention_date_missing';
  end if;
  begin
    delete from public.leave_requests where id=leave_id;
    raise exception 'case_f_retained_record_was_deleted';
  exception when others then
    if position('statutory_retention_active' in sqlerrm)=0 then raise; end if;
  end;
end $$;

-- E and G: authorised tenant access works, while an unrelated Auth identity sees no evidence.
set local role authenticated;
select set_config('request.jwt.claim.sub',(select auth_user_id::text from competitive_readiness_context),true);
insert into public.compliance_evidence_export_audits(organisation_id,exported_by_membership_id,file_name,digest,row_count)
select organisation_id,membership_id,'synthetic-rolled-back.xlsx',repeat('a',64),1 from competitive_readiness_context;
do $$
begin
  if not exists(select 1 from public.staff_suitability_events) or not exists(select 1 from public.compliance_evidence_export_audits) then
    raise exception 'case_g_authorised_evidence_or_audit_not_visible';
  end if;
end $$;
select set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
do $$
begin
  if exists(select 1 from public.staff_suitability_events)
    or exists(select 1 from public.compliance_evidence_export_audits)
    or exists(select 1 from public.holiday_pay_records) then
    raise exception 'case_e_cross_tenant_evidence_visible';
  end if;
end $$;
reset role;

rollback;
select 'Cases A-G passed and all synthetic changes were rolled back.' as result;
