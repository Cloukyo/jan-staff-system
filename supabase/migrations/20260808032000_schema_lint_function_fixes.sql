-- Correct PL/pgSQL type resolution without rewriting recorded migrations.
-- Function definitions are preserved byte-for-byte apart from the explicit
-- parameter references and enum casts required by PostgreSQL's analyser.

do $migration$
declare
  original_definition text;
  updated_definition text;
begin
  original_definition := pg_get_functiondef('public.set_staff_account_active'::regproc);
  updated_definition := replace(
    original_definition,
    'case when p_active then ''enabled'' else ''disabled'' end,',
    '(case when p_active then ''enabled'' else ''disabled'' end)::public.account_access_action,'
  );
  if updated_definition = original_definition then
    raise exception 'set_staff_account_active lint repair target was not found';
  end if;
  execute updated_definition;

  original_definition := pg_get_functiondef('public.save_commercial_attendance_day_review'::regproc);
  updated_definition := replace(
    original_definition,
    'reason=nullif(btrim(reason),'''')',
    'reason=nullif(btrim($6),'''')'
  );
  if updated_definition = original_definition then
    raise exception 'save_commercial_attendance_day_review lint repair target was not found';
  end if;
  execute updated_definition;

  original_definition := pg_get_functiondef('public.resolve_commercial_attendance_correction_request'::regproc);
  updated_definition := replace(
    original_definition,
    'manager_note=btrim(manager_note)',
    'manager_note=btrim($5)'
  );
  if updated_definition = original_definition then
    raise exception 'resolve_commercial_attendance_correction_request lint repair target was not found';
  end if;
  execute updated_definition;

  original_definition := pg_get_functiondef('public.preview_commercial_payroll_import_batch'::regproc);
  updated_definition := replace(
    original_definition,
    'input_row ->> ''matchConfidence'', input_row ->> ''resolution'',',
    '(input_row ->> ''matchConfidence'')::public.payroll_match_confidence, '
      || '(input_row ->> ''resolution'')::public.payroll_import_resolution,'
  );
  if updated_definition = original_definition then
    raise exception 'preview_commercial_payroll_import_batch match repair target was not found';
  end if;
  original_definition := updated_definition;
  updated_definition := replace(
    original_definition,
    'input_row ->> ''hoursBasis'', nullif(input_row ->> ''effectiveFrom'', '''')::date,',
    '(input_row ->> ''hoursBasis'')::public.payroll_hours_basis, '
      || 'nullif(input_row ->> ''effectiveFrom'', '''')::date,'
  );
  if updated_definition = original_definition then
    raise exception 'preview_commercial_payroll_import_batch hours repair target was not found';
  end if;
  execute updated_definition;

  original_definition := pg_get_functiondef('public.create_commercial_staff_pay_arrangement'::regproc);
  updated_definition := replace(
    original_definition,
    'target_contracted_weekly_hours, target_hours_basis, target_standard_daily_hours,',
    'target_contracted_weekly_hours, target_hours_basis::public.payroll_hours_basis, '
      || 'target_standard_daily_hours,'
  );
  if updated_definition = original_definition then
    raise exception 'create_commercial_staff_pay_arrangement lint repair target was not found';
  end if;
  execute updated_definition;
end;
$migration$;
