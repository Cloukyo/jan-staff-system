-- Run only in an isolated database. Every synthetic row is rolled back.
begin;
select plan(6);
select ok(not has_function_privilege('authenticated','private.staff_may_begin_work(uuid,text,date)','EXECUTE'),'private helper remains non-callable');
select ok(has_function_privilege('authenticated','public.confirm_staff_dbs_receipt(uuid,text,timestamptz,date,text)','EXECUTE')
  and not has_function_privilege('anon','public.confirm_staff_dbs_receipt(uuid,text,timestamptz,date,text)','EXECUTE'),'confirmation requires authenticated guarded access');
select ok(not has_table_privilege('authenticated','public.staff_dbs_receipt_confirmations','INSERT')
  and not has_table_privilege('authenticated','public.staff_dbs_receipt_confirmations','UPDATE')
  and not has_table_privilege('authenticated','public.staff_dbs_receipt_confirmations','DELETE'),'receipt evidence is not client-forgeable');
select ok((select relrowsecurity from pg_class where oid='public.staff_dbs_receipt_confirmations'::regclass),'receipt audit has RLS');
select ok((select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid='public.confirm_staff_dbs_receipt(uuid,text,timestamptz,date,text)'::regprocedure),'receipt RPC has fixed path and security definer');
do $receipt_test$
declare
  org_id uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid(); member_id uuid:=gen_random_uuid();
  site_id_value uuid:=gen_random_uuid(); subscription_id_value uuid:=gen_random_uuid(); week_id uuid:=gen_random_uuid();
  staff_value text:='receipt-date-regression-'||gen_random_uuid()::text;
  plan_row record; record_version timestamptz; engagement text; d date; actual boolean; expected boolean;
  before_audits bigint; rejected boolean; helper_value boolean; view_value boolean;
