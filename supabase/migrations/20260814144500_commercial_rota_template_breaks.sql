alter table public.rota_template_shifts
  add column if not exists break_unspecified boolean not null default false;
