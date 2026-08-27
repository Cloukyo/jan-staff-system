begin;

select plan(8);

create or replace function pg_temp.assert_true(condition boolean, message text)
returns void
language plpgsql
as $$
begin
  if not condition then
    raise exception 'assertion failed: %', message;
  end if;
end;
$$;

select ok(
  (select count(*) = 4 from pg_class relation
   join pg_namespace namespace on namespace.oid = relation.relnamespace
   where namespace.nspname = 'public'
     and relation.relname in (
       'onboarding_sessions', 'onboarding_step_states',
       'onboarding_events', 'onboarding_command_receipts'
     ) and relation.relkind = 'r'),
  'all four onboarding persistence tables exist'
);

select ok(
  (select bool_and(
     has_table_privilege('authenticated', format('public.%I', table_name), 'SELECT')
     and not has_table_privilege('authenticated', format('public.%I', table_name), 'INSERT')
     and not has_table_privilege('authenticated', format('public.%I', table_name), 'UPDATE')
     and not has_table_privilege('authenticated', format('public.%I', table_name), 'DELETE')
   ) from unnest(array[
     'onboarding_sessions', 'onboarding_step_states',
     'onboarding_events', 'onboarding_command_receipts'
   ]) table_name),
  'authenticated receives read-only onboarding table grants'
);

select ok(
  has_function_privilege(
    'authenticated', 'private.can_read_onboarding_session(uuid)', 'EXECUTE'
  ),
  'authenticated can execute the narrow child-table RLS helper'
);

select ok(
  has_function_privilege(
    'authenticated', 'public.execute_onboarding_foundation_command(jsonb)', 'EXECUTE'
  )
  and not has_function_privilege(
    'anon', 'public.execute_onboarding_foundation_command(jsonb)', 'EXECUTE'
  ),
  'only authenticated callers can execute the onboarding command boundary'
);

