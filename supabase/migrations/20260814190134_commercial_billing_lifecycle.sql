-- Commercial Workstream 9: provider-neutral billing lifecycle with Stripe test-mode integration.
-- Billing state never grants tenant visibility and never enables offline attendance.

alter table public.organisation_subscriptions
  add column provider text check (provider is null or provider = 'stripe'),
  add column provider_subscription_id text,
  add column current_period_started_at timestamptz,
  add column current_period_ends_at timestamptz,
  add column grace_kind text check (grace_kind is null or grace_kind in ('trial_conversion','payment_failure')),
  add column grace_started_at timestamptz,
  add column grace_ends_at timestamptz,
  add column cancel_at_period_end boolean not null default false,
  add column last_provider_event_created_at timestamptz,
  add column last_provider_event_id text,
  add column last_provider_event_priority smallint check (last_provider_event_priority is null or last_provider_event_priority between 10 and 50),
  add column last_provider_subscription_event_created_at timestamptz,
  add column last_provider_subscription_state text check (last_provider_subscription_state is null or length(last_provider_subscription_state) between 3 and 64),
  add column over_limit boolean not null default false,
  add constraint organisation_subscriptions_provider_period_check check (
    current_period_ends_at is null or (current_period_started_at is not null and current_period_ends_at > current_period_started_at)),
  add constraint organisation_subscriptions_grace_check check (
    (grace_kind is null and grace_started_at is null and grace_ends_at is null)
    or (grace_kind is not null and grace_started_at is not null and grace_ends_at > grace_started_at));

create unique index organisation_subscriptions_provider_subscription_key
on public.organisation_subscriptions(provider, provider_subscription_id)
where provider_subscription_id is not null and is_current;

create table public.billing_provider_customers (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  provider text not null check (provider = 'stripe'),
  provider_environment text not null check (provider_environment in ('preview','staging','production')),
  provider_customer_id text not null check (provider_customer_id ~ '^cus_[A-Za-z0-9_]+$'),
  created_at timestamptz not null default now(),
  unique (organisation_id, provider, provider_environment),
  unique (provider, provider_environment, provider_customer_id)
);

create table public.billing_provider_prices (
  provider text not null check (provider='stripe'),
  provider_environment text not null check (provider_environment in ('preview','staging','production')),
  provider_price_id text not null check (provider_price_id ~ '^price_[A-Za-z0-9_]+$'),
  plan_key text not null,
  plan_version integer not null,
  active boolean not null default true,
  recorded_at timestamptz not null default now(),
  primary key(provider,provider_environment,provider_price_id),
  unique(provider,provider_environment,plan_key,plan_version),
  foreign key(plan_key,plan_version) references public.plans(plan_key,plan_version) on delete restrict
);

create table public.billing_checkout_intents (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  subscription_id uuid not null,
  provider_customer_mapping_id uuid not null references public.billing_provider_customers(id) on delete restrict,
  plan_key text not null,
  plan_version integer not null,
  provider_price_id text not null check (provider_price_id ~ '^price_[A-Za-z0-9_]+$'),
  idempotency_key uuid not null,
  request_hash text not null check (length(request_hash) = 64),
  status text not null default 'processing' check (status in ('processing','ready','completed','failed','expired')),
  provider_session_id text check (provider_session_id is null or provider_session_id ~ '^cs_[A-Za-z0-9_]+$'),
  provider_session_url_origin text check (provider_session_url_origin is null or provider_session_url_origin = 'https://checkout.stripe.com'),
  created_by_membership_id uuid not null,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (organisation_id, idempotency_key),
  unique (provider_session_id),
  foreign key (organisation_id, subscription_id) references public.organisation_subscriptions(organisation_id, id) on delete restrict,
  foreign key (organisation_id, created_by_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict,
  foreign key (plan_key, plan_version) references public.plans(plan_key, plan_version) on delete restrict
);
create unique index billing_checkout_intents_one_live_per_organisation
on public.billing_checkout_intents(organisation_id) where status in ('processing','ready');

create table public.billing_webhook_events (
  provider text not null check (provider = 'stripe'),
  provider_environment text not null check (provider_environment in ('preview','staging','production')),
  provider_event_id text not null,
  event_type text not null check (length(event_type) between 3 and 120),
  provider_object_id text,
  provider_event_created_at timestamptz not null,
  received_at timestamptz not null default now(),
  processing_status text not null check (processing_status in ('processing','processed','ignored_stale','ignored_unmapped','failed')),
  organisation_id uuid references public.organisations(id) on delete restrict,
  subscription_id uuid,
  safe_result_code text check (safe_result_code is null or safe_result_code ~ '^[a-z][a-z0-9_]{1,95}$'),
  processed_at timestamptz,
  primary key (provider, provider_environment, provider_event_id),
  foreign key (organisation_id, subscription_id) references public.organisation_subscriptions(organisation_id, id) on delete restrict
);

create table public.billing_lifecycle_events (
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  subscription_id uuid not null,
  event_type text not null check (event_type in (
    'payment_setup_started','subscription_activated','renewal_succeeded','payment_failed','grace_started',
    'restricted_mode_entered','payment_recovered','plan_changed','cancellation_requested','cancellation_resumed','cancellation_effective')),
  source text not null check (source in ('customer','billing_provider','scheduler','support')),
  provider_event_id text,
  actor_auth_user_id uuid,
  actor_membership_id uuid,
  safe_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(safe_metadata) = 'object'),
  occurred_at timestamptz not null default now(),
  foreign key (organisation_id, subscription_id) references public.organisation_subscriptions(organisation_id, id) on delete restrict,
  foreign key (organisation_id, actor_membership_id) references public.organisation_memberships(organisation_id, id) on delete restrict
);
create unique index billing_lifecycle_provider_event_once
on public.billing_lifecycle_events(provider_event_id, event_type) where provider_event_id is not null;