begin
  insert into public.organisations(id,legal_name,display_name,slug)
    values(org_id,'Fictional Receipt Verification Ltd','Fictional Receipt Verification',staff_value);
  insert into auth.users(id,email) values(owner_id,staff_value||'@example.test');
  insert into public.organisation_memberships(id,organisation_id,auth_user_id,status,joined_at)
    values(member_id,org_id,owner_id,'active',now());
  insert into public.membership_role_assignments(organisation_id,membership_id,role,scope_type,granted_by_membership_id)
    values(org_id,member_id,'organisation_owner','organisation',member_id);
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'aal','aal2')::text,true);
  select * into strict plan_row from public.plan_entitlements
    where capability_key='staff.active.limit' and integer_value>=2 order by plan_key,plan_version limit 1;
  insert into public.organisation_subscriptions(id,organisation_id,plan_key,plan_version,state,created_by_membership_id)
    values(subscription_id_value,org_id,plan_row.plan_key,plan_row.plan_version,'active',member_id);
  insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,integer_value,source_plan_key,source_plan_version)
    values(org_id,subscription_id_value,'staff.active.limit','integer',plan_row.integer_value,plan_row.plan_key,plan_row.plan_version);
  insert into public.organisation_sites(id,organisation_id,name,slug)
    values(site_id_value,org_id,'Fictional site','fictional-site');
  insert into public.staff_profiles(id,organisation_id,full_name,display_name,employment_role,appointment_date)
    values(staff_value,org_id,'Fictional Receipt Test','Fictional','Test employee','2010-01-01');
  insert into public.staff_central_records(
    organisation_id,staff_id,dbs_requirement,dbs_check_level,dbs_status,dbs_recorded,
    dbs_issue_date,dbs_last_checked_at,dbs_certificate_received_date,dbs_reference_encrypted,
    dbs_verified_at,dbs_verified_by_membership_id,suitability_status,suitability_decided_at,
    suitability_decided_by_membership_id,start_authorised_at,start_authorised_by_membership_id)
  values(org_id,staff_value,'required','enhanced_childrens_barred_list','verified',true,
    '2020-01-01','2020-02-01','2020-09-20','v1:fictional:encrypted:evidence',
    '2020-01-01Z',member_id,'suitable','2020-01-01Z',member_id,'2020-01-01Z',member_id);
  if private.staff_may_begin_work(org_id,staff_value,'2020-09-21') then raise exception 'unconfirmed receipt allowed'; end if;
  select updated_at into record_version from public.staff_central_records where staff_id=staff_value;
  perform public.confirm_staff_dbs_receipt(org_id,staff_value,record_version,'2020-09-20','Fictional historical receipt register reviewed');
  if (select count(*) from public.staff_dbs_receipt_confirmations where organisation_id=org_id)<>1 then raise exception 'confirmation audit missing'; end if;

  foreach engagement in array array['employee','volunteer'] loop
    update public.staff_profiles set engagement_type=engagement::public.staff_engagement_type where id=staff_value;
    foreach d in array array[date '2020-09-19',date '2020-09-20',date '2020-09-21'] loop
      expected:=d>=date '2020-09-20';
      if private.staff_may_begin_work(org_id,staff_value,d) is distinct from expected then raise exception 'receipt date matrix failed'; end if;
    end loop;
    update public.staff_central_records set start_authorised_at='2020-09-21T18:00:00+01:00' where staff_id=staff_value;
    foreach d in array array[date '2020-09-20',date '2020-09-21',date '2020-09-22'] loop
      expected:=d>=date '2020-09-21';
      if private.staff_may_begin_work(org_id,staff_value,d) is distinct from expected then raise exception 'authorisation matrix failed'; end if;
    end loop;
    update public.staff_central_records set start_authorised_at='2020-01-01Z' where staff_id=staff_value;
  end loop;

  -- Actual deployed trigger paths, not recreated trigger substitutes.
  insert into public.rota_weeks(id,week_start_date,organisation_id,site_id,created_by_membership_id,updated_by_membership_id)
    values(week_id,'2020-09-14',org_id,site_id_value,member_id,member_id);
  insert into public.rota_shifts(rota_week_id,staff_id,shift_date,start_time,end_time,organisation_id,site_id,created_by_membership_id,updated_by_membership_id)
    values(week_id,staff_value,'2020-09-20','09:00','10:00',org_id,site_id_value,member_id,member_id);
  rejected:=false;
  begin
    update public.rota_shifts set shift_date='2020-09-19' where rota_week_id=week_id;
  exception when raise_exception then
    if sqlerrm<>'staff_not_authorised_to_begin_work' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'rota date guard bypass'; end if;
  update public.staff_kiosk_settings set kiosk_enabled=true where staff_id=staff_value;
  update public.staff_central_records set dbs_certificate_received_date='2020-09-19' where staff_id=staff_value;
  if private.staff_may_begin_work(org_id,staff_value,'2020-09-21') then raise exception 'changed receipt reused confirmation'; end if;
  rejected:=false;
  begin
    update public.staff_kiosk_settings set kiosk_enabled=true where staff_id=staff_value;
  exception when raise_exception then
    if sqlerrm<>'staff_not_authorised_to_begin_work' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'kiosk enable guard bypass'; end if;
  rejected:=false;
  begin
    insert into public.clock_events(organisation_id,site_id,staff_id,event_type,event_timestamp)
      values(org_id,site_id_value,staff_value,'clock_in','2020-09-21T09:00:00Z');
  exception when raise_exception then
    if sqlerrm<>'staff_not_authorised_to_begin_work' then raise; end if; rejected:=true;
  end;
  if not rejected then raise exception 'already enabled kiosk bypass'; end if;
  insert into public.clock_events(organisation_id,site_id,staff_id,event_type,event_timestamp)
    values(org_id,site_id_value,staff_value,'clock_out','2020-09-21T10:00:00Z');

  -- Uncertain legacy evidence can be resolved without storing a replacement DBS.
  update public.staff_central_records set dbs_status='legacy_recorded',dbs_reference_encrypted=null,dbs_verified_at=null where staff_id=staff_value;
  select updated_at into record_version from public.staff_central_records where staff_id=staff_value;
  perform public.confirm_staff_dbs_receipt(org_id,staff_value,record_version,'2020-09-20','Fictional legacy receipt evidence reviewed');
  if not private.staff_may_begin_work(org_id,staff_value,'2020-09-20') then raise exception 'legacy resolution stranded staff'; end if;
  if exists(select 1 from public.staff_central_records where staff_id=staff_value and (dbs_issue_date<>date '2020-01-01' or dbs_last_checked_at<>date '2020-02-01' or dbs_reference_encrypted is not null)) then raise exception 'historical evidence changed'; end if;
  insert into public.clock_events(organisation_id,site_id,staff_id,event_type,event_timestamp)
    values(org_id,site_id_value,staff_value,'clock_in','2020-09-19T23:00:00Z');

  -- Same London calendar day includes BST midnight, independent of session zone.
  perform set_config('TimeZone','UTC',true);
  update public.staff_central_records set start_authorised_at='2020-09-20T23:00:00Z' where staff_id=staff_value;
  if private.staff_may_begin_work(org_id,staff_value,'2020-09-20') then raise exception 'UTC leaked into London date'; end if;
  if not private.staff_may_begin_work(org_id,staff_value,'2020-09-21') then raise exception 'London same day rejected'; end if;
  select private.staff_may_begin_work(org_id,staff_value,(statement_timestamp() at time zone 'Europe/London')::date) into helper_value;
  select may_begin_work into view_value from public.staff_recruitment_readiness where staff_id=staff_value;
  if helper_value is distinct from view_value then raise exception 'view/helper mismatch'; end if;

  select count(*) into before_audits from public.staff_dbs_receipt_confirmations where organisation_id=org_id;
  rejected:=false;
  begin
    perform public.confirm_staff_dbs_receipt(org_id,staff_value,'2000-01-01Z','2020-09-20','Fictional stale review');
  exception when raise_exception then
    if sqlerrm<>'dbs_receipt_record_changed' then raise; end if; rejected:=true;
  end;
  if not rejected or (select count(*) from public.staff_dbs_receipt_confirmations where organisation_id=org_id)<>before_audits then raise exception 'stale confirmation audit integrity'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  perform set_config('request.jwt.claims','{}',true);
  rejected:=false;
  begin
    perform public.confirm_staff_dbs_receipt(org_id,staff_value,record_version,'2020-09-20','Fictional unauthorised review');
  exception when insufficient_privilege then rejected:=true;
  end;
  if not rejected then raise exception 'unauthorised confirmation accepted'; end if;
  perform set_config('request.jwt.claim.sub',owner_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'aal','aal2')::text,true);

  update public.staff_central_records set dbs_requirement='not_required',dbs_status='not_required',
    dbs_certificate_received_date=null,volunteer_exception='occasional_supervised' where staff_id=staff_value;
  if not private.staff_may_begin_work(org_id,staff_value,'2020-09-21') then raise exception 'explicit volunteer exception lost'; end if;
  update public.staff_profiles set engagement_type='employee' where id=staff_value;
  if private.staff_may_begin_work(org_id,staff_value,'2020-09-21') then raise exception 'employee exception bypass'; end if;
end $receipt_test$;
select ok(true,'Full-schema date matrix, legacy remediation, actual rota/kiosk/clock-in triggers, audit integrity and permissions passed');
select * from finish();
rollback;
