create type certificate_status as enum ('valid', 'expiring_90', 'expiring_60', 'expiring_30', 'expired', 'no_expiry', 'awaiting_evidence', 'expected');
create type reference_type as enum ('current_last_employer', 'previous_employer', 'alternative');
create type import_review_status as enum ('imported_successfully', 'imported_with_warning', 'skipped_invalid_data', 'duplicate_suspected', 'missing_required_information');

create table public.staff_profiles (
  id text primary key,
  full_name text not null,
  display_name text not null,
  employment_role text not null,
  main_qualification_level text,
  is_apprentice boolean not null default false,
  is_cover_staff boolean not null default false,
  appointment_date date,
  active boolean not null default true,
  auth_user_id uuid unique references auth.users(id) on delete set null,
  email text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.staff_profiles (
  id,
  full_name,
  display_name,
  employment_role,
  active,
  auth_user_id,
  email
)
select
  staff_id,
  full_name,
  split_part(full_name, ' ', 1),
  case when role = 'manager' then 'Manager' else 'Staff' end,
  active,
  auth_user_id,
  email
from public.staff_accounts
on conflict (id) do nothing;

alter table public.staff_accounts
  add constraint staff_accounts_staff_profile_fk
  foreign key (staff_id) references public.staff_profiles(id)
  deferrable initially deferred;

create unique index staff_profiles_active_auth_user_idx
on public.staff_profiles(auth_user_id)
where auth_user_id is not null and active = true;

create table public.staff_qualifications (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  qualification_name text not null,
  qualification_level text,
  awarding_organisation text,
  award_date date,
  expected_completion_date date,
  permanent boolean not null default true,
  evidence_reference text,
  notes text,
  verified_by uuid references public.staff_accounts(id) on delete set null,
  verified_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint qualification_has_date check (award_date is not null or expected_completion_date is not null or notes is not null)
);

create table public.staff_certificates (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  certificate_type text not null,
  custom_title text,
  completion_date date,
  expiry_date date,
  validity_months integer check (validity_months is null or validity_months > 0),
  permanent boolean not null default false,
  evidence_reference text,
  notes text,
  verified_by uuid references public.staff_accounts(id) on delete set null,
  verified_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint certificate_date_order check (expiry_date is null or completion_date is null or expiry_date >= completion_date)
);

create table public.staff_central_records (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null unique references public.staff_profiles(id) on delete restrict,
  appointment_induction_completed boolean not null default false,
  appointment_induction_checked_at date,
  contract_form boolean not null default false,
  contract_form_checked_at date,
  id_checked boolean not null default false,
  id_checked_at date,
  address_evidence_checked boolean not null default false,
  address_evidence_checked_at date,
  additional_employment_tax_evidence_checked boolean not null default false,
  additional_employment_tax_evidence_checked_at date,
  dbs_recorded boolean not null default false,
  dbs_update_service boolean not null default false,
  dbs_last_checked_at date,
  dbs_number_encrypted text,
  dbs_number_last4 text,
  references_complete boolean not null default false,
  references_checked_at date,
  starter_form boolean not null default false,
  starter_form_checked_at date,
  suitability_declaration boolean not null default false,
  suitability_declaration_checked_at date,
  medical_declaration boolean not null default false,
  medical_declaration_checked_at date,
  employee_information_form boolean not null default false,
  employee_information_form_checked_at date,
  checked_by uuid references public.staff_accounts(id) on delete set null,
  checked_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_reference_checks (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  reference_type reference_type not null,
  reference_name text,
  notes text,
  checked_by uuid references public.staff_accounts(id) on delete set null,
  checked_at date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.staff_import_reviews (
  id uuid primary key default gen_random_uuid(),
  source_file_name text not null,
  source_row_reference text,
  proposed_staff_id text,
  staff_name text,
  review_status import_review_status not null,
  warnings text[] not null default '{}',
  imported_staff_id text references public.staff_profiles(id) on delete set null,
  created_by uuid references public.staff_accounts(id) on delete set null,
  created_at timestamptz not null default now()
);

create trigger staff_profiles_updated_at before update on public.staff_profiles for each row execute function public.set_updated_at();
create trigger staff_qualifications_updated_at before update on public.staff_qualifications for each row execute function public.set_updated_at();
create trigger staff_certificates_updated_at before update on public.staff_certificates for each row execute function public.set_updated_at();
create trigger staff_central_records_updated_at before update on public.staff_central_records for each row execute function public.set_updated_at();
create trigger staff_reference_checks_updated_at before update on public.staff_reference_checks for each row execute function public.set_updated_at();

create or replace function public.current_staff_profile_id()
returns text
language sql
security definer
set search_path = public
stable
as $$
  select staff_id from public.current_staff_account();
$$;

alter table public.staff_profiles enable row level security;
alter table public.staff_qualifications enable row level security;
alter table public.staff_certificates enable row level security;
alter table public.staff_central_records enable row level security;
alter table public.staff_reference_checks enable row level security;
alter table public.staff_import_reviews enable row level security;

create policy "Managers can manage staff profiles" on public.staff_profiles for all to authenticated using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Staff can read own basic profile" on public.staff_profiles for select to authenticated using (id = public.current_staff_profile_id() and active = true);

create policy "Managers can manage qualifications" on public.staff_qualifications for all to authenticated using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Staff can read own qualifications" on public.staff_qualifications for select to authenticated using (staff_id = public.current_staff_profile_id() and archived_at is null);

create policy "Managers can manage certificates" on public.staff_certificates for all to authenticated using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Staff can read own certificates" on public.staff_certificates for select to authenticated using (staff_id = public.current_staff_profile_id() and archived_at is null);

create policy "Managers can manage central records" on public.staff_central_records for all to authenticated using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Managers can manage reference checks" on public.staff_reference_checks for all to authenticated using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');
create policy "Managers can manage import reviews" on public.staff_import_reviews for all to authenticated using (public.current_staff_role() = 'manager') with check (public.current_staff_role() = 'manager');

create view public.staff_compliance_summary
with (security_invoker = true)
as
select
  sp.id,
  sp.full_name,
  sp.display_name,
  sp.employment_role,
  sp.main_qualification_level,
  sp.active,
  sp.email,
  sp.auth_user_id,
  cr.dbs_recorded,
  cr.dbs_update_service,
  cr.dbs_last_checked_at,
  cr.dbs_number_last4,
  (
    coalesce(cr.appointment_induction_completed, false)::int +
    coalesce(cr.contract_form, false)::int +
    coalesce(cr.id_checked, false)::int +
    coalesce(cr.address_evidence_checked, false)::int +
    coalesce(cr.additional_employment_tax_evidence_checked, false)::int +
    coalesce(cr.dbs_recorded, false)::int +
    coalesce(cr.references_complete, false)::int +
    coalesce(cr.starter_form, false)::int +
    coalesce(cr.suitability_declaration, false)::int +
    coalesce(cr.medical_declaration, false)::int +
    coalesce(cr.employee_information_form, false)::int
  ) as central_record_completed_count,
  11 as central_record_total_count
from public.staff_profiles sp
left join public.staff_central_records cr on cr.staff_id = sp.id;
