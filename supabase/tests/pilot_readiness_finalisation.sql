begin;

select plan(23);

select has_table('public','customer_export_audits','owner exports have immutable audit evidence');
select has_column('public','message_outbox','notification_key','notification outbox has a durable idempotency key');
select has_column('public','message_outbox','provider_accepted_at','notification outbox records provider acceptance');
select has_function('public','claim_next_notification_delivery',array[]::text[],'trusted worker can atomically claim delivery');
select has_function('public','record_notification_delivery',array['uuid','text','text','text'],'trusted worker can record bounded outcomes');
select ok(has_function_privilege('service_role','public.claim_next_notification_delivery()','EXECUTE')
  and not has_function_privilege('authenticated','public.claim_next_notification_delivery()','EXECUTE')
  and not has_function_privilege('anon','public.claim_next_notification_delivery()','EXECUTE'),'notification claim is service-role only');
select ok(has_function_privilege('service_role','public.record_notification_delivery(uuid,text,text,text)','EXECUTE')
  and not has_function_privilege('authenticated','public.record_notification_delivery(uuid,text,text,text)','EXECUTE'),'notification result recording is service-role only');
select ok(not has_table_privilege('authenticated','public.message_outbox','SELECT')
  and not has_table_privilege('authenticated','public.message_outbox','INSERT'),'browser sessions cannot inspect delivery material or forge messages');
select is((select count(*)::int from public.message_outbox where payload::text~*'token=|acceptance.?url'),0,'outbox stores no rendered acceptance URL');
select ok(exists(select 1 from pg_indexes where schemaname='public' and tablename='message_outbox' and indexname='message_outbox_notification_key'),'notification keys are unique');

select ok((select relrowsecurity from pg_class where oid='public.customer_export_audits'::regclass),'customer export audit receipts have RLS');
select ok(has_table_privilege('authenticated','public.customer_export_audits','SELECT')
  and not has_table_privilege('authenticated','public.customer_export_audits','INSERT')
  and not has_table_privilege('authenticated','public.customer_export_audits','UPDATE')
  and not has_table_privilege('authenticated','public.customer_export_audits','DELETE'),'customers cannot forge or rewrite export audit evidence');
select is((select count(*)::int from private.role_permissions where permission='organisation.export' and role='organisation_owner'),1,'customer export permission is owner-only');
select ok(not exists(select 1 from private.role_permissions where permission='organisation.export' and role<>'organisation_owner'),'no non-owner role receives customer export permission');
select ok(exists(select 1 from public.plan_entitlements where capability_key='exports.customer' and boolean_value),'published plans include customer export continuity');
select ok(not has_function_privilege('anon','public.prepare_customer_export(uuid)','EXECUTE')
  and has_function_privilege('authenticated','public.prepare_customer_export(uuid)','EXECUTE'),'customer export boundary is authenticated and internally owner-guarded');

select has_function('public','claim_commercial_kiosk',array['uuid','text','text'],'kiosk claim requires a registration UUID');
select ok(not has_function_privilege('authenticated','private.verify_commercial_kiosk_pin_attempt(text,text)','EXECUTE'),'PIN attempt state is protected behind kiosk boundaries');
select ok(
  position('perform_commercial_kiosk_attendance_action_pre_pin_guard.idempotency_key' in pg_get_functiondef('public.perform_commercial_kiosk_attendance_action_pre_pin_guard(text,text,text,text,text,uuid)'::regprocedure)) > 0
  and position('perform_commercial_kiosk_attendance_action_7g.idempotency_key' in pg_get_functiondef('public.perform_commercial_kiosk_attendance_action_pre_pin_guard(text,text,text,text,text,uuid)'::regprocedure)) = 0,
  'renamed kiosk attendance implementation keeps valid self-qualified parameters'
);
select ok(exists(select 1 from pg_trigger where tgrelid='public.organisation_invitations'::regclass and tgname='organisation_invitations_enforce_privileged_capacity' and not tgisinternal),'pending manager invitations reserve privileged capacity');
select ok(not (select prosecdef from pg_proc where oid='public.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)'::regprocedure)
  and (select prosecdef from pg_proc where oid='commercial_api_private.execute_commercial_admin_command(uuid,text,jsonb,uuid,bigint)'::regprocedure),'post-live admin keeps an invoker wrapper and guarded implementation');
select is((select count(*)::int from public.kiosk_devices where organisation_id is not null and offline_enabled),0,'commercial devices remain offline-disabled');
select is((select count(*)::int from public.kiosk_offline_authorisations authorisation join public.kiosk_devices device on device.id=authorisation.kiosk_device_id where device.organisation_id is not null and authorisation.revoked_at is null),0,'commercial devices have no active offline authorisation');

select * from finish();
rollback;
