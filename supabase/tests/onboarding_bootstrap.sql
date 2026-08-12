begin;

select plan(7);

select ok(
  to_regclass('public.legal_document_versions') is not null
  and to_regclass('public.legal_acceptances') is not null,
  'versioned legal document and immutable acceptance tables exist'
);

select is(
  (select count(*)::bigint from public.legal_document_versions where is_current and locale = 'en-GB'),
  3::bigint,
  'all three required en-GB legal documents have one current version'
);

select ok(
  has_function_privilege('authenticated', 'public.get_or_create_onboarding_bootstrap()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.get_or_create_onboarding_bootstrap()', 'EXECUTE'),
  'only authenticated callers can create or resume a bootstrap session'
);

select ok(
  has_function_privilege('authenticated', 'public.execute_onboarding_bootstrap_command(jsonb)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.execute_onboarding_bootstrap_command(jsonb)', 'EXECUTE'),
  'only authenticated callers can use the guarded bootstrap command boundary'
);

select ok(
  has_table_privilege('authenticated', 'public.legal_acceptances', 'SELECT')
  and not has_table_privilege('authenticated', 'public.legal_acceptances', 'INSERT')
  and not has_table_privilege('authenticated', 'public.legal_acceptances', 'UPDATE')
  and not has_table_privilege('authenticated', 'public.legal_acceptances', 'DELETE'),
  'customer legal acceptance access is read-only outside guarded commands'
);

select ok(
  (select count(*) = 8 from information_schema.columns column_info
   where column_info.table_schema = 'public'
     and column_info.table_name = 'organisations'
     and column_info.column_name in (
       'contact_email', 'contact_phone', 'address_line_1', 'address_line_2',
       'locality', 'region', 'postcode', 'logo_metadata'
     )),
  'organisation bootstrap fields are present without a site dependency'
);

select ok(
  not exists (
    select 1 from information_schema.routine_privileges privilege
    where privilege.specific_schema = 'private'
      and privilege.grantee in ('anon', 'authenticated')
      and privilege.routine_name like 'commercial_onboarding_%'
  ),
  'private bootstrap helpers are not executable by browser roles'
);

select * from finish();
rollback;
