-- Independent commercial staging exposes only explicit token-authenticated
-- anonymous RPCs. PostgreSQL grants EXECUTE to PUBLIC by default, and several
-- legacy CREATE OR REPLACE migrations had restored that implicit grant.

revoke execute on all functions in schema private from public, anon, authenticated;
alter default privileges in schema private revoke execute on functions from public;

revoke execute on all functions in schema public from public, anon;
alter default privileges in schema public revoke execute on functions from public;

do $$
declare
  allowed record;
begin
  for allowed in
    select procedure.oid::regprocedure signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'claim_commercial_kiosk',
        'inspect_manager_invitation',
        'inspect_staff_invitation',
        'get_tenant_aware_device_kiosk_roster',
        'change_tenant_aware_device_kiosk_pin',
        'perform_commercial_kiosk_attendance_action',
        'perform_tenant_aware_kiosk_attendance_action',
        'record_commercial_kiosk_heartbeat',
        'verify_commercial_device_kiosk_pin',
        'verify_commercial_kiosk_roster',
        'verify_tenant_aware_device_kiosk_pin'
      )
  loop
    execute format('grant execute on function %s to anon', allowed.signature);
  end loop;
end
$$;

-- Trigger/helper functions are invoked by PostgreSQL or guarded functions,
-- never as Data API endpoints.
do $$
declare
  internal_function record;
begin
  for internal_function in
    select procedure.oid::regprocedure signature, procedure.proname
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'public'
      and procedure.proname in (
        'ensure_staff_account_profile_is_active',
        'guard_payroll_import_review_row',
        'kiosk_pin_is_acceptable',
        'mark_unspecified_template_break',
        'set_updated_at',
        'validate_rota_shift'
      )
  loop
    execute format('revoke execute on function %s from authenticated', internal_function.signature);
    if internal_function.proname = 'set_updated_at' then
      execute format('alter function %s set search_path = ''''', internal_function.signature);
    end if;
  end loop;
end
$$;
