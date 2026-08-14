-- Preserve the 7G Pre-live wrapper while repairing the two self-qualified
-- parameter references inside the renamed Workstream 5 attendance function.
do $repair$
declare
  function_definition text;
  old_reference constant text := 'perform_commercial_kiosk_attendance_action.idempotency_key';
  new_reference constant text := 'perform_commercial_kiosk_attendance_action_7g.idempotency_key';
  reference_count integer;
begin
  select pg_get_functiondef(
    'public.perform_commercial_kiosk_attendance_action_7g(text,text,text,text,text,uuid)'::regprocedure
  ) into function_definition;

  reference_count := (
    length(function_definition) - length(replace(function_definition, old_reference, ''))
  ) / length(old_reference);
  if reference_count <> 2 then
    raise exception 'Expected two renamed commercial attendance RPC references, found %', reference_count;
  end if;

  function_definition := replace(function_definition, old_reference, new_reference);
  execute function_definition;
end
$repair$;