alter table public.billing_provider_customers enable row level security;
alter table public.billing_provider_prices enable row level security;
alter table public.billing_checkout_intents enable row level security;
alter table public.billing_webhook_events enable row level security;
alter table public.billing_lifecycle_events enable row level security;
revoke all on public.billing_provider_customers, public.billing_provider_prices, public.billing_checkout_intents,
  public.billing_webhook_events, public.billing_lifecycle_events from public, anon, authenticated;
grant select on public.billing_provider_customers, public.billing_checkout_intents,
  public.billing_webhook_events, public.billing_lifecycle_events to authenticated;
grant select on public.billing_provider_prices to authenticated;
create policy billing_provider_customers_read on public.billing_provider_customers for select to authenticated
using ((select private.has_permission(organisation_id,'billing.manage')));
create policy billing_provider_prices_read on public.billing_provider_prices for select to authenticated using (true);
create policy billing_checkout_intents_read on public.billing_checkout_intents for select to authenticated
using ((select private.has_permission(organisation_id,'billing.manage')));
create policy billing_webhook_events_read on public.billing_webhook_events for select to authenticated
using (organisation_id is not null and (select private.has_permission(organisation_id,'billing.manage')));
create policy billing_lifecycle_events_read on public.billing_lifecycle_events for select to authenticated
using ((select private.has_permission(organisation_id,'billing.manage')));

create or replace function private.prevent_billing_history_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'billing lifecycle evidence is append-only' using errcode='23514'; end $$;
create trigger billing_lifecycle_events_immutable before update or delete on public.billing_lifecycle_events
for each row execute function private.prevent_billing_history_mutation();
create trigger billing_webhook_events_no_delete before delete on public.billing_webhook_events
for each row execute function private.prevent_billing_history_mutation();

create or replace function private.protect_commercial_subscription_history()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op='DELETE' then raise exception 'subscription history is append-only' using errcode='23514'; end if;
  if new.organisation_id is distinct from old.organisation_id or new.plan_key is distinct from old.plan_key
    or new.plan_version is distinct from old.plan_version or new.ordinary_initial_trial is distinct from old.ordinary_initial_trial
    or new.trial_duration_days is distinct from old.trial_duration_days or new.created_by_membership_id is distinct from old.created_by_membership_id
    or new.created_at is distinct from old.created_at or (old.trial_started_at is not null and new.trial_started_at is distinct from old.trial_started_at)
    or (old.trial_ends_at is not null and new.trial_ends_at is distinct from old.trial_ends_at) then
    raise exception 'subscription identity and trial history are immutable' using errcode='23514';
  end if;
  if (new.state,new.is_current,new.ended_at,new.provider,new.provider_subscription_id,new.current_period_started_at,
      new.current_period_ends_at,new.grace_kind,new.grace_started_at,new.grace_ends_at,new.cancel_at_period_end,
      new.last_provider_event_created_at,new.last_provider_event_id,new.last_provider_event_priority,new.last_provider_subscription_event_created_at,new.last_provider_subscription_state,new.over_limit)
     is distinct from
     (old.state,old.is_current,old.ended_at,old.provider,old.provider_subscription_id,old.current_period_started_at,
      old.current_period_ends_at,old.grace_kind,old.grace_started_at,old.grace_ends_at,old.cancel_at_period_end,
       old.last_provider_event_created_at,old.last_provider_event_id,old.last_provider_event_priority,old.last_provider_subscription_event_created_at,old.last_provider_subscription_state,old.over_limit)
     and coalesce(current_setting('app.commercial_subscription_transition',true),'') <> old.id::text then
    raise exception 'subscription lifecycle changes require the audited transition boundary' using errcode='42501';
  end if;
  return new;
end $$;

create or replace function private.commercial_access_mode(target public.organisation_subscriptions, evaluated_at timestamptz default now())
returns text language sql stable set search_path = '' as $$
  select case
    when target.state='trial_pending' then 'setup'
    when target.state='trial_active' and evaluated_at <= target.trial_ends_at then 'full'
    when target.state='trial_active' and evaluated_at <= target.trial_ends_at + interval '168 hours' then 'grace'
    when target.state='active' and (not target.cancel_at_period_end or target.current_period_ends_at is null or evaluated_at < target.current_period_ends_at) then 'full'
    when target.state in ('past_due','payment_action_required') and target.grace_ends_at is not null and evaluated_at < target.grace_ends_at then 'grace'
    when target.state='cancelled_at_period_end' and target.current_period_ends_at is not null and evaluated_at < target.current_period_ends_at then 'full'
    else 'restricted' end
$$;