do $$
declare
  owner_user_id constant uuid := '41000000-0000-4000-8000-000000000001';
  other_user_id constant uuid := '42000000-0000-4000-8000-000000000001';
  organisation_id constant uuid := '41000000-0000-4000-8000-000000000002';
  other_organisation_id constant uuid := '42000000-0000-4000-8000-000000000099';
  membership_id constant uuid := '41000000-0000-4000-8000-000000000003';
  session_id constant uuid := '41000000-0000-4000-8000-000000000004';
  event_id constant uuid := '41000000-0000-4000-8000-000000000005';
  receipt_id constant uuid := '41000000-0000-4000-8000-000000000006';
  idempotency_key constant uuid := '41000000-0000-4000-8000-000000000007';
  bootstrap_session_id constant uuid := '41000000-0000-4000-8000-000000000008';
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values
    ('00000000-0000-0000-0000-000000000000', owner_user_id,
     'authenticated', 'authenticated', 'onboarding-owner@example.invalid', '',
     now(), '{}'::jsonb, '{}'::jsonb, now(), now()),
    ('00000000-0000-0000-0000-000000000000', other_user_id,
     'authenticated', 'authenticated', 'onboarding-other@example.invalid', '',
     now(), '{}'::jsonb, '{}'::jsonb, now(), now());

  insert into public.organisations (id, legal_name, display_name, slug, status)
  values
    (organisation_id, 'Fictional Workflow Limited', 'Fictional Workflow', 'fictional-workflow', 'trial'),
    (other_organisation_id, 'Fictional Boundary Limited', 'Fictional Boundary', 'fictional-boundary', 'trial');

  insert into public.organisation_memberships (
    id, organisation_id, auth_user_id, status, joined_at
  ) values (membership_id, organisation_id, owner_user_id, 'active', now());

  insert into public.membership_role_assignments (
    organisation_id, membership_id, role, scope_type, granted_by_membership_id
  ) values (organisation_id, membership_id, 'organisation_owner', 'organisation', membership_id);

  insert into public.onboarding_sessions (
    id, owner_auth_user_id, organisation_id, workflow_key, workflow_version,
    status, current_step_key, revision
  ) values (
    session_id, owner_user_id, organisation_id, 'commercial_customer_v1', 1,
    'in_progress', 'settings', 0
  );

  insert into public.onboarding_sessions (
    id, owner_auth_user_id, workflow_key, workflow_version,
    status, current_step_key, revision
  ) values (
    bootstrap_session_id, owner_user_id, 'commercial_customer_v1', 1,
    'in_progress', 'owner_account', 0
  );

  begin
    insert into public.onboarding_sessions (
      owner_auth_user_id, workflow_key, workflow_version, status, current_step_key
    ) values (
      other_user_id, 'commercial_customer_v1', 2, 'in_progress', 'owner_account'
    );
    raise exception 'assertion failed: unsupported workflow version unexpectedly succeeded';
  exception when check_violation then null;
  end;

  insert into public.onboarding_step_states (
    session_id, organisation_id, step_key, step_version, status,
    revision, draft_payload, validation_summary
  ) values (
    session_id, organisation_id, 'settings', 1, 'in_progress',
    0, '{}'::jsonb, '[]'::jsonb
  );

  begin
    insert into public.onboarding_step_states (
      session_id, organisation_id, step_key, step_version, status,
      draft_payload, validation_summary
    ) values (
      session_id, other_organisation_id,
      'staff', 1, 'in_progress', '{}'::jsonb, '[]'::jsonb
    );
    raise exception 'assertion failed: cross-organisation step unexpectedly succeeded';
  exception when foreign_key_violation or check_violation then null;
  end;

  begin
    update public.onboarding_sessions set revision = 2 where id = session_id;
    raise exception 'assertion failed: skipped workflow revision unexpectedly succeeded';
  exception when check_violation then null;
  end;

  insert into public.onboarding_events (
    id, session_id, organisation_id, event_type, step_key, actor_type,
    actor_auth_user_id, actor_membership_id, request_id,
    workflow_revision, safe_metadata
  ) values (
    event_id, session_id, organisation_id, 'settings_completed', 'settings', 'owner',
    owner_user_id, membership_id, idempotency_key,
    0, '{"statusCode":"complete","resourceCounts":{"settings":1}}'::jsonb
  );

  begin
    update public.onboarding_events set safe_metadata = '{}'::jsonb where id = event_id;
    raise exception 'assertion failed: onboarding event update unexpectedly succeeded';
  exception when check_violation then null;
  end;

  begin
    insert into public.onboarding_events (
      session_id, organisation_id, event_type, actor_type, workflow_revision, safe_metadata
    ) values (
      session_id, organisation_id, 'readiness_evaluated', 'system', 0,
      '{"email":"not-allowed@example.invalid"}'::jsonb
    );
    raise exception 'assertion failed: unsafe event metadata unexpectedly succeeded';
  exception when check_violation then null;
  end;

  insert into public.onboarding_command_receipts (
    id, session_id, organisation_id, command_type, idempotency_key,
    request_hash, status
  ) values (
    receipt_id, session_id, organisation_id, 'save_settings', idempotency_key,
    repeat('a', 64), 'processing'
  );

  begin
    insert into public.onboarding_command_receipts (
      session_id, organisation_id, command_type, idempotency_key,
      request_hash, status
    ) values (
      session_id, organisation_id, 'save_settings', idempotency_key,
      repeat('b', 64), 'processing'
    );
    raise exception 'assertion failed: duplicate command idempotency key unexpectedly succeeded';
  exception when unique_violation then null;
  end;

  update public.onboarding_command_receipts
  set status = 'succeeded', result_code = 'settings_saved',
      result_reference = '{"siteId":"41000000-0000-4000-8000-000000000099"}'::jsonb,
      result_outcome = 'succeeded', result_data_state = 'saved',
      result_session_revision = 0, result_issues = '[]'::jsonb,
      completed_at = now()
  where id = receipt_id;
  begin
    update public.onboarding_command_receipts
    set result_code = 'changed_result' where id = receipt_id;
    raise exception 'assertion failed: terminal command result unexpectedly changed';
  exception when check_violation then null;
  end;
