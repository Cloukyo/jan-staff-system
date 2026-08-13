-- Commercial Workstream 7C: provider-neutral plan selection and pending trial.
-- The trial clock is intentionally not started here. No payment provider or offline authority is added.

create or replace function private.commercial_feature_highlights_valid(target jsonb)
returns boolean language sql immutable set search_path = '' as $$
  select jsonb_typeof(target) = 'array' and jsonb_array_length(target) between 1 and 8
    and not exists (select 1 from jsonb_array_elements(target) item
      where jsonb_typeof(item) <> 'string' or length(btrim(item #>> '{}')) not between 2 and 120)
$$;

create table public.plans (
  plan_key text not null check (plan_key ~ '^[a-z][a-z0-9_]{1,63}$'),
  plan_version integer not null check (plan_version > 0),
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  summary text not null check (length(btrim(summary)) between 2 and 500),
  country_code text not null check (country_code ~ '^[A-Z]{2}$'),
  trial_duration_days integer not null default 60 check (trial_duration_days = 60),
  pricing_status text not null check (pricing_status in ('preview_unpriced', 'commercially_approved')),
  feature_highlights jsonb not null check (private.commercial_feature_highlights_valid(feature_highlights)),
  active boolean not null default false,
  sellable_from timestamptz not null default now(),
  sellable_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (plan_key, plan_version),
  check (sellable_until is null or sellable_until > sellable_from)
);

create table public.plan_entitlements (
  plan_key text not null,
  plan_version integer not null,
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_.]{1,95}$'),
  value_type text not null check (value_type in ('boolean', 'integer')),
  boolean_value boolean,
  integer_value bigint check (integer_value >= 0),
  created_at timestamptz not null default now(),
  primary key (plan_key, plan_version, capability_key),
  foreign key (plan_key, plan_version) references public.plans(plan_key, plan_version) on delete restrict,
  check ((value_type = 'boolean' and boolean_value is not null and integer_value is null)
      or (value_type = 'integer' and boolean_value is null and integer_value is not null)),
  check (capability_key <> 'attendance.offline' or (value_type = 'boolean' and boolean_value = false))
);

create table public.organisation_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  plan_key text not null,
  plan_version integer not null,
  state text not null check (state in ('trial_pending','trial_active','active','payment_action_required','past_due','cancelled_at_period_end','cancelled','expired','billing_suspended')),
  is_current boolean not null default true,
  ordinary_initial_trial boolean not null default false,
  trial_duration_days integer check (trial_duration_days = 60),
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (organisation_id, id),
  foreign key (plan_key, plan_version) references public.plans(plan_key, plan_version) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (state <> 'trial_pending' or (ordinary_initial_trial and trial_duration_days = 60 and trial_started_at is null and trial_ends_at is null)),
  check (state <> 'trial_active' or (ordinary_initial_trial and trial_duration_days = 60
    and trial_started_at is not null and trial_ends_at = trial_started_at + interval '60 days')),
  check (trial_ends_at is null or (trial_started_at is not null and trial_ends_at > trial_started_at))
);
create unique index organisation_subscriptions_current_key on public.organisation_subscriptions(organisation_id) where is_current;
create unique index organisation_subscriptions_initial_trial_key on public.organisation_subscriptions(organisation_id) where ordinary_initial_trial;

create table public.organisation_subscription_state_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null,
  subscription_id uuid not null,
  from_state text,
  to_state text not null,
  reason_code text not null check (reason_code ~ '^[a-z][a-z0-9_]{1,95}$'),
  actor_auth_user_id uuid,
  actor_membership_id uuid,
  occurred_at timestamptz not null default now(),
  foreign key (organisation_id, subscription_id) references public.organisation_subscriptions(organisation_id, id) on delete restrict,
  foreign key (organisation_id, actor_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  check (from_state is null or from_state in ('trial_pending','trial_active','active','payment_action_required','past_due','cancelled_at_period_end','cancelled','expired','billing_suspended')),
  check (to_state in ('trial_pending','trial_active','active','payment_action_required','past_due','cancelled_at_period_end','cancelled','expired','billing_suspended'))
);

create table public.organisation_entitlements (
  organisation_id uuid not null,
  subscription_id uuid not null,
  capability_key text not null check (capability_key ~ '^[a-z][a-z0-9_.]{1,95}$'),
  value_type text not null check (value_type in ('boolean', 'integer')),
  boolean_value boolean,
  integer_value bigint check (integer_value >= 0),
  source_plan_key text not null,
  source_plan_version integer not null,
  effective_at timestamptz not null default now(),
  superseded_at timestamptz,
  primary key (organisation_id, subscription_id, capability_key),
  foreign key (organisation_id, subscription_id) references public.organisation_subscriptions(organisation_id, id) on delete restrict,
  foreign key (source_plan_key, source_plan_version, capability_key)
    references public.plan_entitlements(plan_key, plan_version, capability_key) on delete restrict,
  check ((value_type = 'boolean' and boolean_value is not null and integer_value is null)
      or (value_type = 'integer' and boolean_value is null and integer_value is not null)),
  check (capability_key <> 'attendance.offline' or (value_type = 'boolean' and boolean_value = false))
);

create table public.organisation_usage (
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  usage_key text not null check (usage_key ~ '^[a-z][a-z0-9_.]{1,95}$'),
  quantity bigint not null default 0 check (quantity >= 0),
  measured_at timestamptz not null default now(),
  primary key (organisation_id, usage_key)
);

insert into public.plans (plan_key, plan_version, display_name, summary, country_code, pricing_status, feature_highlights, active)
values ('preview_standard', 1, 'Preview Standard', 'Fictional commercial Preview plan for validating onboarding and entitlement architecture.',
  'GB', 'preview_unpriced', '["Core attendance","Up to 75 active staff","Up to 3 active sites"]', true);

insert into public.plan_entitlements (plan_key, plan_version, capability_key, value_type, boolean_value, integer_value) values
  ('preview_standard',1,'attendance.core','boolean',true,null),
  ('preview_standard',1,'attendance.offline','boolean',false,null),
  ('preview_standard',1,'onboarding.configure','boolean',true,null),
  ('preview_standard',1,'sites.active.limit','integer',null,3),
  ('preview_standard',1,'staff.active.limit','integer',null,75),
  ('preview_standard',1,'members.privileged.limit','integer',null,10),
  ('preview_standard',1,'storage.bytes.limit','integer',null,5368709120),
  ('preview_standard',1,'exports.advanced','boolean',true,null),
  ('preview_standard',1,'api.monthly.limit','integer',null,10000);

alter table public.plans enable row level security;
alter table public.plan_entitlements enable row level security;
alter table public.organisation_subscriptions enable row level security;
alter table public.organisation_subscription_state_events enable row level security;
alter table public.organisation_entitlements enable row level security;
alter table public.organisation_usage enable row level security;

revoke all on public.plans, public.plan_entitlements, public.organisation_subscriptions,
  public.organisation_subscription_state_events, public.organisation_entitlements, public.organisation_usage from public, anon, authenticated;
grant select on public.organisation_subscriptions, public.organisation_subscription_state_events,
  public.organisation_entitlements, public.organisation_usage to authenticated;

create policy organisation_subscriptions_select on public.organisation_subscriptions for select to authenticated
using ((select private.has_permission(organisation_id, 'billing.manage')));
create policy organisation_entitlements_select on public.organisation_entitlements for select to authenticated
using ((select private.has_permission(organisation_id, 'billing.manage')));
create policy organisation_subscription_state_events_select on public.organisation_subscription_state_events for select to authenticated
using ((select private.has_permission(organisation_id, 'billing.manage')));
create policy organisation_usage_select on public.organisation_usage for select to authenticated
using ((select private.has_permission(organisation_id, 'billing.manage')));

create or replace function private.prevent_published_plan_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'published plan versions and entitlements are immutable; publish a new version' using errcode = '23514';
end;
$$;
create trigger plans_prevent_published_mutation before update or delete on public.plans
for each row execute function private.prevent_published_plan_mutation();
create trigger plan_entitlements_prevent_published_mutation before update or delete on public.plan_entitlements
for each row execute function private.prevent_published_plan_mutation();

create or replace function private.protect_commercial_subscription_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'subscription history is append-only' using errcode = '23514';
  end if;
  if new.organisation_id is distinct from old.organisation_id
     or new.plan_key is distinct from old.plan_key
     or new.plan_version is distinct from old.plan_version
     or new.ordinary_initial_trial is distinct from old.ordinary_initial_trial
     or new.trial_duration_days is distinct from old.trial_duration_days
     or new.created_by_membership_id is distinct from old.created_by_membership_id
     or new.created_at is distinct from old.created_at
     or (old.trial_started_at is not null and new.trial_started_at is distinct from old.trial_started_at)
     or (old.trial_ends_at is not null and new.trial_ends_at is distinct from old.trial_ends_at) then
    raise exception 'subscription identity and trial history are immutable' using errcode = '23514';
  end if;
  if (new.state is distinct from old.state or new.is_current is distinct from old.is_current or new.ended_at is distinct from old.ended_at)
     and coalesce(current_setting('app.commercial_subscription_transition', true), '') <> old.id::text then
    raise exception 'subscription lifecycle changes require the audited transition boundary' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger organisation_subscriptions_protect_history
before update or delete on public.organisation_subscriptions for each row
execute function private.protect_commercial_subscription_history();

create or replace function private.record_commercial_subscription_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' or new.state is distinct from old.state or new.is_current is distinct from old.is_current or new.ended_at is distinct from old.ended_at then
    insert into public.organisation_subscription_state_events(
      organisation_id,subscription_id,from_state,to_state,reason_code,actor_auth_user_id,actor_membership_id
    ) values (
      new.organisation_id,new.id,case when tg_op='INSERT' then null else old.state end,new.state,
      case when tg_op='INSERT' then 'subscription_created' else coalesce(nullif(current_setting('app.commercial_subscription_reason',true),''),'transition_unspecified') end,
      auth.uid(),case when tg_op='INSERT' then new.created_by_membership_id else nullif(current_setting('app.commercial_subscription_actor_membership',true),'')::uuid end
    );
  end if;
  return new;
end;
$$;
create trigger organisation_subscriptions_record_state
after insert or update on public.organisation_subscriptions for each row
execute function private.record_commercial_subscription_state();

create or replace function private.prevent_commercial_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'commercial subscription state events are append-only' using errcode = '23514';
end;
$$;
create trigger organisation_subscription_state_events_prevent_mutation
before update or delete on public.organisation_subscription_state_events for each row
execute function private.prevent_commercial_history_mutation();

create or replace function private.transition_commercial_subscription(
  target_subscription_id uuid,
  expected_state text,
  next_state text,
  next_is_current boolean,
  next_trial_started_at timestamptz,
  next_trial_ends_at timestamptz,
  next_ended_at timestamptz,
  transition_reason_code text,
  actor_membership_id uuid
) returns public.organisation_subscriptions language plpgsql security definer set search_path = '' as $$
declare target public.organisation_subscriptions%rowtype;
begin
  if transition_reason_code !~ '^[a-z][a-z0-9_]{1,95}$' then raise exception 'invalid transition reason' using errcode='22023'; end if;
  select * into target from public.organisation_subscriptions where id=target_subscription_id for update;
  if not found or target.state <> expected_state then raise exception 'subscription state changed' using errcode='40001'; end if;
  if not exists(select 1 from public.organisation_memberships membership where membership.organisation_id=target.organisation_id
    and membership.id=actor_membership_id and membership.status='active' and private.has_permission(target.organisation_id,'billing.manage')) then
    raise exception 'billing authority required' using errcode='42501';
  end if;
  perform set_config('app.commercial_subscription_transition',target.id::text,true);
  perform set_config('app.commercial_subscription_reason',transition_reason_code,true);
  perform set_config('app.commercial_subscription_actor_membership',actor_membership_id::text,true);
  update public.organisation_subscriptions set state=next_state,is_current=next_is_current,
    trial_started_at=next_trial_started_at,trial_ends_at=next_trial_ends_at,ended_at=next_ended_at,updated_at=now()
    where id=target.id returning * into target;
  return target;
end;
$$;

create or replace function private.validate_organisation_entitlement_source()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.organisation_subscriptions subscription
    join public.plan_entitlements entitlement
      on entitlement.plan_key = subscription.plan_key and entitlement.plan_version = subscription.plan_version
     and entitlement.capability_key = new.capability_key
    where subscription.organisation_id = new.organisation_id and subscription.id = new.subscription_id
      and new.source_plan_key = subscription.plan_key and new.source_plan_version = subscription.plan_version
      and new.value_type = entitlement.value_type
      and new.boolean_value is not distinct from entitlement.boolean_value
      and new.integer_value is not distinct from entitlement.integer_value
  ) then
    raise exception 'organisation entitlement must exactly match its selected plan source' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger organisation_entitlements_validate_source