create or replace function private.commercial_capability_decision(
  target_organisation_id uuid, requested_capability_key text, decision_context jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare entitlement public.organisation_entitlements%rowtype; subscription public.organisation_subscriptions%rowtype;
  access_mode text; usage_value bigint:=0; requested_units bigint:=1; allowed_value boolean:=false; decision_code_value text:='subscription_required';
  continuity_keys constant text[] := array['attendance.core','attendance.clock_in','attendance.clock_out','attendance.correct','attendance.review','reports.essential','exports.customer','billing.recover'];
  growth_keys constant text[] := array['sites.active.limit','staff.active.limit','members.privileged.limit','kiosks.active.limit','imports.staff','exports.advanced','integrations.configure','premium.mutate'];
begin
  if decision_context is null or jsonb_typeof(decision_context)<>'object'
    or exists(select 1 from jsonb_object_keys(decision_context) key where key not in ('requestedUnits'))
    or (decision_context?'requestedUnits' and not ((decision_context->>'requestedUnits') ~ '^[1-9][0-9]*$')) then
    raise exception 'invalid capability context' using errcode='22023'; end if;
  if requested_capability_key='attendance.offline' then return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',false,'decisionCode','offline_disabled','limit',null,'currentUsage',null,'grantsTenantAccess',false); end if;
  select * into subscription from public.organisation_subscriptions where organisation_id=target_organisation_id and is_current limit 1;
  if not found then return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',false,'decisionCode','subscription_required','limit',null,'currentUsage',null,'grantsTenantAccess',false); end if;
  access_mode:=private.commercial_access_mode(subscription,now());
  if access_mode='setup' and requested_capability_key<>'onboarding.configure' then
    return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',false,'decisionCode','subscription_not_eligible','limit',null,'currentUsage',null,'grantsTenantAccess',false);
  end if;
  if access_mode in ('grace','restricted') and requested_capability_key=any(continuity_keys) then
    return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',true,'decisionCode','allowed_continuity','limit',null,'currentUsage',null,'grantsTenantAccess',false);
  end if;
  if access_mode in ('grace','restricted') and requested_capability_key=any(growth_keys) then
    return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',false,'decisionCode',case when access_mode='grace' then 'grace_growth_blocked' else 'restricted_mode' end,'limit',null,'currentUsage',null,'grantsTenantAccess',false);
  end if;
  select value.* into entitlement from public.organisation_entitlements value
  where value.organisation_id=target_organisation_id and value.subscription_id=subscription.id
    and value.capability_key=requested_capability_key and value.superseded_at is null order by value.effective_at desc limit 1;
  if not found then return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',false,'decisionCode','not_entitled','limit',null,'currentUsage',null,'grantsTenantAccess',false); end if;
  if entitlement.value_type='boolean' then allowed_value:=entitlement.boolean_value;
    return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',allowed_value,'decisionCode',case when allowed_value then 'allowed' else 'not_entitled' end,'limit',null,'currentUsage',null,'grantsTenantAccess',false); end if;
  requested_units:=coalesce((decision_context->>'requestedUnits')::bigint,1);
  if requested_capability_key='sites.active.limit' then select count(*) into usage_value from public.organisation_sites where organisation_id=target_organisation_id and archived_at is null;
  elsif requested_capability_key='staff.active.limit' then select count(*) into usage_value from public.staff_profiles where organisation_id=target_organisation_id and active;
  elsif requested_capability_key='members.privileged.limit' then select count(distinct m.id) into usage_value from public.organisation_memberships m join public.membership_role_assignments r on r.organisation_id=m.organisation_id and r.membership_id=m.id where m.organisation_id=target_organisation_id and m.status='active' and r.revoked_at is null and r.role in ('organisation_owner','organisation_admin','hr_admin','payroll_admin','site_manager');
  elsif requested_capability_key='kiosks.active.limit' then select count(*) into usage_value from public.kiosk_devices where organisation_id=target_organisation_id and active;
  else select coalesce(quantity,0) into usage_value from public.organisation_usage where organisation_id=target_organisation_id and usage_key=requested_capability_key; end if;
  usage_value:=coalesce(usage_value,0); allowed_value:=usage_value+requested_units<=entitlement.integer_value;
  return jsonb_build_object('capabilityKey',requested_capability_key,'allowed',allowed_value,'decisionCode',case when allowed_value then 'allowed' else 'limit_reached' end,'limit',entitlement.integer_value,'currentUsage',usage_value,'grantsTenantAccess',false);
end $$;

create or replace function private.reconcile_commercial_billing(evaluated_at timestamptz default now())
returns integer language plpgsql security definer set search_path = '' as $$
declare target public.organisation_subscriptions%rowtype; changed integer:=0; next_state text; reason text; grace_start timestamptz; grace_end timestamptz;
begin
  for target in select * from public.organisation_subscriptions where is_current and (
    (state='trial_active' and trial_ends_at<evaluated_at) or
    (state in ('past_due','payment_action_required') and grace_ends_at is not null and grace_ends_at<=evaluated_at) or
    (state='cancelled_at_period_end' and cancel_at_period_end and current_period_ends_at is not null and current_period_ends_at<=evaluated_at)) for update skip locked
  loop
    if target.state='trial_active' and evaluated_at<target.trial_ends_at+interval '168 hours' then next_state:='past_due'; reason:='trial_conversion_grace_started'; grace_start:=target.trial_ends_at; grace_end:=target.trial_ends_at+interval '168 hours';
    else next_state:='billing_suspended'; reason:=case when target.state='cancelled_at_period_end' then 'cancellation_effective' else 'grace_expired_restricted' end; grace_start:=target.grace_started_at; grace_end:=target.grace_ends_at; end if;
    perform set_config('app.commercial_subscription_transition',target.id::text,true); perform set_config('app.commercial_subscription_reason',reason,true); perform set_config('app.commercial_subscription_actor_membership','',true);
    update public.organisation_subscriptions set state=next_state,grace_kind=case when reason='trial_conversion_grace_started' then 'trial_conversion' else grace_kind end,
      grace_started_at=grace_start,grace_ends_at=grace_end,ended_at=case when next_state='billing_suspended' then evaluated_at else ended_at end,updated_at=evaluated_at where id=target.id;
    insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,safe_metadata)
      values(target.organisation_id,target.id,case when next_state='past_due' then 'grace_started' else case when reason='cancellation_effective' then 'cancellation_effective' else 'restricted_mode_entered' end end,'scheduler',jsonb_build_object('reasonCode',reason));
    changed:=changed+1;
  end loop; return changed;
