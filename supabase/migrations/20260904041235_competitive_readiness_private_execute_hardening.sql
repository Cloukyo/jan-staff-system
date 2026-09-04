-- Preserve the established rule that private trigger helpers are not callable
-- by API roles. The public readiness view derives its tenant-filtered boolean
-- directly, so it does not require EXECUTE on the private operational guard.

revoke all on function private.set_statutory_retention_until() from public,anon,authenticated;
revoke all on function private.staff_may_begin_work(uuid,text,date) from public,anon,authenticated;

drop view public.staff_recruitment_readiness;
create view public.staff_recruitment_readiness with (security_invoker = true) as
select profile.organisation_id,profile.id staff_id,profile.engagement_type,profile.appointment_date,
  record.dbs_requirement,record.dbs_check_level,record.dbs_status,record.dbs_application_date,
  record.dbs_certificate_received_date,record.dbs_reference_encrypted is not null as dbs_reference_recorded,
  record.dbs_verified_at,record.volunteer_exception,record.suitability_status,
  record.suitability_decided_at,record.start_authorised_at,
  profile.active
    and (profile.appointment_date is null or current_date >= profile.appointment_date)
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
    ) as may_begin_work
from public.staff_profiles profile left join public.staff_central_records record
  on record.organisation_id=profile.organisation_id and record.staff_id=profile.id
where profile.organisation_id is not null;
revoke all on public.staff_recruitment_readiness from anon;
grant select on public.staff_recruitment_readiness to authenticated;

comment on view public.staff_recruitment_readiness is 'Derived operational readiness under caller RLS. It is not legal certification of suitability or DBS eligibility.';