before insert or update on public.organisation_entitlements for each row
execute function private.validate_organisation_entitlement_source();

alter table public.onboarding_events drop constraint onboarding_events_event_type_check;
alter table public.onboarding_events add constraint onboarding_events_event_type_check check (event_type in (
  'onboarding_started','signup_started','owner_email_verified','owner_mfa_enrolled','owner_mfa_ready',
  'legal_acceptance_completed','organisation_creation_started','organisation_created','first_site_started',
  'first_site_validation_failed','first_site_defaults_created','first_site_created','plan_selection_started',
  'plan_selected','trial_selected','trial_pending_created','subscription_step_completed','trial_activated',
  'settings_completed','staff_import_started','staff_import_validated','staff_import_committed',
  'manager_invitations_created','staff_invitations_created','kiosk_registration_started','kiosk_connected',
  'readiness_evaluated','go_live_blocked','go_live_completed','restricted_mode_entered','subscription_recovered'
));

create or replace function private.commercial_capability_decision(
  target_organisation_id uuid, requested_capability_key text, decision_context jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  entitlement public.organisation_entitlements%rowtype;
  subscription_state text;
  usage_value bigint := 0;
  requested_units bigint := 1;
  allowed_value boolean := false;
  decision_code_value text := 'subscription_required';
begin
  if decision_context is null or jsonb_typeof(decision_context) <> 'object'
     or exists (select 1 from jsonb_object_keys(decision_context) key where key not in ('requestedUnits'))
     or (decision_context ? 'requestedUnits' and not ((decision_context ->> 'requestedUnits') ~ '^[1-9][0-9]*$')) then
    raise exception 'invalid capability context' using errcode = '22023';
  end if;
  if requested_capability_key = 'attendance.offline' then
    return jsonb_build_object('capabilityKey', requested_capability_key, 'allowed', false,
      'decisionCode', 'offline_disabled', 'limit', null, 'currentUsage', null, 'grantsTenantAccess', false);
  end if;
  select subscription.state into subscription_state from public.organisation_subscriptions subscription
    where subscription.organisation_id = target_organisation_id and subscription.is_current limit 1;
  if not found then
    return jsonb_build_object('capabilityKey', requested_capability_key, 'allowed', false,
      'decisionCode', 'subscription_required', 'limit', null, 'currentUsage', null, 'grantsTenantAccess', false);
  end if;
  if subscription_state not in ('trial_active','active')
     and not (subscription_state = 'trial_pending' and requested_capability_key = 'onboarding.configure') then
    return jsonb_build_object('capabilityKey', requested_capability_key, 'allowed', false,
      'decisionCode', 'subscription_not_eligible', 'limit', null, 'currentUsage', null, 'grantsTenantAccess', false);
  end if;
  select value.* into entitlement from public.organisation_entitlements value
  join public.organisation_subscriptions subscription
    on subscription.organisation_id = value.organisation_id and subscription.id = value.subscription_id
  where value.organisation_id = target_organisation_id and value.capability_key = requested_capability_key
    and value.superseded_at is null and subscription.is_current
  order by value.effective_at desc limit 1;
  if not found then
    return jsonb_build_object('capabilityKey', requested_capability_key, 'allowed', false,
      'decisionCode', 'not_entitled', 'limit', null, 'currentUsage', null, 'grantsTenantAccess', false);
  end if;
  if entitlement.value_type = 'boolean' then
    allowed_value := entitlement.boolean_value;
    decision_code_value := case when allowed_value then 'allowed' else 'not_entitled' end;
    return jsonb_build_object('capabilityKey', requested_capability_key, 'allowed', allowed_value,
      'decisionCode', decision_code_value, 'limit', null, 'currentUsage', null, 'grantsTenantAccess', false);
  end if;
  requested_units := coalesce((decision_context ->> 'requestedUnits')::bigint, 1);
  if requested_capability_key = 'sites.active.limit' then
    select count(*) into usage_value from public.organisation_sites site
      where site.organisation_id = target_organisation_id and site.archived_at is null;
  elsif requested_capability_key = 'staff.active.limit' then
    select count(*) into usage_value from public.staff_profiles staff
      where staff.organisation_id = target_organisation_id and staff.active;
  elsif requested_capability_key = 'members.privileged.limit' then
    select count(distinct membership.id) into usage_value
    from public.organisation_memberships membership
    join public.membership_role_assignments assignment
      on assignment.organisation_id = membership.organisation_id and assignment.membership_id = membership.id
    where membership.organisation_id = target_organisation_id and membership.status = 'active'
      and assignment.revoked_at is null
      and assignment.role in ('organisation_owner','organisation_admin','hr_admin','payroll_admin','site_manager');
  else
    select coalesce(usage.quantity, 0) into usage_value from public.organisation_usage usage
      where usage.organisation_id = target_organisation_id and usage.usage_key = requested_capability_key;
  end if;
  usage_value := coalesce(usage_value, 0);
  allowed_value := usage_value + requested_units <= entitlement.integer_value;
  decision_code_value := case when allowed_value then 'allowed' else 'limit_reached' end;
  return jsonb_build_object('capabilityKey', requested_capability_key, 'allowed', allowed_value,
    'decisionCode', decision_code_value, 'limit', entitlement.integer_value,
    'currentUsage', usage_value, 'grantsTenantAccess', false);
end;
$$;

create or replace function private.commercial_require_capability(
  target_organisation_id uuid, requested_capability_key text, decision_context jsonb default '{}'::jsonb
) returns void language plpgsql stable security definer set search_path = '' as $$
declare decision jsonb;
begin
  decision := private.commercial_capability_decision(target_organisation_id, requested_capability_key, decision_context);
  if not coalesce((decision ->> 'allowed')::boolean, false) then
    raise exception 'commercial capability denied: %', decision ->> 'decisionCode' using errcode = '42501';
  end if;
end;
$$;

create or replace function public.commercial_capability_decision(
  target_organisation_id uuid, requested_capability_key text, decision_context jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not private.is_active_member(target_organisation_id) then
    raise exception 'permission denied' using errcode = '42501';
  end if;
  return private.commercial_capability_decision(target_organisation_id, requested_capability_key, decision_context);
end;
$$;

alter function private.commercial_onboarding_snapshot(uuid) rename to commercial_onboarding_snapshot_7b;
alter function public.get_or_create_onboarding_bootstrap() rename to get_or_create_onboarding_bootstrap_7b;
alter function public.get_or_create_onboarding_bootstrap_7b() set schema private;
alter function public.execute_onboarding_bootstrap_command(jsonb) rename to execute_onboarding_bootstrap_command_7b;
alter function public.execute_onboarding_bootstrap_command_7b(jsonb) set schema private;

create or replace function private.commercial_onboarding_snapshot(target_session_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select private.commercial_onboarding_snapshot_7b(target_session_id)
    || jsonb_build_object(
      'steps', coalesce((select jsonb_agg(jsonb_build_object(
        'stepKey', step.step_key, 'status', step.status, 'revision', step.revision::text,
        'draftPayload', step.draft_payload, 'validationSummary', step.validation_summary
      ) order by case step.step_key when 'owner_security' then 1 when 'legal_acceptance' then 2
        when 'organisation' then 3 when 'first_site' then 4 when 'subscription' then 5 else 99 end)
        from public.onboarding_step_states step where step.session_id = target_session_id
          and step.step_key in ('owner_security','legal_acceptance','organisation','first_site','subscription')), '[]'::jsonb),
      'planCatalogue', coalesce((select jsonb_agg(jsonb_build_object(
        'planKey', plan.plan_key, 'planVersion', plan.plan_version, 'displayName', plan.display_name,
        'summary', plan.summary, 'trialDurationDays', plan.trial_duration_days,
        'pricingStatus', plan.pricing_status,
        'featureHighlights', plan.feature_highlights
      ) order by plan.plan_key, plan.plan_version)
        from public.plans plan join public.onboarding_sessions session on session.id = target_session_id
        join public.organisations organisation on organisation.id = session.organisation_id
        where plan.active and plan.country_code = organisation.country_code and plan.sellable_from <= now()
          and (plan.sellable_until is null or plan.sellable_until > now())), '[]'::jsonb),
      'subscriptionSummary', (select jsonb_build_object(
        'subscriptionId', subscription.id, 'planKey', subscription.plan_key,
        'planVersion', subscription.plan_version, 'planDisplayName', plan.display_name,
        'state', subscription.state, 'trialDurationDays', subscription.trial_duration_days,
        'trialStartedAt', subscription.trial_started_at, 'trialEndsAt', subscription.trial_ends_at)
        from public.onboarding_sessions session
        join public.organisation_subscriptions subscription on subscription.organisation_id = session.organisation_id and subscription.is_current
        join public.plans plan on plan.plan_key = subscription.plan_key and plan.plan_version = subscription.plan_version
        where session.id = target_session_id limit 1)
    )
$$;

create or replace function public.get_or_create_onboarding_bootstrap()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare initial_snapshot jsonb; target_session_id uuid;
begin
  initial_snapshot := private.get_or_create_onboarding_bootstrap_7b();
  target_session_id := (initial_snapshot -> 'session' ->> 'id')::uuid;
  insert into public.onboarding_step_states(session_id, organisation_id, step_key, step_version, status, revision)
  select id, organisation_id, 'subscription', 1, 'not_started', 0 from public.onboarding_sessions where id = target_session_id
  on conflict (session_id, step_key) do nothing;
  return private.commercial_onboarding_snapshot(target_session_id);
end;
$$;

create or replace function public.execute_onboarding_bootstrap_command(command_envelope jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  current_user_id uuid := auth.uid();
  target_session public.onboarding_sessions%rowtype;
  owner_membership public.organisation_memberships%rowtype;
  existing_receipt public.onboarding_command_receipts%rowtype;
  command_receipt public.onboarding_command_receipts%rowtype;
  idempotency_key_value uuid;
  expected_revision_value bigint;
  request_hash_value text;
  payload_value jsonb;
  issues_value jsonb := '[]'::jsonb;
  result_code_value text;
  readiness_value jsonb;
  subscription_id_value uuid;
  selected_plan public.plans%rowtype;
  result_reference_value jsonb := '{}'::jsonb;
begin
  if command_envelope ->> 'commandType' <> 'select_plan' then
    return private.execute_onboarding_bootstrap_command_7b(command_envelope);
  end if;
  if current_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if command_envelope is null or jsonb_typeof(command_envelope) <> 'object'
     or (select count(*) from jsonb_object_keys(command_envelope)) <> 8
     or exists (select 1 from jsonb_object_keys(command_envelope) key where key not in
       ('schemaVersion','workflowKey','workflowVersion','sessionId','commandType','idempotencyKey','expectedSessionRevision','payload'))
     or command_envelope ->> 'schemaVersion' <> '1' or command_envelope ->> 'workflowKey' <> 'commercial_customer_v1'
     or command_envelope ->> 'workflowVersion' <> '1' or jsonb_typeof(command_envelope -> 'payload') <> 'object'
     or not ((command_envelope ->> 'sessionId') ~* '^[0-9a-f-]{36}$')
     or not ((command_envelope ->> 'idempotencyKey') ~* '^[0-9a-f-]{36}$')
     or not ((command_envelope ->> 'expectedSessionRevision') ~ '^(0|[1-9][0-9]*)$') then
    raise exception 'invalid onboarding command envelope' using errcode = '22023';
  end if;
  idempotency_key_value := (command_envelope ->> 'idempotencyKey')::uuid;
  expected_revision_value := (command_envelope ->> 'expectedSessionRevision')::bigint;
  request_hash_value := private.onboarding_request_digest(command_envelope);
  payload_value := command_envelope -> 'payload';
  select * into target_session from public.onboarding_sessions where id = (command_envelope ->> 'sessionId')::uuid for update;
  if not found or target_session.owner_auth_user_id <> current_user_id or target_session.organisation_id is null then
    return private.onboarding_command_response(command_envelope,'permission_denied','not_saved','permission_denied','{}',expected_revision_value,
      jsonb_build_array(jsonb_build_object('code','permission_denied','message','This onboarding command is not available.','fieldPath','[]'::jsonb,'repairRoute',null)),null)
      || jsonb_build_object('bootstrap',null);
  end if;
  select membership.* into owner_membership from public.organisation_memberships membership
    where membership.organisation_id = target_session.organisation_id and membership.auth_user_id = current_user_id
      and membership.status = 'active' and private.has_permission(target_session.organisation_id,'billing.manage') for update;
  if not found then result_code_value := 'billing_access_required'; end if;
  select * into existing_receipt from public.onboarding_command_receipts receipt
    where receipt.session_id = target_session.id and receipt.command_type = 'select_plan' and receipt.idempotency_key = idempotency_key_value;
  if found then
    if existing_receipt.request_hash <> request_hash_value then
      return private.onboarding_command_response(command_envelope,'validation_failed','not_saved','idempotency_key_reused','{}',target_session.revision,
        jsonb_build_array(jsonb_build_object('code','idempotency_key_reused','message','This request key was already used for different onboarding data.','fieldPath',jsonb_build_array('idempotencyKey'),'repairRoute',null)),
        private.onboarding_foundation_readiness(target_session.id,null)) || jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(target_session.id));
    end if;
    if existing_receipt.status in ('succeeded','failed_final') then
      return private.onboarding_command_response(command_envelope,case when existing_receipt.status='succeeded' then 'replayed' else existing_receipt.result_outcome end,
        existing_receipt.result_data_state,existing_receipt.result_code,coalesce(existing_receipt.result_reference,'{}'),existing_receipt.result_session_revision,
        coalesce(existing_receipt.result_issues,'[]'),coalesce(existing_receipt.result_readiness,private.onboarding_foundation_readiness(target_session.id,existing_receipt.id)))
        || jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(target_session.id));
    end if;
  end if;
  insert into public.onboarding_command_receipts(session_id,organisation_id,command_type,idempotency_key,request_hash,status)
    values(target_session.id,target_session.organisation_id,'select_plan',idempotency_key_value,request_hash_value,'processing') returning * into command_receipt;
  if result_code_value is null and target_session.revision <> expected_revision_value then result_code_value := 'stale_session_revision'; end if;
  if result_code_value is null and coalesce(auth.jwt() ->> 'aal','aal1') <> 'aal2' then result_code_value := 'mfa_required'; end if;
  if result_code_value is null and not exists(select 1 from public.onboarding_step_states where session_id=target_session.id and step_key='first_site' and status='complete') then result_code_value := 'first_site_required'; end if;
  if result_code_value is null and ((select count(*) from jsonb_object_keys(payload_value)) <> 3
     or exists(select 1 from jsonb_object_keys(payload_value) key where key not in ('planKey','planVersion','selection'))
     or not ((payload_value ->> 'planKey') ~ '^[a-z][a-z0-9_]{1,63}$')
     or not ((payload_value ->> 'planVersion') ~ '^[1-9][0-9]*$') or payload_value ->> 'selection' <> 'free_trial') then result_code_value := 'invalid_plan_selection'; end if;
  if result_code_value is null then
    select * into selected_plan from public.plans plan join public.organisations organisation on organisation.id=target_session.organisation_id
      where plan.plan_key=payload_value->>'planKey' and plan.plan_version=(payload_value->>'planVersion')::int
        and plan.active and plan.country_code=organisation.country_code and plan.sellable_from<=now()
        and (plan.sellable_until is null or plan.sellable_until>now());
    if not found then result_code_value := 'plan_unavailable'; end if;
  end if;
  if result_code_value is null and exists(select 1 from public.organisation_subscriptions where organisation_id=target_session.organisation_id and ordinary_initial_trial) then
    result_code_value := 'ordinary_trial_already_used';
  end if;
  if result_code_value is null and exists(select 1 from public.organisation_subscriptions where organisation_id=target_session.organisation_id and is_current) then
    result_code_value := 'subscription_not_eligible';
  end if;
  if result_code_value is not null then
    issues_value := jsonb_build_array(jsonb_build_object('code',result_code_value,
      'message',case result_code_value when 'stale_session_revision' then 'Onboarding changed after this page was opened. Reload and try again.' when 'mfa_required' then 'Complete multi-factor authentication before continuing.' when 'billing_access_required' then 'Organisation owner billing access is required.' when 'first_site_required' then 'Complete first-site setup before selecting a plan.' when 'plan_unavailable' then 'This plan is not currently available.' when 'ordinary_trial_already_used' then 'This organisation has already used its ordinary initial trial.' else 'Choose an available plan.' end,
      'fieldPath',case when result_code_value in ('plan_unavailable','invalid_plan_selection') then jsonb_build_array('planKey') else '[]'::jsonb end,
      'repairRoute',case when result_code_value='mfa_required' then '/mfa' when result_code_value='first_site_required' then '/onboarding/site' else '/onboarding/plan' end));
    readiness_value := private.onboarding_foundation_readiness(target_session.id,command_receipt.id);
    update public.onboarding_command_receipts set status='failed_final',result_code=result_code_value,
      result_outcome=case when result_code_value='stale_session_revision' then 'workflow_changed' when result_code_value in ('billing_access_required','mfa_required') then 'permission_denied' else 'validation_failed' end,
      result_data_state='not_saved',result_session_revision=target_session.revision,result_issues=issues_value,result_readiness=readiness_value,completed_at=now() where id=command_receipt.id;
    return private.onboarding_command_response(command_envelope,case when result_code_value='stale_session_revision' then 'workflow_changed' when result_code_value in ('billing_access_required','mfa_required') then 'permission_denied' else 'validation_failed' end,
      'not_saved',result_code_value,'{}',target_session.revision,issues_value,readiness_value) || jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(target_session.id));
  end if;
  insert into public.organisation_subscriptions(organisation_id,plan_key,plan_version,state,is_current,ordinary_initial_trial,trial_duration_days,created_by_membership_id)
    values(target_session.organisation_id,selected_plan.plan_key,selected_plan.plan_version,'trial_pending',true,true,60,owner_membership.id) returning id into subscription_id_value;
  insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,source_plan_key,source_plan_version)
    select target_session.organisation_id,subscription_id_value,capability_key,value_type,boolean_value,integer_value,plan_key,plan_version
    from public.plan_entitlements where plan_key=selected_plan.plan_key and plan_version=selected_plan.plan_version;
  perform private.commercial_require_capability(target_session.organisation_id,'onboarding.configure','{}'::jsonb);
  update public.onboarding_step_states set status='complete',revision=revision+1,draft_payload='{}',validation_summary='[]',
    started_at=coalesce(started_at,now()),completed_at=now(),last_saved_at=now(),completed_by_auth_user_id=current_user_id
    where session_id=target_session.id and step_key='subscription';
  update public.onboarding_sessions set current_step_key='settings',revision=revision+1,last_activity_at=now() where id=target_session.id returning * into target_session;
  insert into public.onboarding_events(session_id,organisation_id,event_type,step_key,actor_type,actor_auth_user_id,actor_membership_id,request_id,workflow_revision,safe_metadata)
    select target_session.id,target_session.organisation_id,event_type,'subscription','owner',current_user_id,owner_membership.id,idempotency_key_value,target_session.revision,
      jsonb_build_object('statusCode',case event_type when 'plan_selected' then 'selected' when 'trial_selected' then 'free_trial' when 'trial_pending_created' then 'trial_pending' else 'complete' end,'planKey',selected_plan.plan_key)
    from unnest(array['plan_selected','trial_selected','trial_pending_created','subscription_step_completed']) event_type;
  result_reference_value := jsonb_build_object('subscriptionId',subscription_id_value);
  readiness_value := private.onboarding_foundation_readiness(target_session.id,command_receipt.id);
  update public.onboarding_command_receipts set status='succeeded',result_code='trial_pending_created',result_outcome='succeeded',result_data_state='saved',
    result_session_revision=target_session.revision,result_reference=result_reference_value,result_issues='[]',result_readiness=readiness_value,completed_at=now() where id=command_receipt.id;
  return private.onboarding_command_response(command_envelope,'succeeded','saved','trial_pending_created',result_reference_value,target_session.revision,'[]',readiness_value)
    || jsonb_build_object('bootstrap',private.commercial_onboarding_snapshot(target_session.id));