end $$;

create or replace function private.commercial_plan_over_limit(target_organisation_id uuid,target_plan_key text,target_plan_version integer)
returns boolean language sql stable security definer set search_path='' as $$
  select exists(
    select 1 from public.plan_entitlements entitlement
    where entitlement.plan_key=target_plan_key and entitlement.plan_version=target_plan_version and entitlement.value_type='integer'
      and entitlement.integer_value < case entitlement.capability_key
        when 'sites.active.limit' then (select count(*) from public.organisation_sites where organisation_id=target_organisation_id and archived_at is null)
        when 'staff.active.limit' then (select count(*) from public.staff_profiles where organisation_id=target_organisation_id and active)
        when 'members.privileged.limit' then (select count(distinct m.id) from public.organisation_memberships m join public.membership_role_assignments r on r.organisation_id=m.organisation_id and r.membership_id=m.id where m.organisation_id=target_organisation_id and m.status='active' and r.revoked_at is null and r.role in('organisation_owner','organisation_admin','hr_admin','payroll_admin','site_manager'))
        when 'kiosks.active.limit' then (select count(*) from public.kiosk_devices where organisation_id=target_organisation_id and active)
        else (select coalesce(quantity,0) from public.organisation_usage where organisation_id=target_organisation_id and usage_key=entitlement.capability_key)
      end
  )
$$;

