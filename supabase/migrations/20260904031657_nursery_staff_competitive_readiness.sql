-- Commercial competitive-readiness foundation for nursery staff operations.
-- This migration does not alter attendance evidence, payable-minute calculations,
-- payroll revisions, approvals, exports or legacy Jan rows.

create type public.staff_engagement_type as enum ('employee', 'volunteer');
create type public.dbs_requirement_status as enum ('assessment_needed', 'required', 'not_required');
create type public.dbs_check_level as enum ('enhanced_childrens_barred_list', 'enhanced', 'other');
create type public.dbs_lifecycle_status as enum ('not_started', 'application_submitted', 'certificate_received', 'verified', 'renewal_required', 'not_required', 'legacy_recorded');
create type public.staff_suitability_status as enum ('not_assessed', 'suitable', 'suitable_with_restrictions', 'not_suitable');
create type public.volunteer_dbs_exception as enum ('occasional_supervised');

alter table public.staff_profiles
  add column engagement_type public.staff_engagement_type not null default 'employee';

alter table public.staff_central_records
  add column dbs_requirement public.dbs_requirement_status not null default 'assessment_needed',
  add column dbs_check_level public.dbs_check_level,
  add column dbs_status public.dbs_lifecycle_status not null default 'not_started',
  add column dbs_application_date date,
  add column dbs_certificate_received_date date,
  add column dbs_reference_encrypted text,
  add column dbs_verified_at timestamptz,
  add column dbs_verified_by_membership_id uuid,
  add column volunteer_exception public.volunteer_dbs_exception,
  add column suitability_status public.staff_suitability_status not null default 'not_assessed',
  add column suitability_decided_at timestamptz,
  add column suitability_decided_by_membership_id uuid,
  add column start_authorised_at timestamptz,
  add column start_authorised_by_membership_id uuid,
  add constraint staff_central_records_dbs_reference_ciphertext check (
    dbs_reference_encrypted is null or dbs_reference_encrypted ~ '^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$'
  ),
  add constraint staff_central_records_dbs_requirement_consistency check (
    (dbs_requirement = 'required' and volunteer_exception is null)
    or (dbs_requirement = 'not_required' and volunteer_exception = 'occasional_supervised')
    or (dbs_requirement = 'assessment_needed' and volunteer_exception is null)
  ),
  add constraint staff_central_records_dbs_verified_consistency check (
    dbs_status <> 'verified'
    or (dbs_requirement = 'required' and dbs_check_level = 'enhanced_childrens_barred_list'
      and dbs_certificate_received_date is not null and dbs_reference_encrypted is not null
      and dbs_verified_at is not null and dbs_verified_by_membership_id is not null)
  ),
  add constraint staff_central_records_suitability_consistency check (
    suitability_status = 'not_assessed'
    or (suitability_decided_at is not null and suitability_decided_by_membership_id is not null)
  ),
  add constraint staff_central_records_start_authority_consistency check (
    start_authorised_at is null or start_authorised_by_membership_id is not null
  );

