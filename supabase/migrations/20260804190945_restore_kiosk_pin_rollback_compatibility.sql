revoke all on function public.verify_device_kiosk_pin(text, text, text)
from public, anon, authenticated;

drop function public.verify_device_kiosk_pin(text, text, text);

create function public.verify_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  candidate_pin text
)
returns table (
  ok boolean,
  code text,
  current_status text,
  work_week_start_date date,
  work_week_end_date date,
  completed_minutes integer,
  open_shift_in_progress boolean,
  attendance_state jsonb
)
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  verification record;
  state_value jsonb;
begin
  perform public.require_kiosk_device(device_token);
  select * into verification
  from public.verify_kiosk_pin(target_staff_id, candidate_pin);

  if not coalesce(verification.ok, false) then
    return query select
      false,
      coalesce(verification.code, 'unavailable')::text,
      verification.current_status::text,
      verification.work_week_start_date::date,
      verification.work_week_end_date::date,
      coalesce(verification.completed_minutes, 0)::integer,
      coalesce(verification.open_shift_in_progress, false)::boolean,
      null::jsonb;
    return;
  end if;

  state_value := public.get_attendance_state(target_staff_id, now());
  return query select
    true,
    verification.code::text,
    (state_value ->> 'state')::text,
    verification.work_week_start_date::date,
    verification.work_week_end_date::date,
    coalesce(verification.completed_minutes, 0)::integer,
    coalesce(verification.open_shift_in_progress, false)::boolean,
    state_value;
end;
$$;

revoke all on function public.verify_device_kiosk_pin(text, text, text)
from public, anon, authenticated;
grant execute on function public.verify_device_kiosk_pin(text, text, text)
to anon, authenticated;
