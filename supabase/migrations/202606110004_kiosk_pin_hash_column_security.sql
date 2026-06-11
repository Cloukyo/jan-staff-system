revoke all on public.staff_kiosk_settings from authenticated;

grant select (
  staff_id,
  kiosk_enabled,
  pin_updated_at,
  pin_reset_required,
  failed_attempt_count,
  locked_until,
  created_at,
  updated_at
) on public.staff_kiosk_settings to authenticated;

grant insert (
  staff_id,
  kiosk_enabled,
  pin_reset_required
) on public.staff_kiosk_settings to authenticated;

grant update (
  kiosk_enabled,
  pin_reset_required
) on public.staff_kiosk_settings to authenticated;
