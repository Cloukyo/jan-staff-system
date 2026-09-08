-- Forward-only correction. Preserve all legacy evidence; never backfill confirmed
-- receipt timing from issue dates, last-check dates or an unproven receipt value.
create table public.staff_dbs_receipt_confirmations (
  id bigint generated always as identity primary key,
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  staff_id text not null,
  received_on date not null,
  previous_received_on date,
  evidence_note text not null check (length(btrim(evidence_note)) between 5 and 2000),
  check_fingerprint bytea not null check (octet_length(check_fingerprint)=32),
  confirmed_by_membership_id uuid not null,
  confirmed_at timestamptz not null default clock_timestamp(),
  foreign key (organisation_id,staff_id) references public.staff_profiles(organisation_id,id) on delete restrict,
  foreign key (organisation_id,confirmed_by_membership_id) references public.organisation_memberships(organisation_id,id) on delete restrict
);
create index staff_dbs_receipt_latest on public.staff_dbs_receipt_confirmations(organisation_id,staff_id,id desc);
create index staff_dbs_receipt_actor on public.staff_dbs_receipt_confirmations(organisation_id,confirmed_by_membership_id);
alter table public.staff_dbs_receipt_confirmations enable row level security;
create policy staff_dbs_receipt_read on public.staff_dbs_receipt_confirmations for select to authenticated
  using (private.has_permission(organisation_id,'compliance.manage'));
revoke all on public.staff_dbs_receipt_confirmations from public,anon,authenticated,service_role;
revoke all on sequence public.staff_dbs_receipt_confirmations_id_seq from public,anon,authenticated,service_role;
grant select on public.staff_dbs_receipt_confirmations to authenticated;

create function public.confirm_staff_dbs_receipt(
  target_organisation_id uuid,target_staff_id text,expected_updated_at timestamptz,received_on date,evidence_note text
) returns void language plpgsql security definer set search_path='' as $$
declare check_record public.staff_central_records%rowtype; actor_id uuid; previous_date date;
begin
  if not coalesce(private.has_permission(target_organisation_id,'compliance.manage'),false) then
    raise exception 'dbs_receipt_confirmation_forbidden' using errcode='42501';
  end if;
  actor_id:=private.current_membership_id(target_organisation_id);
  if actor_id is null then raise exception 'dbs_receipt_confirmation_forbidden' using errcode='42501'; end if;
  if received_on is null or received_on>(clock_timestamp() at time zone 'Europe/London')::date
    or evidence_note is null or length(btrim(evidence_note)) not between 5 and 2000 then
    raise exception 'dbs_receipt_confirmation_invalid';
  end if;
  select * into check_record from public.staff_central_records r
    where r.organisation_id=target_organisation_id and r.staff_id=target_staff_id for update;
  if not found then raise exception 'dbs_receipt_record_required'; end if;
  if expected_updated_at is null or check_record.updated_at is distinct from expected_updated_at then
    raise exception 'dbs_receipt_record_changed';
  end if;
  if check_record.dbs_requirement<>'required'
    or check_record.dbs_status not in ('certificate_received','verified','legacy_recorded') then
    raise exception 'dbs_receipt_evidence_required';
  end if;
  previous_date:=check_record.dbs_certificate_received_date;
  -- Existing suitability audit records changed dates. This receipt also audits
  -- confirmation when the value itself is unchanged. Both writes are atomic.
  update public.staff_central_records r set dbs_certificate_received_date=received_on,updated_at=clock_timestamp()
    where r.id=check_record.id returning r.* into check_record;
  insert into public.staff_dbs_receipt_confirmations(
    organisation_id,staff_id,received_on,previous_received_on,evidence_note,check_fingerprint,confirmed_by_membership_id
  ) values(target_organisation_id,target_staff_id,received_on,previous_date,btrim(evidence_note),
    sha256(convert_to(jsonb_build_array(check_record.id,check_record.dbs_requirement,check_record.dbs_check_level,check_record.dbs_issue_date,check_record.dbs_number_last4,check_record.dbs_reference_encrypted,check_record.dbs_certificate_received_date)::text,'UTF8')),actor_id);
end $$;
revoke all on function public.confirm_staff_dbs_receipt(uuid,text,timestamptz,date,text) from public,anon,authenticated,service_role;
grant execute on function public.confirm_staff_dbs_receipt(uuid,text,timestamptz,date,text) to authenticated;

create or replace function private.staff_may_begin_work(target_organisation_id uuid,target_staff_id text,target_date date)
returns boolean language sql stable security invoker set search_path='' as $$
  select exists(
    select 1 from public.staff_profiles profile
    join public.staff_central_records record on record.organisation_id=profile.organisation_id and record.staff_id=profile.id
    left join lateral (
  select confirmation.check_fingerprint from public.staff_dbs_receipt_confirmations confirmation
  where confirmation.organisation_id=profile.organisation_id and confirmation.staff_id=profile.id
  order by confirmation.id desc limit 1
) receipt on true
    where profile.organisation_id=target_organisation_id and profile.id=target_staff_id
      and profile.active
    and (target_date is not null)
    and (profile.appointment_date is null or profile.appointment_date<=target_date)
    and record.suitability_status in ('suitable','suitable_with_restrictions')
    and (record.suitability_decided_at at time zone 'Europe/London')::date<=target_date
    and (record.start_authorised_at at time zone 'Europe/London')::date<=target_date
    and (
      (record.dbs_requirement='required' and record.dbs_check_level='enhanced_childrens_barred_list'
        and record.dbs_certificate_received_date<=target_date
        and receipt.check_fingerprint=sha256(convert_to(jsonb_build_array(record.id,record.dbs_requirement,record.dbs_check_level,record.dbs_issue_date,record.dbs_number_last4,record.dbs_reference_encrypted,record.dbs_certificate_received_date)::text,'UTF8'))
        and ((record.dbs_status='verified' and record.dbs_reference_encrypted is not null
              and (record.dbs_verified_at at time zone 'Europe/London')::date<=target_date)
          or (record.dbs_status='legacy_recorded' and profile.appointment_date<date '2026-09-01' and record.dbs_recorded)))
      or (record.dbs_requirement='not_required' and profile.engagement_type='volunteer'
        and record.dbs_status='not_required' and record.volunteer_exception='occasional_supervised')
    )
  )
