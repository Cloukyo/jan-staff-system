-- A verified positive Stripe invoice is authoritative payment evidence. Keep the
-- immutable ordinary-trial timestamps as history, but do not leave a customer
-- labelled as trial_active after money has actually been collected.
create or replace function public.commercial_process_billing_event(target_environment text, event jsonb)
returns text language plpgsql security definer set search_path = '' as $$
declare event_id text:=event->>'id'; event_type text:=event->>'type'; customer_id text:=event->>'customerId'; provider_subscription_value text:=event->>'subscriptionId';
  event_created timestamptz:=to_timestamp((event->>'created')::bigint); mapping public.billing_provider_customers%rowtype;
  subscription public.organisation_subscriptions%rowtype; intent public.billing_checkout_intents%rowtype; next_state text; lifecycle_type text; result_code text:='processed';
  period_start timestamptz; period_end timestamptz; event_cancel boolean; event_price text; amount_paid bigint;
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
  amount_paid:=case when (event->>'amountPaid') ~ '^[0-9]+$' then (event->>'amountPaid')::bigint end;
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
    and not (subscription.state='trial_active' and subscription.trial_ends_at>event_created and coalesce(amount_paid,0)=0)
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
    else next_state:=case when subscription.state='cancelled_at_period_end' then 'cancelled_at_period_end' when subscription.state='trial_active' and subscription.trial_ends_at>event_created and coalesce(amount_paid,0)=0 then 'trial_active' else 'active' end;
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

revoke all on function public.commercial_process_billing_event(text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.commercial_process_billing_event(text,jsonb) to service_role;