alter table public.staff_central_records
  add foreign key (organisation_id, dbs_verified_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add foreign key (organisation_id, suitability_decided_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict,
  add foreign key (organisation_id, start_authorised_by_membership_id)
    references public.organisation_memberships(organisation_id, id) on delete restrict;

-- Preserve operational compatibility without presenting old partial evidence as newly verified.
update public.staff_central_records record
set dbs_requirement = 'required',
    dbs_check_level = 'enhanced_childrens_barred_list',
    dbs_status = 'legacy_recorded',
    dbs_certificate_received_date = coalesce(record.dbs_issue_date, record.dbs_last_checked_at),
    suitability_status = case when record.suitability_declaration and record.checked_by_membership_id is not null
      then 'suitable'::public.staff_suitability_status else 'not_assessed'::public.staff_suitability_status end,
    suitability_decided_at = case when record.suitability_declaration and record.checked_by_membership_id is not null then coalesce(record.checked_at, record.updated_at) else null end,
    suitability_decided_by_membership_id = case when record.suitability_declaration and record.checked_by_membership_id is not null then record.checked_by_membership_id else null end,
    start_authorised_at = case when record.suitability_declaration and record.checked_by_membership_id is not null and profile.appointment_date < date '2026-09-01' then coalesce(record.checked_at, record.updated_at) else null end,
    start_authorised_by_membership_id = case when record.suitability_declaration and record.checked_by_membership_id is not null and profile.appointment_date < date '2026-09-01' then record.checked_by_membership_id else null end
from public.staff_profiles profile
where profile.id = record.staff_id and profile.organisation_id = record.organisation_id
  and record.organisation_id is not null and record.dbs_recorded;

create table public.staff_suitability_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  staff_id text not null,
  event_type text not null check (event_type in ('recruitment_state_created', 'recruitment_state_changed')),
  previous_state jsonb,
  new_state jsonb not null,
  recorded_by_membership_id uuid not null,
  recorded_at timestamptz not null default now(),
  unique (organisation_id, id),
  foreign key (organisation_id, staff_id) references public.staff_profiles(organisation_id, id) on delete restrict,
  foreign key (organisation_id, recorded_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);

alter table public.staff_suitability_events enable row level security;
create policy staff_suitability_events_read on public.staff_suitability_events for select to authenticated
  using (private.has_permission(organisation_id, 'compliance.manage'));
revoke all on public.staff_suitability_events from anon;
revoke all on public.staff_suitability_events from authenticated;
grant select on public.staff_suitability_events to authenticated;

create or replace function private.record_staff_suitability_event()
returns trigger language plpgsql security definer set search_path = '' as $$
declare actor_id uuid;
declare previous jsonb;
declare current_state jsonb;
begin
  if new.organisation_id is null then return new; end if;
  actor_id := private.current_membership_id(new.organisation_id);
  if actor_id is null then raise exception 'staff_suitability_actor_required'; end if;
  current_state := jsonb_build_object(
    'engagementType', (select engagement_type from public.staff_profiles where id=new.staff_id),
    'dbsRequirement', new.dbs_requirement, 'dbsCheckLevel', new.dbs_check_level,
    'dbsStatus', new.dbs_status, 'dbsApplicationDate', new.dbs_application_date,
    'dbsCertificateReceivedDate', new.dbs_certificate_received_date,
    'dbsReferenceRecorded', new.dbs_reference_encrypted is not null,
    'dbsVerifiedAt', new.dbs_verified_at, 'volunteerException', new.volunteer_exception,
    'suitabilityStatus', new.suitability_status, 'suitabilityDecidedAt', new.suitability_decided_at,
    'startAuthorisedAt', new.start_authorised_at
  );
  if tg_op = 'UPDATE' then
    previous := jsonb_build_object(
      'dbsRequirement', old.dbs_requirement, 'dbsCheckLevel', old.dbs_check_level,
      'dbsStatus', old.dbs_status, 'dbsApplicationDate', old.dbs_application_date,
      'dbsCertificateReceivedDate', old.dbs_certificate_received_date,
      'dbsReferenceRecorded', old.dbs_reference_encrypted is not null,
      'dbsVerifiedAt', old.dbs_verified_at, 'volunteerException', old.volunteer_exception,
      'suitabilityStatus', old.suitability_status, 'suitabilityDecidedAt', old.suitability_decided_at,
      'startAuthorisedAt', old.start_authorised_at
    );
    if previous = current_state - 'engagementType' then return new; end if;
  end if;
  insert into public.staff_suitability_events(organisation_id, staff_id, event_type, previous_state, new_state, recorded_by_membership_id)
  values(new.organisation_id, new.staff_id, case when tg_op='INSERT' then 'recruitment_state_created' else 'recruitment_state_changed' end, previous, current_state, actor_id);
  return new;
end $$;
revoke all on function private.record_staff_suitability_event() from public, anon, authenticated;
create trigger staff_central_records_suitability_audit
after insert or update of dbs_requirement, dbs_check_level, dbs_status, dbs_application_date,
  dbs_certificate_received_date, dbs_reference_encrypted, dbs_verified_at, volunteer_exception,
  suitability_status, suitability_decided_at, start_authorised_at
on public.staff_central_records for each row execute function private.record_staff_suitability_event();

create or replace function private.staff_may_begin_work(target_organisation_id uuid, target_staff_id text, target_date date)
returns boolean language sql stable security invoker set search_path = '' as $$
  select exists(
    select 1 from public.staff_profiles profile
    join public.staff_central_records record on record.organisation_id=profile.organisation_id and record.staff_id=profile.id
    where profile.organisation_id=target_organisation_id and profile.id=target_staff_id and profile.active
      and (profile.appointment_date is null or target_date >= profile.appointment_date)
      and record.suitability_status in ('suitable','suitable_with_restrictions')
      and record.start_authorised_at is not null
      and (
        (record.dbs_requirement='required' and record.dbs_status='verified'
          and record.dbs_check_level='enhanced_childrens_barred_list'
          and record.dbs_certificate_received_date is not null and record.dbs_reference_encrypted is not null)
        or (record.dbs_requirement='required' and record.dbs_status='legacy_recorded'
          and profile.appointment_date < date '2026-09-01' and record.dbs_recorded)
        or (record.dbs_requirement='not_required' and profile.engagement_type='volunteer'
          and record.dbs_status='not_required' and record.volunteer_exception='occasional_supervised')
      )
  )
$$;
revoke all on function private.staff_may_begin_work(uuid,text,date) from public, anon, authenticated;
grant execute on function private.staff_may_begin_work(uuid,text,date) to authenticated;

create or replace function private.guard_staff_operational_start()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org_id uuid;
declare staff_value text;
declare work_date date;
begin
  if tg_table_name='rota_shifts' then
    if new.organisation_id is null or new.archived_at is not null or new.status='cancelled' then return new; end if;
    org_id:=new.organisation_id; staff_value:=new.staff_id; work_date:=new.shift_date;
  else
    if not new.kiosk_enabled then return new; end if;
    select organisation_id into org_id from public.staff_profiles where id=new.staff_id;
    if org_id is null then return new; end if;
    staff_value:=new.staff_id; work_date:=current_date;
  end if;
  if not private.staff_may_begin_work(org_id,staff_value,work_date) then raise exception 'staff_not_authorised_to_begin_work'; end if;
  return new;
end $$;
revoke all on function private.guard_staff_operational_start() from public, anon, authenticated;
create trigger rota_shift_staff_start_guard before insert or update of staff_id,shift_date,status,archived_at
on public.rota_shifts for each row execute function private.guard_staff_operational_start();
create trigger kiosk_staff_start_guard before insert or update of kiosk_enabled
on public.staff_kiosk_settings for each row execute function private.guard_staff_operational_start();

create table public.record_retention_holds (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  record_category text not null check (record_category in ('annual_leave','holiday_pay','payroll_evidence')),
  record_id uuid not null, reason text not null check (length(btrim(reason)) between 5 and 2000),
  held_by_membership_id uuid not null, held_at timestamptz not null default now(),
  released_by_membership_id uuid, released_at timestamptz,
  foreign key (organisation_id, held_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict,
  foreign key (organisation_id, released_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict,
  check ((released_at is null and released_by_membership_id is null) or (released_at is not null and released_by_membership_id is not null))
);

create table public.holiday_pay_records (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  staff_id text not null, leave_request_id uuid, payroll_period_id uuid,
  leave_minutes integer not null check (leave_minutes > 0), amount_paid_pence bigint not null check (amount_paid_pence >= 0),
  paid_on date not null, currency_code text not null default 'GBP' check (currency_code='GBP'),
  evidence_note text not null check (length(btrim(evidence_note)) between 5 and 2000),
  supersedes_record_id uuid, voided_at timestamptz, created_by_membership_id uuid not null,
  created_at timestamptz not null default now(), retained_until timestamptz,
  unique (organisation_id,id),
  foreign key (organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete restrict,
  foreign key (organisation_id,leave_request_id) references public.leave_requests(organisation_id,id) on delete restrict,
  foreign key (organisation_id,payroll_period_id) references public.payroll_periods(organisation_id,id) on delete restrict,
  foreign key (organisation_id,supersedes_record_id) references public.holiday_pay_records(organisation_id,id) on delete restrict,
  foreign key (organisation_id,created_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict,
  check (leave_request_id is not null or payroll_period_id is not null)
);

alter table public.leave_requests add column retained_until timestamptz;
alter table public.payroll_periods add column retained_until timestamptz;

create or replace function private.set_statutory_retention_until()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.created_at at time zone 'Europe/London')::date >= date '2026-04-06' then
    new.retained_until:=greatest(coalesce(new.retained_until,new.created_at),new.created_at+interval '6 years');
  end if;
  return new;
end $$;
create trigger leave_request_retention before insert or update of created_at,retained_until on public.leave_requests
for each row execute function private.set_statutory_retention_until();
create trigger payroll_period_retention before insert or update of created_at,retained_until on public.payroll_periods
for each row execute function private.set_statutory_retention_until();
create trigger holiday_pay_record_retention before insert or update of created_at,retained_until on public.holiday_pay_records
for each row execute function private.set_statutory_retention_until();
update public.leave_requests set retained_until=created_at+interval '6 years' where (created_at at time zone 'Europe/London')::date>=date '2026-04-06';
update public.payroll_periods set retained_until=created_at+interval '6 years' where (created_at at time zone 'Europe/London')::date>=date '2026-04-06';

create or replace function private.prevent_retained_record_deletion()
returns trigger language plpgsql security definer set search_path = '' as $$
declare org_id uuid; declare retention_value timestamptz; declare record_value uuid;
begin
  org_id:=nullif(to_jsonb(old)->>'organisation_id','')::uuid;
  record_value:=(to_jsonb(old)->>'id')::uuid;
  retention_value:=nullif(to_jsonb(old)->>'retained_until','')::timestamptz;
  if retention_value is not null and retention_value>now() then raise exception 'statutory_retention_active'; end if;
  if org_id is not null and exists(select 1 from public.record_retention_holds hold_value
    where hold_value.organisation_id=org_id and hold_value.record_category=tg_argv[0]
      and hold_value.record_id=record_value and hold_value.released_at is null) then
    raise exception 'record_retention_hold_active';
  end if;
  return old;
end $$;
revoke all on function private.prevent_retained_record_deletion() from public, anon, authenticated;
create trigger retained_leave_request before delete on public.leave_requests for each row execute function private.prevent_retained_record_deletion('annual_leave');
create trigger retained_payroll_period before delete on public.payroll_periods for each row execute function private.prevent_retained_record_deletion('payroll_evidence');
create trigger retained_holiday_pay_record before delete on public.holiday_pay_records for each row execute function private.prevent_retained_record_deletion('holiday_pay');

alter table public.record_retention_holds enable row level security;
alter table public.holiday_pay_records enable row level security;
create policy record_retention_holds_manage on public.record_retention_holds for all to authenticated
  using (private.has_permission(organisation_id,'organisation.manage'))
  with check (private.has_permission(organisation_id,'organisation.manage'));
create policy holiday_pay_records_read on public.holiday_pay_records for select to authenticated
  using (private.has_permission(organisation_id,'payroll.read'));
create policy holiday_pay_records_manage on public.holiday_pay_records for insert to authenticated
  with check (private.has_permission(organisation_id,'payroll.prepare'));
revoke all on public.record_retention_holds, public.holiday_pay_records from anon;
grant select,insert,update on public.record_retention_holds to authenticated;
grant select,insert on public.holiday_pay_records to authenticated;

create table public.compliance_evidence_export_audits (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  exported_by_membership_id uuid not null, file_name text not null, digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  row_count integer not null check (row_count>=0), exported_at timestamptz not null default now(),
  foreign key (organisation_id,exported_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict
);
alter table public.compliance_evidence_export_audits enable row level security;
create policy compliance_evidence_export_audits_read on public.compliance_evidence_export_audits for select to authenticated
  using (private.has_permission(organisation_id,'compliance.manage'));
create policy compliance_evidence_export_audits_insert on public.compliance_evidence_export_audits for insert to authenticated
  with check (private.has_permission(organisation_id,'compliance.manage'));
revoke all on public.compliance_evidence_export_audits from anon;
grant select,insert on public.compliance_evidence_export_audits to authenticated;

create table public.holiday_pay_evidence_export_audits (
  id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete restrict,
  exported_by_membership_id uuid not null, file_name text not null, digest text not null check (digest ~ '^[a-f0-9]{64}$'),
  row_count integer not null check (row_count>=0), exported_at timestamptz not null default now(),
  foreign key (organisation_id,exported_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict
);
alter table public.holiday_pay_evidence_export_audits enable row level security;
create policy holiday_pay_evidence_export_audits_read on public.holiday_pay_evidence_export_audits for select to authenticated
  using (private.has_permission(organisation_id,'payroll.read'));
create policy holiday_pay_evidence_export_audits_insert on public.holiday_pay_evidence_export_audits for insert to authenticated
  with check (private.has_permission(organisation_id,'payroll.read'));
revoke all on public.holiday_pay_evidence_export_audits from anon;
grant select,insert on public.holiday_pay_evidence_export_audits to authenticated;

create or replace function public.attach_staff_import_recruitment_metadata(target_batch_id uuid, metadata jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare batch_row public.staff_import_batches%rowtype;
declare updated_count integer;
begin
  select * into batch_row from public.staff_import_batches
  where id=target_batch_id and committed_at is null and expires_at>now() for update;
  if batch_row.id is null or not private.has_site_permission(batch_row.organisation_id,batch_row.site_id,'staff.manage') then
    raise exception 'staff_import_batch_not_available';
  end if;
  if jsonb_typeof(metadata)<>'array' or jsonb_array_length(metadata)=0
    or exists(select 1 from jsonb_array_elements(metadata) item where
      coalesce(item->>'sourceRowNumber','')!~'^[0-9]+$'
      or item->>'engagementType' not in('employee','volunteer')
      or item->>'dbsRequirement' not in('assessment_needed','required'))
    or (select count(distinct item->>'sourceRowNumber') from jsonb_array_elements(metadata) item)<>jsonb_array_length(metadata) then
    raise exception 'invalid_recruitment_metadata';
  end if;
  update public.staff_import_rows target
  set normalised_data=target.normalised_data||jsonb_build_object(
    'engagementType',item->>'engagementType','dbsRequirement',item->>'dbsRequirement')
  from jsonb_array_elements(metadata) item
  where target.batch_id=target_batch_id and target.source_row_number=(item->>'sourceRowNumber')::integer;
  get diagnostics updated_count=row_count;
  if updated_count<>jsonb_array_length(metadata) then raise exception 'recruitment_metadata_row_mismatch'; end if;
end $$;
revoke all on function public.attach_staff_import_recruitment_metadata(uuid,jsonb) from public,anon;
grant execute on function public.attach_staff_import_recruitment_metadata(uuid,jsonb) to authenticated;

create or replace function private.apply_staff_import_recruitment_fields()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.imported_staff_id is null or new.imported_staff_id is not distinct from old.imported_staff_id then return new; end if;
  update public.staff_profiles set engagement_type=(new.normalised_data->>'engagementType')::public.staff_engagement_type
  where organisation_id=new.organisation_id and id=new.imported_staff_id;
  insert into public.staff_central_records(organisation_id,staff_id,dbs_requirement,dbs_status,checked_by_membership_id,checked_at)
  values(new.organisation_id,new.imported_staff_id,(new.normalised_data->>'dbsRequirement')::public.dbs_requirement_status,
    'not_started',private.current_membership_id(new.organisation_id),now())
  on conflict(staff_id) do update set dbs_requirement=excluded.dbs_requirement,checked_by_membership_id=excluded.checked_by_membership_id,checked_at=excluded.checked_at;
  return new;
end $$;
revoke all on function private.apply_staff_import_recruitment_fields() from public,anon,authenticated;
create trigger staff_import_recruitment_fields after update of imported_staff_id on public.staff_import_rows
for each row execute function private.apply_staff_import_recruitment_fields();

create view public.staff_recruitment_readiness with (security_invoker = true) as
select profile.organisation_id,profile.id staff_id,profile.engagement_type,profile.appointment_date,
  record.dbs_requirement,record.dbs_check_level,record.dbs_status,record.dbs_application_date,
  record.dbs_certificate_received_date,record.dbs_reference_encrypted is not null as dbs_reference_recorded,
  record.dbs_verified_at,record.volunteer_exception,record.suitability_status,
  record.suitability_decided_at,record.start_authorised_at,
  private.staff_may_begin_work(profile.organisation_id,profile.id,current_date) as may_begin_work
from public.staff_profiles profile left join public.staff_central_records record
  on record.organisation_id=profile.organisation_id and record.staff_id=profile.id
where profile.organisation_id is not null;
revoke all on public.staff_recruitment_readiness from anon;
grant select on public.staff_recruitment_readiness to authenticated;

comment on table public.holiday_pay_records is 'Manager-entered evidence of holiday pay actually paid. This table does not calculate payroll or statutory deductions.';
comment on view public.staff_recruitment_readiness is 'Derived operational readiness. It is not legal certification of suitability or DBS eligibility.';
