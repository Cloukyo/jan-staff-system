create schema if not exists commercial_api_private;
revoke all on schema commercial_api_private from public,anon,authenticated,service_role;
grant usage on schema commercial_api_private to authenticated;

alter function public.get_commercial_admin_snapshot(uuid,uuid) set schema commercial_api_private;
alter function public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) set schema commercial_api_private;

revoke all on function commercial_api_private.get_commercial_admin_snapshot(uuid,uuid),commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function commercial_api_private.get_commercial_admin_snapshot(uuid,uuid),commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) to authenticated;

create function public.get_commercial_admin_snapshot(target_organisation_id uuid,target_site_id uuid default null)
returns jsonb language sql stable security invoker set search_path='' as $$
  select commercial_api_private.get_commercial_admin_snapshot(target_organisation_id,target_site_id)
$$;

create function public.execute_commercial_admin_command(target_organisation_id uuid,command_name text,payload jsonb,idempotency_key uuid,expected_revision bigint)
returns jsonb language sql volatile security invoker set search_path='' as $$
  select commercial_api_private.execute_commercial_admin_command(target_organisation_id,command_name,payload,idempotency_key,expected_revision)
$$;

revoke all on function public.get_commercial_admin_snapshot(uuid,uuid),public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.get_commercial_admin_snapshot(uuid,uuid),public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint) to authenticated;

create index commercial_admin_events_actor_fk_idx on public.commercial_admin_events(organisation_id,actor_membership_id);
create index commercial_admin_events_site_fk_idx on public.commercial_admin_events(organisation_id,site_id) where site_id is not null;
create index commercial_admin_receipts_actor_fk_idx on public.commercial_admin_command_receipts(organisation_id,actor_membership_id);
