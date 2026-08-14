begin;

select plan(14);

select has_table('public','commercial_admin_events','post-live administration has append-only audit evidence');
select has_table('public','commercial_admin_command_receipts','post-live commands have durable receipts');
select has_function('public','get_commercial_admin_snapshot',array['uuid','uuid'],'tenant-fenced administration snapshot exists');
select has_function('public','execute_commercial_admin_command',array['uuid','text','jsonb','uuid','bigint'],'guarded administration command exists');
select ok(has_function_privilege('authenticated','public.get_commercial_admin_snapshot(uuid,uuid)','EXECUTE') and not has_function_privilege('anon','public.get_commercial_admin_snapshot(uuid,uuid)','EXECUTE'),'only authenticated members can load administration');
select ok(has_function_privilege('authenticated','public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)','EXECUTE') and not has_function_privilege('anon','public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)','EXECUTE'),'only authenticated members can call the command boundary');
select ok(not has_table_privilege('authenticated','public.commercial_admin_command_receipts','SELECT') and not has_table_privilege('authenticated','public.commercial_admin_command_receipts','INSERT'),'command receipts are not browser-readable or writable');
select ok(has_table_privilege('authenticated','public.commercial_admin_events','SELECT') and not has_table_privilege('authenticated','public.commercial_admin_events','INSERT'),'audit evidence is customer-readable only through tenant RLS');
select policies_are('public','commercial_admin_events',array['commercial_admin_events_read'],'audit events have one explicit tenant read policy');
select policies_are('public','commercial_admin_command_receipts',array['commercial_admin_receipts_no_client_access'],'receipt RLS explicitly denies browser access');
select has_column('public','organisations','admin_revision','organisation commands use optimistic revision');
select has_column('public','organisation_sites','admin_revision','site commands use optimistic revision');
select has_column('public','staff_profiles','admin_revision','staff commands use optimistic revision');
select ok(not exists(select 1 from information_schema.routine_privileges where specific_schema='private' and grantee in('anon','authenticated') and routine_name like 'commercial_admin_%'),'private administration helpers are not browser executable');

select * from finish();
rollback;
