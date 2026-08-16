-- Keep the privileged billing snapshot implementation outside the exposed Data API schema.
-- The public function remains a stable SECURITY INVOKER contract and cannot bypass its caller.

create schema if not exists commercial_api_private;
revoke all on schema commercial_api_private from public, anon, authenticated, service_role;
grant usage on schema commercial_api_private to authenticated;

alter function public.commercial_billing_snapshot(uuid) set schema commercial_api_private;

revoke all on function commercial_api_private.commercial_billing_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function commercial_api_private.commercial_billing_snapshot(uuid)
  to authenticated;

create function public.commercial_billing_snapshot(target_organisation_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select commercial_api_private.commercial_billing_snapshot(target_organisation_id)
$$;

revoke all on function public.commercial_billing_snapshot(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.commercial_billing_snapshot(uuid)
  to authenticated;
