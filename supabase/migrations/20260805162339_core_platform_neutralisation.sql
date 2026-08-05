-- Add neutral platform terminology without rewriting historic migrations or
-- breaking clients that still use the original nursery-oriented fields.

alter table public.rota_settings
  add column if not exists available_work_areas text[];

update public.rota_settings
set available_work_areas = available_rooms
where available_work_areas is null;

alter table public.rota_settings
  alter column available_work_areas set default array[]::text[],
  alter column available_work_areas set not null;

alter table public.rota_shifts
  add column if not exists work_area text;

update public.rota_shifts
set work_area = room_or_area
where work_area is null;

alter table public.rota_template_shifts
  add column if not exists work_area text;

update public.rota_template_shifts
set work_area = room_or_area
where work_area is null;

alter table public.kiosk_devices
  add column if not exists operational_context text;

update public.kiosk_devices
set operational_context = nursery_context
where operational_context is null;

alter table public.kiosk_devices
  alter column operational_context drop default,
  alter column operational_context set not null;

alter table public.kiosk_offline_authorisations
  add column if not exists operational_context text;

update public.kiosk_offline_authorisations
set operational_context = nursery_context
where operational_context is null;

alter table public.kiosk_offline_authorisations
  alter column operational_context set not null;

create or replace function public.sync_neutral_work_area_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_table_name = 'rota_settings' then
    if tg_op = 'INSERT' then
      if cardinality(new.available_work_areas) = 0 and cardinality(new.available_rooms) > 0 then
        new.available_work_areas := new.available_rooms;
      else
        new.available_rooms := new.available_work_areas;
      end if;
    elsif new.available_work_areas is distinct from old.available_work_areas then
      new.available_rooms := new.available_work_areas;
    elsif new.available_rooms is distinct from old.available_rooms then
      new.available_work_areas := new.available_rooms;
    end if;
  else
    if tg_op = 'INSERT' then
      new.work_area := coalesce(new.work_area, new.room_or_area);
      new.room_or_area := coalesce(new.room_or_area, new.work_area);
    elsif new.work_area is distinct from old.work_area then
      new.room_or_area := new.work_area;
    elsif new.room_or_area is distinct from old.room_or_area then
      new.work_area := new.room_or_area;
    end if;
  end if;
  return new;
end;
$$;

create trigger rota_settings_sync_neutral_work_areas
before insert or update of available_rooms, available_work_areas
on public.rota_settings
for each row execute function public.sync_neutral_work_area_fields();

create trigger rota_shifts_sync_neutral_work_area
before insert or update of room_or_area, work_area
on public.rota_shifts
for each row execute function public.sync_neutral_work_area_fields();

create trigger rota_template_shifts_sync_neutral_work_area
before insert or update of room_or_area, work_area
on public.rota_template_shifts
for each row execute function public.sync_neutral_work_area_fields();

create or replace function public.sync_neutral_operational_context_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.operational_context := coalesce(new.operational_context, new.nursery_context, 'platform');
    new.nursery_context := coalesce(new.nursery_context, new.operational_context);
  elsif new.operational_context is distinct from old.operational_context then
    new.nursery_context := new.operational_context;
  elsif new.nursery_context is distinct from old.nursery_context then
    new.operational_context := new.nursery_context;
  end if;
  return new;
end;
$$;

create trigger kiosk_devices_sync_neutral_operational_context
before insert or update of nursery_context, operational_context
on public.kiosk_devices
for each row execute function public.sync_neutral_operational_context_fields();

create trigger kiosk_offline_authorisations_sync_neutral_operational_context
before insert or update of nursery_context, operational_context
on public.kiosk_offline_authorisations
for each row execute function public.sync_neutral_operational_context_fields();

revoke all on function public.sync_neutral_work_area_fields()
from public, anon, authenticated;
revoke all on function public.sync_neutral_operational_context_fields()
from public, anon, authenticated;
