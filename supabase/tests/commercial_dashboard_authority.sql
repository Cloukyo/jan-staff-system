begin;

select plan(10);

select has_function(
  'public',
  'get_commercial_attendance_dashboard',
  array['uuid', 'uuid', 'date'],
  'commercial dashboard function retains its public signature'
);

select ok(
  (select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_commercial_attendance_dashboard'),
  'commercial dashboard remains security definer'
);

select ok(
  (select p.proconfig = array['search_path=""']::text[] from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'get_commercial_attendance_dashboard'),
  'commercial dashboard retains an empty fixed search path'
);

select ok(
  has_function_privilege('authenticated', 'public.get_commercial_attendance_dashboard(uuid,uuid,date)', 'EXECUTE')
  and has_function_privilege('service_role', 'public.get_commercial_attendance_dashboard(uuid,uuid,date)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_commercial_attendance_dashboard(uuid,uuid,date)', 'EXECUTE'),
  'dashboard execution remains restricted to authenticated and service roles'
);

select ok(position('public.rota_shifts' in pg_get_functiondef('public.get_commercial_attendance_dashboard(uuid,uuid,date)'::regprocedure)) > 0,
  'dashboard rota signals use commercial rota shifts');
select ok(position('public.leave_requests' in pg_get_functiondef('public.get_commercial_attendance_dashboard(uuid,uuid,date)'::regprocedure)) > 0,
  'dashboard leave signals use commercial leave requests');
select ok(position('public.staff_pay_arrangements' in pg_get_functiondef('public.get_commercial_attendance_dashboard(uuid,uuid,date)'::regprocedure)) > 0,
  'dashboard pay signals use effective-dated pay arrangements');
select ok(position('public.staff_kiosk_settings' in pg_get_functiondef('public.get_commercial_attendance_dashboard(uuid,uuid,date)'::regprocedure)) > 0,
  'dashboard kiosk signals use kiosk eligibility and setup');
select ok(position('public.staff_recruitment_readiness' in pg_get_functiondef('public.get_commercial_attendance_dashboard(uuid,uuid,date)'::regprocedure)) > 0,
  'dashboard operational blockers use recruitment readiness');
select ok(position('public.staff_certificates' in pg_get_functiondef('public.get_commercial_attendance_dashboard(uuid,uuid,date)'::regprocedure)) > 0,
  'dashboard certificate signals use current certificate evidence');

select * from finish();
rollback;
