begin;

select plan(12);

select has_column('public','rota_weeks','organisation_id','rota weeks carry organisation ownership');
select has_column('public','rota_weeks','site_id','rota weeks carry occurrence-site ownership');
select has_column('public','rota_shifts','work_area_id','rota shifts use tenant-fenced work areas');
select has_column('public','leave_requests','organisation_id','leave is organisation owned');
select has_column('public','leave_requests','source_site_id','leave may retain optional source-site context');
select has_table('public','commercial_rota_events','commercial rota audit events exist');
select has_table('public','commercial_leave_events','commercial leave audit events exist');
select has_function('public','execute_commercial_rota_command',array['uuid','uuid','text','jsonb','uuid','bigint'],'guarded rota command boundary exists');
select has_function('public','execute_commercial_leave_command',array['uuid','text','jsonb','uuid','bigint'],'guarded leave command boundary exists');
select has_function('public','get_commercial_planned_shifts',array['uuid','uuid','date','date','text'],'tenant planned-hours adapter exists');
select ok(
  has_function_privilege('authenticated','public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.execute_commercial_rota_command(uuid,uuid,text,jsonb,uuid,bigint)','EXECUTE'),
  'only authenticated callers receive the rota command grant'
);
select ok(
  has_function_privilege('authenticated','public.execute_commercial_leave_command(uuid,text,jsonb,uuid,bigint)','EXECUTE')
  and not has_function_privilege('anon','public.execute_commercial_leave_command(uuid,text,jsonb,uuid,bigint)','EXECUTE'),
  'only authenticated callers receive the leave command grant'
);

select * from finish();
rollback;