create or replace function public.commercial_billing_snapshot(target_organisation_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare subscription public.organisation_subscriptions%rowtype; plan public.plans%rowtype;
begin
  if auth.uid() is null or not private.has_permission(target_organisation_id,'billing.manage') then raise exception 'billing authority required' using errcode='42501'; end if;
  select * into subscription from public.organisation_subscriptions where organisation_id=target_organisation_id and is_current;
  if not found then raise exception 'current subscription unavailable' using errcode='P0002'; end if;
  select * into plan from public.plans where plan_key=subscription.plan_key and plan_version=subscription.plan_version;
  return jsonb_build_object('organisationId',target_organisation_id,'accessMode',private.commercial_access_mode(subscription,now()),'state',subscription.state,
    'plan',jsonb_build_object('key',plan.plan_key,'version',plan.plan_version,'displayName',plan.display_name),'trialEndsAt',subscription.trial_ends_at,
    'currentPeriodEndsAt',subscription.current_period_ends_at,'graceEndsAt',case when subscription.state='trial_active' and now()>subscription.trial_ends_at then subscription.trial_ends_at+interval '168 hours' else subscription.grace_ends_at end,
    'cancelAtPeriodEnd',subscription.cancel_at_period_end,'overLimit',subscription.over_limit,
    'providerCustomerReady',exists(select 1 from public.billing_provider_customers where organisation_id=target_organisation_id),
    'providerSubscriptionReady',subscription.provider_subscription_id is not null,
    'noticeCode',case when private.commercial_access_mode(subscription,now())='restricted' then 'restricted'
      when private.commercial_access_mode(subscription,now())='grace' then 'grace'
      when subscription.state='trial_active' and subscription.trial_ends_at<=now()+interval '14 days' then 'trial_ending' else 'none' end,
    'availablePlans',(select coalesce(jsonb_agg(jsonb_build_object('key',candidate.plan_key,'version',candidate.plan_version,'displayName',candidate.display_name,'summary',candidate.summary) order by candidate.display_name,candidate.plan_version),'[]'::jsonb)
      from public.plans candidate join public.organisations organisation on organisation.id=target_organisation_id
      where candidate.active and candidate.country_code=organisation.country_code and candidate.sellable_from<=now() and(candidate.sellable_until is null or candidate.sellable_until>now())));
end $$;

create or replace function public.commercial_record_provider_customer(
  target_organisation_id uuid, actor_membership_id uuid, target_environment text, target_provider_customer_id text
) returns uuid language plpgsql security definer set search_path = '' as $$
declare mapping_id uuid;
begin
  if target_environment not in ('preview','staging','production') or target_provider_customer_id !~ '^cus_[A-Za-z0-9_]+$' then raise exception 'invalid provider customer mapping' using errcode='22023'; end if;
  if not exists(select 1 from public.organisation_memberships m
    join public.membership_role_assignments r on r.organisation_id=m.organisation_id and r.membership_id=m.id and r.revoked_at is null
    join private.role_permissions p on p.role=r.role and p.permission='billing.manage'
    where m.organisation_id=target_organisation_id and m.id=actor_membership_id and m.status='active' and r.scope_type='organisation' and r.site_id is null) then
    raise exception 'billing authority required' using errcode='42501'; end if;
  insert into public.billing_provider_customers(organisation_id,provider,provider_environment,provider_customer_id)
  values(target_organisation_id,'stripe',target_environment,target_provider_customer_id)
  on conflict(organisation_id,provider,provider_environment) do update set provider_customer_id=case
    when public.billing_provider_customers.provider_customer_id=excluded.provider_customer_id then excluded.provider_customer_id
    else public.billing_provider_customers.provider_customer_id end
  returning id into mapping_id;
  if (select provider_customer_id from public.billing_provider_customers where id=mapping_id)<>target_provider_customer_id then raise exception 'provider customer mapping conflict' using errcode='23505'; end if;
  return mapping_id;
end $$;

create or replace function public.commercial_record_provider_price(
  target_environment text,target_plan_key text,target_plan_version integer,target_provider_price_id text
) returns void language plpgsql security definer set search_path='' as $$
begin
  if target_environment not in('preview','staging','production') or target_provider_price_id !~ '^price_[A-Za-z0-9_]+$'
    or not exists(select 1 from public.plans where plan_key=target_plan_key and plan_version=target_plan_version) then raise exception 'invalid provider price mapping' using errcode='22023'; end if;
  insert into public.billing_provider_prices(provider,provider_environment,provider_price_id,plan_key,plan_version)
  values('stripe',target_environment,target_provider_price_id,target_plan_key,target_plan_version)
  on conflict(provider,provider_environment,provider_price_id) do update set active=true
  where billing_provider_prices.plan_key=excluded.plan_key and billing_provider_prices.plan_version=excluded.plan_version;
  if not found then raise exception 'provider price mapping conflict' using errcode='23505'; end if;
end $$;

create or replace function public.commercial_prepare_checkout_intent(
  target_organisation_id uuid, actor_membership_id uuid, target_environment text, target_plan_key text,
  target_plan_version integer, target_price_id text, target_idempotency_key uuid, target_request_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare mapping public.billing_provider_customers%rowtype; subscription public.organisation_subscriptions%rowtype; intent public.billing_checkout_intents%rowtype;
begin
  if target_environment not in ('preview','staging','production') or target_price_id !~ '^price_[A-Za-z0-9_]+$' or target_request_hash !~ '^[0-9a-f]{64}$' then raise exception 'invalid checkout intent' using errcode='22023'; end if;
  if not exists(select 1 from public.organisation_memberships m
    join public.membership_role_assignments r on r.organisation_id=m.organisation_id and r.membership_id=m.id and r.revoked_at is null
    join private.role_permissions p on p.role=r.role and p.permission='billing.manage'
    where m.organisation_id=target_organisation_id and m.id=actor_membership_id and m.status='active' and r.scope_type='organisation' and r.site_id is null) then raise exception 'billing authority required' using errcode='42501'; end if;
  select * into mapping from public.billing_provider_customers where organisation_id=target_organisation_id and provider='stripe' and provider_environment=target_environment;
  if not found then raise exception 'provider customer unavailable' using errcode='P0002'; end if;
  select * into subscription from public.organisation_subscriptions where organisation_id=target_organisation_id and is_current for update;
  if not found or not exists(select 1 from public.plans where plan_key=target_plan_key and plan_version=target_plan_version and active) then raise exception 'billing plan unavailable' using errcode='P0002'; end if;
  if subscription.provider_subscription_id is not null then raise exception 'existing provider subscription must be recovered through the billing portal' using errcode='23505'; end if;
  update public.billing_checkout_intents set status='expired'
  where organisation_id=target_organisation_id and status in ('processing','ready') and created_at<now()-interval '24 hours';
  select * into intent from public.billing_checkout_intents where organisation_id=target_organisation_id and idempotency_key=target_idempotency_key;
  if found then
    if intent.request_hash<>target_request_hash then raise exception 'billing idempotency key reused' using errcode='23505'; end if;
  else
    select * into intent from public.billing_checkout_intents
    where organisation_id=target_organisation_id and status in ('processing','ready') for update;
    if found then
      if intent.request_hash<>target_request_hash then raise exception 'billing checkout already in progress' using errcode='23505'; end if;
    else
    insert into public.billing_checkout_intents(organisation_id,subscription_id,provider_customer_mapping_id,plan_key,plan_version,provider_price_id,idempotency_key,request_hash,created_by_membership_id)
    values(target_organisation_id,subscription.id,mapping.id,target_plan_key,target_plan_version,target_price_id,target_idempotency_key,target_request_hash,actor_membership_id) returning * into intent;
    insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,actor_auth_user_id,actor_membership_id,safe_metadata)
    values(target_organisation_id,subscription.id,'payment_setup_started','customer',(select auth_user_id from public.organisation_memberships where id=actor_membership_id),actor_membership_id,jsonb_build_object('planKey',target_plan_key,'planVersion',target_plan_version));
    end if;
  end if;
  return jsonb_build_object('intentId',intent.id,'providerCustomerId',mapping.provider_customer_id,'status',intent.status,'providerSessionId',intent.provider_session_id);
end $$;

create or replace function public.commercial_complete_checkout_intent(target_intent_id uuid, target_provider_session_id text, target_url_origin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if target_provider_session_id !~ '^cs_[A-Za-z0-9_]+$' or target_url_origin<>'https://checkout.stripe.com' then raise exception 'invalid hosted checkout result' using errcode='22023'; end if;
  update public.billing_checkout_intents set status='ready',provider_session_id=target_provider_session_id,provider_session_url_origin=target_url_origin
  where id=target_intent_id and status in ('processing','ready') and (provider_session_id is null or provider_session_id=target_provider_session_id);
  if not found then raise exception 'checkout intent changed' using errcode='40001'; end if;
end $$;

create or replace function public.commercial_process_billing_event(target_environment text, event jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare event_id text:=event->>'id'; event_type text:=event->>'type'; customer_id text:=event->>'customerId'; provider_subscription_value text:=event->>'subscriptionId';
  event_created timestamptz:=to_timestamp((event->>'created')::bigint); mapping public.billing_provider_customers%rowtype;
  subscription public.organisation_subscriptions%rowtype; intent public.billing_checkout_intents%rowtype; next_state text; lifecycle_type text; result_code text:='processed';
  period_start timestamptz; period_end timestamptz; event_cancel boolean; event_price text;
  mapped_price public.billing_provider_prices%rowtype; replacement_id uuid; usage_over_limit boolean:=false; existing_status text;
  actionable_event boolean:=false; provider_state text:=event->>'providerState'; grace_start_value timestamptz; grace_end_value timestamptz; grace_kind_value text; event_priority smallint:=10;
begin
  if target_environment not in ('preview','staging','production') or event_id is null or event_type is null or coalesce((event->>'livemode')::boolean,true) then raise exception 'invalid or live billing event' using errcode='22023'; end if;
  insert into public.billing_webhook_events(provider,provider_environment,provider_event_id,event_type,provider_object_id,provider_event_created_at,processing_status)
  values('stripe',target_environment,event_id,event_type,event->>'objectId',event_created,'processing') on conflict do nothing;
  if not found then
    select processing_status into existing_status from public.billing_webhook_events
    where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id for update;
    if existing_status<>'failed' then return 'duplicate'; end if;
    update public.billing_webhook_events set processing_status='processing',safe_result_code=null,processed_at=null
    where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id;
  end if;
  begin
  select * into mapping from public.billing_provider_customers where provider='stripe' and provider_environment=target_environment and provider_customer_id=customer_id;
  if not found then update public.billing_webhook_events set processing_status='ignored_unmapped',safe_result_code='customer_unmapped',processed_at=now() where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id; return 'customer_unmapped'; end if;
  select * into subscription from public.organisation_subscriptions where organisation_id=mapping.organisation_id and is_current for update;
  if not found then update public.billing_webhook_events set organisation_id=mapping.organisation_id,processing_status='ignored_unmapped',safe_result_code='subscription_unmapped',processed_at=now() where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id; return 'subscription_unmapped'; end if;
  update public.billing_webhook_events set organisation_id=mapping.organisation_id,subscription_id=subscription.id where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id;
  if subscription.provider_subscription_id is not null and provider_subscription_value is distinct from subscription.provider_subscription_id then
    update public.billing_webhook_events set processing_status='ignored_unmapped',safe_result_code='subscription_mismatch',processed_at=now() where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id;
    return 'subscription_mismatch';
  end if;
  period_start:=case when (event->>'periodStart') ~ '^[0-9]+$' then to_timestamp((event->>'periodStart')::bigint) end;
  period_end:=case when (event->>'periodEnd') ~ '^[0-9]+$' then to_timestamp((event->>'periodEnd')::bigint) end;
  event_cancel:=case when jsonb_typeof(event->'cancelAtPeriodEnd')='boolean' then (event->>'cancelAtPeriodEnd')::boolean end;
  event_price:=event->>'priceId';
  actionable_event:=event_type in ('invoice.paid','invoice.payment_succeeded','invoice.payment_failed','customer.subscription.deleted')
    or (event_type='customer.subscription.updated' and (event_cancel is true or provider_state in ('past_due','unpaid')
      or (event_cancel is false and subscription.state='cancelled_at_period_end' and provider_state in ('active','trialing'))));
  event_priority:=case when event_type='customer.subscription.deleted' then 50
    when event_type='customer.subscription.updated' and event_cancel is true then 40
    when event_type='customer.subscription.updated' and event_cancel is false and subscription.state='cancelled_at_period_end' then 35
    when event_type in ('invoice.paid','invoice.payment_succeeded') then 30
    when event_type='invoice.payment_failed' or (event_type='customer.subscription.updated' and provider_state in ('past_due','unpaid')) then 20
    else 10 end;
  if (event_type in ('customer.subscription.created','customer.subscription.updated','customer.subscription.deleted')
      and subscription.last_provider_subscription_event_created_at is not null and event_created<subscription.last_provider_subscription_event_created_at)
    or (event_type='invoice.payment_failed' and subscription.last_provider_subscription_event_created_at>event_created
      and subscription.last_provider_subscription_state in ('active','trialing'))
    or (event_type in ('invoice.paid','invoice.payment_succeeded') and subscription.last_provider_subscription_event_created_at>event_created
      and subscription.last_provider_subscription_state in ('past_due','unpaid','canceled'))
    or (actionable_event and subscription.last_provider_event_created_at is not null and (event_created<subscription.last_provider_event_created_at
    or (event_created=subscription.last_provider_event_created_at and coalesce(subscription.last_provider_event_priority,10)>=event_priority))) then
    update public.billing_webhook_events set processing_status='ignored_stale',safe_result_code='stale_provider_event',processed_at=now() where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id; return 'stale_provider_event'; end if;
  if event_price is not null then select * into mapped_price from public.billing_provider_prices where provider='stripe' and provider_environment=target_environment and provider_price_id=event_price and active; end if;
  if event_type in ('invoice.paid','invoice.payment_succeeded')
    and subscription.state<>'cancelled'
    and not (subscription.state='trial_active' and subscription.trial_ends_at>event_created)
    and mapped_price.provider_price_id is not null and (mapped_price.plan_key,mapped_price.plan_version) is distinct from (subscription.plan_key,subscription.plan_version) then
    perform set_config('app.commercial_subscription_transition',subscription.id::text,true); perform set_config('app.commercial_subscription_reason','provider_plan_changed',true); perform set_config('app.commercial_subscription_actor_membership','',true);
    update public.organisation_subscriptions set is_current=false,ended_at=event_created,last_provider_event_created_at=event_created,last_provider_event_id=event_id,last_provider_event_priority=event_priority,updated_at=now() where id=subscription.id;
    usage_over_limit:=private.commercial_plan_over_limit(subscription.organisation_id,mapped_price.plan_key,mapped_price.plan_version);
    insert into public.organisation_subscriptions(organisation_id,plan_key,plan_version,state,is_current,ordinary_initial_trial,trial_duration_days,created_by_membership_id,provider,provider_subscription_id,current_period_started_at,current_period_ends_at,cancel_at_period_end,last_provider_event_created_at,last_provider_event_id,last_provider_event_priority,over_limit)
    values(subscription.organisation_id,mapped_price.plan_key,mapped_price.plan_version,case when subscription.state='cancelled_at_period_end' then 'cancelled_at_period_end' else 'active' end,true,false,null,subscription.created_by_membership_id,'stripe',coalesce(provider_subscription_value,subscription.provider_subscription_id),period_start,period_end,subscription.cancel_at_period_end,event_created,event_id,event_priority,usage_over_limit) returning id into replacement_id;
    insert into public.organisation_entitlements(organisation_id,subscription_id,capability_key,value_type,boolean_value,integer_value,source_plan_key,source_plan_version)
    select subscription.organisation_id,replacement_id,capability_key,value_type,boolean_value,integer_value,plan_key,plan_version from public.plan_entitlements where plan_key=mapped_price.plan_key and plan_version=mapped_price.plan_version;
    insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,provider_event_id,safe_metadata)
    values(subscription.organisation_id,replacement_id,'plan_changed','billing_provider',event_id,jsonb_build_object('planKey',mapped_price.plan_key,'planVersion',mapped_price.plan_version,'overLimit',usage_over_limit));
    insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,provider_event_id,safe_metadata)
    values(subscription.organisation_id,replacement_id,case when subscription.state in ('past_due','payment_action_required','billing_suspended') then 'payment_recovered' when subscription.state in ('active','cancelled_at_period_end') then 'renewal_succeeded' else 'subscription_activated' end,
      'billing_provider',event_id,jsonb_build_object('providerEventType',event_type));
    update public.billing_webhook_events set subscription_id=replacement_id,processing_status='processed',safe_result_code='plan_changed',processed_at=now() where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id;
    return 'plan_changed';
  end if;
  if event_type='checkout.session.completed' then
    select * into intent from public.billing_checkout_intents where organisation_id=mapping.organisation_id and provider_session_id=event->>'objectId' for update;
    if not found then result_code:='checkout_intent_unmapped';
    else update public.billing_checkout_intents set status='completed',completed_at=now() where id=intent.id;
      perform set_config('app.commercial_subscription_transition',subscription.id::text,true); perform set_config('app.commercial_subscription_reason','checkout_completed',true); perform set_config('app.commercial_subscription_actor_membership','',true);
      update public.organisation_subscriptions set provider='stripe',provider_subscription_id=coalesce(provider_subscription_value,organisation_subscriptions.provider_subscription_id),updated_at=now() where id=subscription.id;
      result_code:='checkout_completed'; end if;
  elsif event_type in ('invoice.paid','invoice.payment_succeeded') then
    if subscription.state='cancelled' then result_code:='payment_observed_after_cancellation';
    else next_state:=case when subscription.state='cancelled_at_period_end' then 'cancelled_at_period_end' when subscription.state='trial_active' and subscription.trial_ends_at>event_created then 'trial_active' else 'active' end;
    lifecycle_type:=case when subscription.state in ('past_due','payment_action_required','billing_suspended') then 'payment_recovered' when subscription.state in ('active','cancelled_at_period_end') then 'renewal_succeeded' else 'subscription_activated' end;
    end if;
  elsif event_type='invoice.payment_failed' or (event_type='customer.subscription.updated' and provider_state in ('past_due','unpaid')) then
    if subscription.state='trial_active' and subscription.trial_ends_at>event_created then
      result_code:='payment_failure_during_trial_ignored';
    elsif subscription.state='billing_suspended' then
      perform set_config('app.commercial_subscription_transition',subscription.id::text,true); perform set_config('app.commercial_subscription_reason','stripe_payment_failed_restricted',true); perform set_config('app.commercial_subscription_actor_membership','',true);
      update public.organisation_subscriptions set last_provider_event_created_at=event_created,last_provider_event_id=event_id,last_provider_event_priority=event_priority,updated_at=now() where id=subscription.id;
      insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,provider_event_id,safe_metadata)
      values(subscription.organisation_id,subscription.id,'payment_failed','billing_provider',event_id,jsonb_build_object('providerEventType',event_type));
      result_code:='payment_failed_restricted';
    else
    next_state:='past_due'; lifecycle_type:='payment_failed';
    end if;
  elsif event_type='customer.subscription.deleted' then next_state:='cancelled'; lifecycle_type:='cancellation_effective';
  elsif event_type='customer.subscription.updated' and event_cancel is true then next_state:='cancelled_at_period_end'; lifecycle_type:='cancellation_requested';
  elsif event_type='customer.subscription.updated' and event_cancel is false and subscription.state='cancelled_at_period_end' and provider_state in ('active','trialing') then
    next_state:=case when subscription.ordinary_initial_trial and subscription.trial_ends_at>event_created then 'trial_active' else 'active' end; lifecycle_type:='cancellation_resumed';
  elsif event_type in ('customer.subscription.created','customer.subscription.updated') then result_code:='provider_subscription_observed';
  else result_code:='event_not_actionable'; end if;
  if next_state is not null then
    grace_kind_value:=case when subscription.state='trial_active' then 'trial_conversion' else 'payment_failure' end;
    grace_start_value:=coalesce(subscription.grace_started_at,case when subscription.state='trial_active' then subscription.trial_ends_at else event_created end);
    grace_end_value:=coalesce(subscription.grace_ends_at,grace_start_value+case when subscription.state='trial_active' then interval '168 hours' else interval '336 hours' end);
    perform set_config('app.commercial_subscription_transition',subscription.id::text,true); perform set_config('app.commercial_subscription_reason','stripe_'||replace(event_type,'.','_'),true); perform set_config('app.commercial_subscription_actor_membership','',true);
    update public.organisation_subscriptions set state=next_state,provider='stripe',provider_subscription_id=coalesce(provider_subscription_value,organisation_subscriptions.provider_subscription_id),
      current_period_started_at=coalesce(period_start,current_period_started_at),current_period_ends_at=coalesce(period_end,current_period_ends_at),
      grace_kind=case when next_state='past_due' then coalesce(subscription.grace_kind,grace_kind_value) else null end,
      grace_started_at=case when next_state='past_due' then grace_start_value else null end,
      grace_ends_at=case when next_state='past_due' then grace_end_value else null end,
      cancel_at_period_end=case when event_type like 'customer.subscription.%' and event_cancel is not null then event_cancel when next_state='cancelled_at_period_end' then true else subscription.cancel_at_period_end end,ended_at=case when next_state='cancelled' then now() else null end,
      last_provider_event_created_at=event_created,last_provider_event_id=event_id,last_provider_event_priority=event_priority,
      last_provider_subscription_event_created_at=case when event_type like 'customer.subscription.%' then event_created else last_provider_subscription_event_created_at end,
      last_provider_subscription_state=case when event_type like 'customer.subscription.%' then provider_state else last_provider_subscription_state end,updated_at=now() where id=subscription.id;
    insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,provider_event_id,safe_metadata)
    values(subscription.organisation_id,subscription.id,lifecycle_type,'billing_provider',event_id,jsonb_build_object('providerEventType',event_type));
    if next_state='past_due' and subscription.grace_started_at is null then insert into public.billing_lifecycle_events(organisation_id,subscription_id,event_type,source,provider_event_id,safe_metadata)
      values(subscription.organisation_id,subscription.id,'grace_started','billing_provider',event_id,jsonb_build_object('graceKind',grace_kind_value)) on conflict do nothing; end if;
    result_code:=lifecycle_type;
  elsif result_code='provider_subscription_observed' then
    perform set_config('app.commercial_subscription_transition',subscription.id::text,true); perform set_config('app.commercial_subscription_reason','stripe_'||replace(event_type,'.','_'),true); perform set_config('app.commercial_subscription_actor_membership','',true);
    update public.organisation_subscriptions set provider='stripe',provider_subscription_id=coalesce(provider_subscription_value,organisation_subscriptions.provider_subscription_id),
      current_period_started_at=coalesce(period_start,current_period_started_at),current_period_ends_at=coalesce(period_end,current_period_ends_at),cancel_at_period_end=coalesce(event_cancel,cancel_at_period_end),
      last_provider_subscription_event_created_at=event_created,last_provider_subscription_state=provider_state,updated_at=now() where id=subscription.id;
  end if;
  update public.billing_webhook_events set processing_status='processed',safe_result_code=result_code,processed_at=now() where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id;
  return result_code;
  exception when others then
    update public.billing_webhook_events set organisation_id=coalesce(mapping.organisation_id,organisation_id),subscription_id=coalesce(subscription.id,subscription_id),
      processing_status='failed',safe_result_code='processing_failed',processed_at=now()
    where provider='stripe' and provider_environment=target_environment and provider_event_id=event_id;
    return 'processing_failed';
  end;
