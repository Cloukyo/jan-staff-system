-- Kiosk availability follows the organisation's historical Go Live state.
-- Billing restrictions preserve core online attendance and must not make a
-- live customer look pre-live when cancellation is merely scheduled.

create or replace function public.record_commercial_kiosk_heartbeat(
  device_token text,
  app_version text,
  protocol_version integer,
  platform_category text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  device public.kiosk_devices%rowtype;
  registration public.commercial_kiosk_registrations%rowtype;
  organisation_state text;
begin
  if device_token is null
    or length(device_token) < 32
    or app_version !~ '^[A-Za-z0-9][A-Za-z0-9._+-]{0,39}$'
    or protocol_version not between 1 and 1000
    or platform_category not in ('tablet','desktop','mobile','unknown') then
    return jsonb_build_object('outcome','invalid_request');
  end if;

  update public.kiosk_devices
  set last_used_at = now(),
      last_heartbeat_at = now(),
      app_version = record_commercial_kiosk_heartbeat.app_version,
      protocol_version = record_commercial_kiosk_heartbeat.protocol_version,
      platform_category = record_commercial_kiosk_heartbeat.platform_category,
      health_revision = health_revision + 1
  where token_hash = sha256(convert_to(device_token,'UTF8'))
    and active
    and expires_at > now()
    and organisation_id is not null
    and offline_enabled = false
  returning * into device;

  if not found then
    return jsonb_build_object('outcome','device_rejected');
  end if;

  select * into registration
  from public.commercial_kiosk_registrations
  where id = device.registration_id
  for update;

  if found and registration.status = 'claimed' then
    update public.commercial_kiosk_registrations
    set status = 'verified',
        verified_at = now(),
        revision = revision + 1,
        updated_at = now()
    where id = registration.id;
  end if;

  select operational_state into organisation_state
  from public.organisations
  where id = device.organisation_id;

  return jsonb_build_object(
    'outcome','connected',
    'deviceId',device.id,
    'siteId',device.site_id,
    'healthRevision',device.health_revision::text,
    'preLive',coalesce(organisation_state <> 'live',true),
    'offlineEnabled',false
  );
end
$$;

revoke all on function public.record_commercial_kiosk_heartbeat(text,text,integer,text)
  from public;
grant execute on function public.record_commercial_kiosk_heartbeat(text,text,integer,text)
  to anon, authenticated;
