-- Replace the placeholders after creating the manager in Supabase Auth.
-- Do not commit real auth user IDs if they belong to production data.

insert into public.staff_accounts (
  auth_user_id,
  staff_id,
  full_name,
  email,
  role,
  active
)
values (
  '00000000-0000-0000-0000-000000000000',
  'stf-001',
  'Amelia Brooks',
  'manager@example.com',
  'manager',
  true
)
on conflict (staff_id) do update
set
  auth_user_id = excluded.auth_user_id,
  email = excluded.email,
  role = 'manager',
  active = true;