end;
$$;

insert into public.onboarding_step_states(session_id,organisation_id,step_key,step_version,status,revision,started_at,completed_at,last_saved_at,completed_by_auth_user_id)
select session.id,session.organisation_id,'subscription',1,
  case when subscription.id is null then 'not_started' else 'complete' end,0,
  case when subscription.id is null then null else subscription.created_at end,
  case when subscription.id is null then null else subscription.created_at end,
  case when subscription.id is null then null else subscription.created_at end,
  case when subscription.id is null then null else session.owner_auth_user_id end
from public.onboarding_sessions session left join public.organisation_subscriptions subscription
  on subscription.organisation_id=session.organisation_id and subscription.is_current
on conflict(session_id,step_key) do nothing;

revoke all on function private.commercial_capability_decision(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.commercial_feature_highlights_valid(jsonb) from public,anon,authenticated,service_role;
revoke all on function private.prevent_published_plan_mutation() from public,anon,authenticated,service_role;
revoke all on function private.prevent_commercial_history_mutation() from public,anon,authenticated,service_role;
revoke all on function private.record_commercial_subscription_state() from public,anon,authenticated,service_role;
revoke all on function private.transition_commercial_subscription(uuid,text,text,boolean,timestamptz,timestamptz,timestamptz,text,uuid) from public,anon,authenticated,service_role;
revoke all on function private.commercial_require_capability(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function private.protect_commercial_subscription_history() from public,anon,authenticated,service_role;
revoke all on function private.validate_organisation_entitlement_source() from public,anon,authenticated,service_role;
revoke all on function private.commercial_onboarding_snapshot_7b(uuid) from public,anon,authenticated,service_role;
revoke all on function private.get_or_create_onboarding_bootstrap_7b() from public,anon,authenticated,service_role;
revoke all on function private.execute_onboarding_bootstrap_command_7b(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.commercial_capability_decision(uuid,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.get_or_create_onboarding_bootstrap() from public,anon,authenticated,service_role;
revoke all on function public.execute_onboarding_bootstrap_command(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commercial_capability_decision(uuid,text,jsonb) to authenticated;
grant execute on function public.get_or_create_onboarding_bootstrap() to authenticated;
grant execute on function public.execute_onboarding_bootstrap_command(jsonb) to authenticated;