end;
$$;

select pass('version, tenant, revision, append-only, metadata and replay constraints hold');

select set_config('request.jwt.claim.sub', '41000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare
  command_response jsonb;
begin
  perform pg_temp.assert_true(
    (select count(*) from public.onboarding_sessions
     where id in (
       '41000000-0000-4000-8000-000000000004',
       '41000000-0000-4000-8000-000000000008'
     )) = 2,
    'owner must read both owned bootstrap and authorised organisation sessions'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.onboarding_step_states
     where session_id = '41000000-0000-4000-8000-000000000004') = 1,
    'authorised owner must read onboarding child state'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.onboarding_events
     where session_id = '41000000-0000-4000-8000-000000000004') = 1,
    'authorised owner must read onboarding events'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.onboarding_command_receipts
     where session_id = '41000000-0000-4000-8000-000000000004') = 1,
    'authorised owner must read onboarding command receipts'
  );
  select public.execute_onboarding_foundation_command(jsonb_build_object(
    'schemaVersion', 1,
    'workflowKey', 'commercial_customer_v1',
    'workflowVersion', 1,
    'sessionId', '41000000-0000-4000-8000-000000000004',
    'commandType', 'evaluate_readiness',
    'idempotencyKey', '41000000-0000-4000-8000-000000000009',
    'expectedSessionRevision', '0',
    'payload', '{}'::jsonb
  )) into command_response;
  perform pg_temp.assert_true(
    command_response #>> '{commandResult,outcome}' = 'succeeded'
    and command_response #>> '{commandResult,sessionRevision}' = '1'
    and command_response #>> '{readiness,workflowRevision}' = '1',
    'authorised RPC must return the committed revision and authoritative readiness'
  );
  perform pg_temp.assert_true(
    (select count(*) from public.onboarding_events
     where session_id = '41000000-0000-4000-8000-000000000004') = 2,
    'successful RPC must append exactly one event'
  );
  begin
    update public.onboarding_sessions
    set revision = 1 where id = '41000000-0000-4000-8000-000000000004';
    raise exception 'assertion failed: authenticated direct session update unexpectedly succeeded';
  exception when insufficient_privilege then null;
  end;
end;
$$;
reset role;

select pass('owner bootstrap and post-organisation child RLS reads are available without writes');
select pass('authenticated command RPC commits state, receipt, event and readiness atomically');

select set_config('request.jwt.claim.sub', '42000000-0000-4000-8000-000000000001', true);
set local role authenticated;
do $$
declare
  denied_response jsonb;
begin
  perform pg_temp.assert_true(
    (select count(*) from public.onboarding_sessions
     where id in (
       '41000000-0000-4000-8000-000000000004',
       '41000000-0000-4000-8000-000000000008'
     )) = 0,
    'unrelated identity must not read bootstrap or organisation sessions'
  );
  select public.execute_onboarding_foundation_command(jsonb_build_object(
    'schemaVersion', 1,
    'workflowKey', 'commercial_customer_v1',
    'workflowVersion', 1,
    'sessionId', '41000000-0000-4000-8000-000000000004',
    'commandType', 'evaluate_readiness',
    'idempotencyKey', '42000000-0000-4000-8000-000000000009',
    'expectedSessionRevision', '1',
    'payload', '{}'::jsonb
  )) into denied_response;
  perform pg_temp.assert_true(
    denied_response #>> '{commandResult,outcome}' = 'permission_denied'
    and denied_response -> 'readiness' = 'null'::jsonb,
    'unrelated identity must receive no tenant readiness disclosure'
  );
end;
$$;
reset role;

select pass('unrelated identities cannot read onboarding workflow state');
select * from finish();

rollback;