$$;
revoke all on function private.staff_may_begin_work(uuid,text,date) from public,anon,authenticated;

-- Repeated predicate is intentional: the invoker view must not expose private
-- helper EXECUTE to API roles. Executable database/application parity tests apply.
create or replace view public.staff_recruitment_readiness with (security_invoker=true) as
select profile.organisation_id,profile.id staff_id,profile.engagement_type,profile.appointment_date,
  record.dbs_requirement,record.dbs_check_level,record.dbs_status,record.dbs_application_date,
  record.dbs_certificate_received_date,record.dbs_reference_encrypted is not null as dbs_reference_recorded,
  record.dbs_verified_at,record.volunteer_exception,record.suitability_status,
  record.suitability_decided_at,record.start_authorised_at,
  coalesce(profile.active
    and (work_day.value is not null)
    and (profile.appointment_date is null or profile.appointment_date<=work_day.value)
    and record.suitability_status in ('suitable','suitable_with_restrictions')
    and (record.suitability_decided_at at time zone 'Europe/London')::date<=work_day.value
    and (record.start_authorised_at at time zone 'Europe/London')::date<=work_day.value
    and (
      (record.dbs_requirement='required' and record.dbs_check_level='enhanced_childrens_barred_list'
        and record.dbs_certificate_received_date<=work_day.value
        and receipt.check_fingerprint=sha256(convert_to(jsonb_build_array(record.id,record.dbs_requirement,record.dbs_check_level,record.dbs_issue_date,record.dbs_number_last4,record.dbs_reference_encrypted,record.dbs_certificate_received_date)::text,'UTF8'))
        and ((record.dbs_status='verified' and record.dbs_reference_encrypted is not null
              and (record.dbs_verified_at at time zone 'Europe/London')::date<=work_day.value)
          or (record.dbs_status='legacy_recorded' and profile.appointment_date<date '2026-09-01' and record.dbs_recorded)))
      or (record.dbs_requirement='not_required' and profile.engagement_type='volunteer'
        and record.dbs_status='not_required' and record.volunteer_exception='occasional_supervised')
    ),false) as may_begin_work,
  coalesce(receipt.check_fingerprint=sha256(convert_to(jsonb_build_array(record.id,record.dbs_requirement,record.dbs_check_level,record.dbs_issue_date,record.dbs_number_last4,record.dbs_reference_encrypted,record.dbs_certificate_received_date)::text,'UTF8')),false) as dbs_receipt_confirmed
from public.staff_profiles profile
left join public.staff_central_records record on record.organisation_id=profile.organisation_id and record.staff_id=profile.id
left join lateral (
  select confirmation.check_fingerprint from public.staff_dbs_receipt_confirmations confirmation
  where confirmation.organisation_id=profile.organisation_id and confirmation.staff_id=profile.id
  order by confirmation.id desc limit 1
) receipt on true
cross join (select (statement_timestamp() at time zone 'Europe/London')::date value) work_day
where profile.organisation_id is not null;
revoke all on public.staff_recruitment_readiness from public,anon;
grant select on public.staff_recruitment_readiness to authenticated;

create or replace function private.guard_staff_operational_start()
returns trigger language plpgsql security definer set search_path='' as $$
declare org_id uuid; staff_value text; work_date date;
begin
  if tg_table_name='rota_shifts' then
    if new.organisation_id is null or new.archived_at is not null or new.status='cancelled' then return new; end if;
    org_id:=new.organisation_id; staff_value:=new.staff_id; work_date:=new.shift_date;
  elsif tg_table_name='clock_events' then
    -- Clock-outs and manager correction evidence must remain recordable.
    if new.organisation_id is null or new.event_type<>'clock_in'
      or new.event_source<>'kiosk' or new.manager_correction then return new; end if;
    org_id:=new.organisation_id; staff_value:=new.staff_id;
    work_date:=(new.event_timestamp at time zone 'Europe/London')::date;
  else
    if not new.kiosk_enabled then return new; end if;
    select organisation_id into org_id from public.staff_profiles where id=new.staff_id;
    if org_id is null then return new; end if;
    staff_value:=new.staff_id; work_date:=(clock_timestamp() at time zone 'Europe/London')::date;
  end if;
  if not private.staff_may_begin_work(org_id,staff_value,work_date) then
    raise exception 'staff_not_authorised_to_begin_work';
  end if;
  return new;
end $$;
revoke all on function private.guard_staff_operational_start() from public,anon,authenticated;
create trigger clock_event_staff_start_guard before insert on public.clock_events
for each row execute function private.guard_staff_operational_start();

comment on table public.staff_dbs_receipt_confirmations is 'Append-only manager receipt-timing attestations, never issue-date or last-check-date inference. Replaced check evidence requires fresh confirmation.';
comment on function public.confirm_staff_dbs_receipt(uuid,text,timestamptz,date,text) is 'Organisation compliance manager confirms actual receipt with evidence and optimistic concurrency. Confirmation time is audit time, not the historical receipt date.';
