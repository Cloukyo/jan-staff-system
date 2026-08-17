-- RLS policy expressions execute as the calling authenticated role. These
-- narrowly scoped helpers are deliberately callable by authenticated users;
-- each resolves auth.uid() and tenant membership internally with an empty
-- search path. No anonymous or PUBLIC execution is restored.

do $$
declare
  policy_helper record;
begin
  for policy_helper in
    select procedure.oid::regprocedure signature
    from pg_proc procedure
    join pg_namespace namespace on namespace.oid = procedure.pronamespace
    where namespace.nspname = 'private'
      and procedure.proname in (
        'attendance_row_is_readable',
        'can_access_staff',
        'can_read_onboarding_session',
        'current_membership',
        'current_membership_id',
        'has_permission',
        'has_site_permission',
        'is_active_member',
        'is_linked_staff'
      )
  loop
    execute format('grant execute on function %s to authenticated', policy_helper.signature);
  end loop;
end
$$;
