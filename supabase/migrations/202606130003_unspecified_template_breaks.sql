alter table public.rota_template_shifts
  alter column break_minutes drop not null;

alter table public.rota_shifts
  add column break_unspecified boolean not null default false;

create or replace function public.mark_unspecified_template_break()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.source_template_shift_id is not null and exists (
    select 1
    from public.rota_template_shifts template_shift
    where template_shift.id = new.source_template_shift_id
      and template_shift.break_minutes is null
  ) then
    new.break_minutes := coalesce(new.break_minutes, 0);
    new.break_unspecified := true;
  elsif new.break_minutes is null then
    raise exception 'Break minutes are required unless the source template records an unspecified break';
  end if;
  return new;
end;
$$;

create trigger rota_shift_unspecified_template_break
before insert or update of break_minutes, source_template_shift_id on public.rota_shifts
for each row execute function public.mark_unspecified_template_break();
