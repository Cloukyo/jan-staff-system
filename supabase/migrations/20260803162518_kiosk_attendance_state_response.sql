revoke all on function public.verify_device_kiosk_pin(text, text, text)
from public, anon, authenticated;

drop function public.verify_device_kiosk_pin(text, text, text);

create function public.verify_device_kiosk_pin(
  device_token text,
  target_staff_id text,
  candidate_pin text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  verification record;
  attendance_state jsonb;
begin
  perform public.require_kiosk_device(device_token);
  select * into verification
  from public.verify_kiosk_pin(target_staff_id, candidate_pin);

  if not coalesce(verification.ok, false) then
    return jsonb_build_object(
      'ok', false,
      'code', coalesce(verification.code, 'unavailable'),
      'state', verification.current_status
    );
  end if;

  attendance_state := public.get_attendance_state(target_staff_id, now());
  return jsonb_build_object(
    'ok', true,
    'code', verification.code,
    'state', attendance_state ->> 'state',
    'attendanceState', attendance_state,
    'weeklyHours', jsonb_build_object(
      'weekStartDate', verification.work_week_start_date,
      'weekEndDate', verification.work_week_end_date,
      'completedMinutes', coalesce(verification.completed_minutes, 0),
      'openShiftInProgress', coalesce(verification.open_shift_in_progress, false)
    )
  );
end;
$$;

revoke all on function public.verify_device_kiosk_pin(text, text, text)
from public, anon, authenticated;
grant execute on function public.verify_device_kiosk_pin(text, text, text)
to anon, authenticated;