end $$;

do $$ begin
  if exists(select 1 from pg_available_extensions where name='pg_cron') and not exists(select 1 from pg_extension where extname='pg_cron') then execute 'create extension pg_cron'; end if;
  if exists(select 1 from pg_extension where extname='pg_cron') then
    if exists(select 1 from cron.job where jobname='commercial-billing-reconciliation') then perform cron.unschedule('commercial-billing-reconciliation'); end if;
    perform cron.schedule('commercial-billing-reconciliation','7 * * * *','select private.reconcile_commercial_billing(now())');
  end if;
end $$;

revoke all on function private.prevent_billing_history_mutation() from public,anon,authenticated,service_role;
revoke all on function private.commercial_access_mode(public.organisation_subscriptions,timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.reconcile_commercial_billing(timestamptz) from public,anon,authenticated,service_role;
revoke all on function private.commercial_plan_over_limit(uuid,text,integer) from public,anon,authenticated,service_role;
revoke all on function public.commercial_billing_snapshot(uuid) from public,anon,authenticated,service_role;
grant execute on function public.commercial_billing_snapshot(uuid) to authenticated;
revoke all on function public.commercial_record_provider_customer(uuid,uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.commercial_record_provider_price(text,text,integer,text) from public,anon,authenticated,service_role;
revoke all on function public.commercial_prepare_checkout_intent(uuid,uuid,text,text,integer,text,uuid,text) from public,anon,authenticated,service_role;
revoke all on function public.commercial_complete_checkout_intent(uuid,text,text) from public,anon,authenticated,service_role;
revoke all on function public.commercial_process_billing_event(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commercial_record_provider_customer(uuid,uuid,text,text) to service_role;
grant execute on function public.commercial_record_provider_price(text,text,integer,text) to service_role;
grant execute on function public.commercial_prepare_checkout_intent(uuid,uuid,text,text,integer,text,uuid,text) to service_role;
grant execute on function public.commercial_complete_checkout_intent(uuid,text,text) to service_role;
grant execute on function public.commercial_process_billing_event(text,jsonb) to service_role;
