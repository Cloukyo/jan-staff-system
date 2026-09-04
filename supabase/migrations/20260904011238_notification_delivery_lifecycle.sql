-- Provider-independent post-acceptance notification delivery evidence.
-- External provider delivery remains disabled until a sender and domain are approved.

alter table public.message_outbox
  add column if not exists provider_delivery_status text
    check(provider_delivery_status is null or provider_delivery_status in('delivered','bounced','complained','suppressed')),
  add column if not exists provider_last_event_at timestamptz;

create unique index if not exists message_outbox_provider_reference_key
  on public.message_outbox(provider_message_reference)
  where provider_message_reference is not null;

create table public.notification_delivery_events(
  id uuid primary key default gen_random_uuid(),
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  outbox_id uuid not null references public.message_outbox(id) on delete restrict,
  provider_event_reference text not null unique
    check(length(provider_event_reference) between 1 and 200 and provider_event_reference!~'[[:cntrl:]]'),
  provider_message_reference text not null
    check(length(provider_message_reference) between 1 and 200 and provider_message_reference!~'[[:cntrl:]]'),
  event_type text not null check(event_type in('delivered','bounced','complained','suppressed')),
  event_occurred_at timestamptz not null,
  failure_code text check(failure_code is null or (length(failure_code)<=80 and failure_code~'^[A-Za-z0-9_.:-]+$')),
  received_at timestamptz not null default clock_timestamp(),
  unique(organisation_id,id),
  unique(organisation_id,outbox_id,provider_event_reference)
);

create table public.notification_recipient_suppressions(
  organisation_id uuid not null references public.organisations(id) on delete restrict,
  recipient_address text not null check(recipient_address=lower(btrim(recipient_address)) and length(recipient_address) between 3 and 320),
  reason text not null check(reason in('bounced','complained','suppressed')),
  source_outbox_id uuid not null references public.message_outbox(id) on delete restrict,
  suppressed_at timestamptz not null,
  cleared_at timestamptz,
  cleared_reason text check(cleared_reason is null or (length(cleared_reason) between 8 and 200 and cleared_reason!~'[[:cntrl:]]')),
  primary key(organisation_id,recipient_address),
  check((cleared_at is null and cleared_reason is null) or (cleared_at is not null and cleared_reason is not null))
);

alter table public.notification_delivery_events enable row level security;
alter table public.notification_recipient_suppressions enable row level security;
revoke all on public.notification_delivery_events,public.notification_recipient_suppressions from public,anon,authenticated;

create or replace function private.prevent_notification_delivery_event_mutation()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  raise exception 'notification delivery events are immutable' using errcode='55000';
end
$$;

create trigger notification_delivery_events_immutable
before update or delete on public.notification_delivery_events
for each row execute function private.prevent_notification_delivery_event_mutation();

create or replace function private.enforce_notification_recipient_suppression()
returns trigger language plpgsql security definer set search_path='' as $$
declare secret_id uuid;
begin
  new.recipient_address:=lower(btrim(new.recipient_address));
  if exists(
    select 1 from public.notification_recipient_suppressions suppression
    where suppression.organisation_id=new.organisation_id
      and suppression.recipient_address=new.recipient_address
      and suppression.cleared_at is null
  ) then
    secret_id:=new.delivery_secret_id;
    new.delivery_status:='permanent_failure';
    new.failed_at:=coalesce(new.failed_at,clock_timestamp());
    new.last_error_code:='recipient_suppressed';
    new.next_attempt_at:=null;
    new.delivery_secret_id:=null;
    if secret_id is not null then delete from vault.secrets where id=secret_id;end if;
  end if;
  return new;
end
$$;

create trigger message_outbox_recipient_suppression
before insert on public.message_outbox
for each row execute function private.enforce_notification_recipient_suppression();

