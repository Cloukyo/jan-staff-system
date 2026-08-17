-- Expire stale one-time kiosk registrations before enforcing the one-pending-per-site invariant.
-- This keeps replacement recovery deterministic when a browser abandons an expired code.

create or replace function private.expire_stale_commercial_kiosk_registrations()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.commercial_kiosk_registrations
  set status = 'expired',
      revision = revision + 1,
      updated_at = clock_timestamp()
  where organisation_id = new.organisation_id
    and site_id = new.site_id
    and status = 'pending'
    and expires_at <= clock_timestamp();

  return new;
end;
$$;

drop trigger if exists expire_stale_commercial_kiosk_registrations_before_insert
  on public.commercial_kiosk_registrations;
create trigger expire_stale_commercial_kiosk_registrations_before_insert
before insert on public.commercial_kiosk_registrations
for each row execute function private.expire_stale_commercial_kiosk_registrations();

revoke all on function private.expire_stale_commercial_kiosk_registrations()
  from public, anon, authenticated;
