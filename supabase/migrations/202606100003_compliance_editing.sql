create type evidence_status as enum ('not_required', 'awaiting', 'received', 'verified');
create type checklist_status as enum ('complete', 'incomplete', 'not_applicable');
create type reference_method as enum ('written', 'telephone', 'email');

alter table public.staff_profiles
  add column notes text;

alter table public.staff_qualifications
  add column evidence_status evidence_status not null default 'awaiting';

alter table public.staff_certificates
  add column evidence_status evidence_status not null default 'awaiting';

alter table public.staff_central_records
  add column dbs_issue_date date,
  add column dbs_new_check_required boolean not null default false;

alter table public.staff_reference_checks
  add column method reference_method,
  add column satisfactory boolean;

create table public.staff_central_record_items (
  id uuid primary key default gen_random_uuid(),
  staff_id text not null references public.staff_profiles(id) on delete restrict,
  item_key text not null,
  status checklist_status not null default 'incomplete',
  checked_at date,
  checked_by uuid references public.staff_accounts(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (staff_id, item_key)
);

create trigger staff_central_record_items_updated_at before update on public.staff_central_record_items for each row execute function public.set_updated_at();

alter table public.staff_central_record_items enable row level security;

create policy "Managers can manage central record items"
on public.staff_central_record_items for all
to authenticated
using (public.current_staff_role() = 'manager')
with check (public.current_staff_role() = 'manager');

create or replace view public.staff_compliance_summary
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
  cr.dbs_issue_date,
  cr.dbs_last_checked_at,
  cr.dbs_new_check_required,
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