create or replace function public.record_notification_provider_event(
  target_provider_event_reference text,
  target_provider_message_reference text,
  target_event_type text,
  target_event_occurred_at timestamptz,
  target_failure_code text default null
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  outbox public.message_outbox%rowtype;
  event_id uuid;
  secret_ids uuid[];
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
  if target_provider_event_reference is null or length(target_provider_event_reference) not between 1 and 200 or target_provider_event_reference~'[[:cntrl:]]'
    or target_provider_message_reference is null or length(target_provider_message_reference) not between 1 and 200 or target_provider_message_reference~'[[:cntrl:]]'
    or target_event_type not in('delivered','bounced','complained','suppressed')
    or target_event_occurred_at is null or target_event_occurred_at>clock_timestamp()+interval '5 minutes'
    or target_failure_code is not null and (length(target_failure_code)>80 or target_failure_code!~'^[A-Za-z0-9_.:-]+$') then
    raise exception 'invalid provider delivery event' using errcode='22023';
  end if;

  select * into outbox from public.message_outbox
  where provider_message_reference=target_provider_message_reference
  for update;
  if not found then return jsonb_build_object('outcome','not_available');end if;

  insert into public.notification_delivery_events(
    organisation_id,outbox_id,provider_event_reference,provider_message_reference,
    event_type,event_occurred_at,failure_code
  ) values(
    outbox.organisation_id,outbox.id,target_provider_event_reference,target_provider_message_reference,
    target_event_type,target_event_occurred_at,target_failure_code
  ) on conflict(provider_event_reference) do nothing returning id into event_id;
  if event_id is null then return jsonb_build_object('outcome','already_recorded');end if;

  update public.message_outbox set
    provider_delivery_status=case when provider_last_event_at is null or target_event_occurred_at>=provider_last_event_at then target_event_type else provider_delivery_status end,
    provider_last_event_at=greatest(coalesce(provider_last_event_at,target_event_occurred_at),target_event_occurred_at)
  where id=outbox.id;

  if target_event_type in('bounced','complained','suppressed') then
    insert into public.notification_recipient_suppressions(
      organisation_id,recipient_address,reason,source_outbox_id,suppressed_at
    ) values(
      outbox.organisation_id,lower(btrim(outbox.recipient_address)),target_event_type,outbox.id,target_event_occurred_at
    ) on conflict(organisation_id,recipient_address) do update set
      reason=excluded.reason,
      source_outbox_id=excluded.source_outbox_id,
      suppressed_at=greatest(public.notification_recipient_suppressions.suppressed_at,excluded.suppressed_at),
      cleared_at=null,
      cleared_reason=null;

    select array_agg(delivery_secret_id) into secret_ids
    from public.message_outbox
    where organisation_id=outbox.organisation_id
      and recipient_address=lower(btrim(outbox.recipient_address))
      and delivery_status in('queued','processing','retryable_failure')
      and delivery_secret_id is not null;
    update public.message_outbox set
      delivery_status='permanent_failure',
      failed_at=coalesce(failed_at,clock_timestamp()),
      last_error_code='recipient_suppressed',
      next_attempt_at=null,
      delivery_secret_id=null
    where organisation_id=outbox.organisation_id
      and recipient_address=lower(btrim(outbox.recipient_address))
      and delivery_status in('queued','processing','retryable_failure');
    if secret_ids is not null then delete from vault.secrets where id=any(secret_ids);end if;
  end if;

  return jsonb_build_object('outcome','recorded','deliveryStatus',target_event_type);
end
$$;

create or replace function public.clear_notification_recipient_suppression(
  target_organisation_id uuid,
  target_recipient_address text,
  target_reason text
)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
  if coalesce(auth.role(),'')<>'service_role' then raise exception 'service role required' using errcode='42501';end if;
  if target_reason is null or length(btrim(target_reason)) not between 8 and 200 or target_reason~'[[:cntrl:]]' then
    raise exception 'a safe suppression-clear reason is required' using errcode='22023';
  end if;
  update public.notification_recipient_suppressions set
    cleared_at=clock_timestamp(),cleared_reason=btrim(target_reason)
  where organisation_id=target_organisation_id
    and recipient_address=lower(btrim(target_recipient_address))
    and cleared_at is null;
  if not found then return jsonb_build_object('outcome','not_available');end if;
  return jsonb_build_object('outcome','cleared');
end
$$;

revoke all on function private.prevent_notification_delivery_event_mutation(),
  private.enforce_notification_recipient_suppression(),
  public.record_notification_provider_event(text,text,text,timestamptz,text),
  public.clear_notification_recipient_suppression(uuid,text,text)
from public,anon,authenticated,service_role;
grant execute on function public.record_notification_provider_event(text,text,text,timestamptz,text),
  public.clear_notification_recipient_suppression(uuid,text,text)
to service_role;
