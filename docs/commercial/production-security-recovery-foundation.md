# Production Security, Recovery and Communications Foundation

Evidence date: 4 September 2026. Production changes remain separately approved operations.

## Recovery

Commercial Production is healthy in Supabase `eu-west-2`; its database is approximately 21.5 MB and currently contains no customer organisations, Auth users, staff, leave or clock-event records. Supabase reports physical backups for supported Postgres versions. The provider documents daily backups with seven-day retention on Pro, but the authenticated backup dashboard and backup recency were not available to this run, so retention and the latest successful recovery point require manual confirmation.

PITR remains disabled. Supabase documents a worst-case two-minute RPO, seven-day retention at about USD 100 per month, and a Small-compute requirement. PITR is outside the spend cap. No paid add-on or compute change was made.

An actual restore rehearsal was not run because no approved disposable project or paid database branch was available. Before external data, use the runbook in `pilot-backup-rollback-checklist.md` to restore a current Production recovery point into an isolated project, never over Production. Validate aggregate counts and deterministic evidence hashes for organisations, staff, rota, original clock events, corrections, leave, compliance, payroll state, memberships and Auth associations. Record RPO, elapsed restore time and any role-password or Storage limitations.

## Database transport and network exposure

Postgres reports SSL support enabled. Application traffic uses Supabase HTTPS APIs and the Vercel configuration requires HTTPS URLs. Production still accepts non-SSL direct Postgres clients because provider SSL enforcement is not enabled. A snapshot observed three other client connections: two negotiated SSL and one did not; the read-only evidence cannot attribute the non-SSL connection safely.

Do not enable enforcement in Production first. Manually enable SSL enforcement in Commercial Staging, test migrations and emergency administration through every approved client, then approve the equivalent Production change. Direct database network restrictions remain deferred because Vercel application traffic does not need direct Postgres but migration and emergency access do, and the current deployment does not provide a proven fixed egress allow-list. Restricting by guessed IP could lock out recovery access.

## Supabase adviser triage

The Production adviser snapshot contains 115 security notices: 106 `WARN` notices for intentionally callable `SECURITY DEFINER` RPCs and nine `INFO` notices for RLS-enabled internal tables without direct policies. The 11 anonymous RPCs are kiosk token/PIN operations and invitation inspection/acceptance boundaries; they require their own token, expiry, rate-limit and tenant checks. The 95 authenticated RPCs are the intended permission-checked application command surface. These are accepted architecture only where the committed database tests prove internal authorisation and least-privilege grants. Any newly exposed RPC remains a pre-pilot blocker until tested.

The 385 performance notices comprise 208 unindexed foreign keys, 126 unused indexes, 48 multiple-permissive-policy notices, two Auth RLS init-plan findings, and one Auth connection-allocation notice. The two init-plan findings are reasonable pre-paid-launch optimisations. Foreign-key and policy consolidation require workload evidence and are not pilot security blockers. Removing unused indexes before real workload evidence would be unsafe.

References: [Supabase database linter](https://supabase.com/docs/guides/database/database-linter), [RLS performance](https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).

## Production Auth

The last verified Production baseline has public signup disabled, email confirmation required, secure email changes enabled and minimum password length 12. The application independently requires uppercase, lowercase, number and symbol, and rejects passwords containing the email name. Provider-side required-character enforcement and leaked-password protection were not verifiable through the available API surface. Supabase supports the strongest required-character option and provides leaked-password protection on Pro; configure both in Staging first when dashboard access is available.

Keep CAPTCHA targeted to unauthenticated email-generating operations: pilot signup, password reset and repeated invitation acceptance. Login should first use rate limits and monitoring; introduce a challenge only after suspicious failures or provider thresholds. Separate hCaptcha site keys and secrets are required for Staging and Production hostnames. Fail closed if the provider is configured but unavailable. Do not enable CAPTCHA without tested keys and recovery access.

The observed Production Auth limits are two outbound Auth emails per hour on the default SMTP service, 30 OTP requests, 30 verification requests, 150 token refreshes and 30 anonymous sign-ins per hour. The default SMTP service is not suitable for external users. Account-linking and invitation commands also retain database permission, replay, expiry and throttling controls.

References: [Supabase password security](https://supabase.com/docs/guides/auth/password-security), [Supabase custom SMTP and abuse guidance](https://supabase.com/docs/guides/auth/auth-smtp).

## Email architecture and provider decision

The application already separates a transactional provider interface from the durable database outbox. Sending is idempotent by outbox ID and template version, retries are bounded, provider references are recorded, Staging is restricted to provider test recipients, and Production fails closed while delivery is disabled.

Migration `20260904011238_notification_delivery_lifecycle` adds provider-independent delivery, bounce, complaint and suppression evidence. Provider events are service-role only and idempotent, event evidence is append-only, negative events suppress queued and future mail to that organisation/address, and suppression clearing requires an explicit recorded reason. No public webhook or provider secret is introduced before the provider decision.

Resend is the preferred initial provider because the tested adapter already uses its HTTP API and idempotency support, it offers SMTP for Supabase Auth, webhook delivery events and controlled Staging recipients. Its published free allowance is sufficient for a supervised pilot, with paid transactional plans available as volume grows. Postmark is the operationally simple fallback; AWS SES is the lower unit-cost fallback but carries more AWS, SNS and deliverability setup. Approve the vendor, data-processing terms, sender domain, region/retention needs and costs before creating an account or enabling delivery.

References: [Resend pricing](https://resend.com/docs/knowledge-base/what-is-resend-pricing), [Resend webhook persistence](https://resend.com/docs/dashboard/webhooks/how-to-store-webhooks-data), [Supabase custom SMTP](https://supabase.com/docs/guides/auth/auth-smtp), [Amazon SES pricing](https://aws.amazon.com/ses/pricing/).

## Domain dependency matrix

| Capability | Existing Vercel hostname sufficient now | Permanent application domain required before external pilot |
| --- | --- | --- |
| Auth Site URL and redirect allow-list | Yes, for isolated Staging | Yes, to avoid changing customer links later |
| Application URL and CAPTCHA | Yes, with hostname-specific test keys | Yes, with Production keys |
| Email API/outbox architecture | Yes | No |
| Auth SMTP, sender, SPF, DKIM and DMARC | No | Yes |
| Stripe webhook endpoint | Yes for sandbox verification | Yes before live billing |
| Privacy, terms and support links | Temporary internal links only | Yes before external users |
| Public marketing site and analytics | Not needed | Deferred until after final application release candidate |

The permanent marketing domain is not a dependency for current engineering. Only the application hostname and sender domain should be selected when Auth, CAPTCHA or production email configuration requires them.

## Region, monitoring and costs

Commercial Staging runs Vercel functions in London `lhr1`, matching Supabase `eu-west-2`. The staging release workflow now rejects deployments that do not include `lhr1`. The untouched Production deployment remains in Washington `iad1`; moving it requires separate approval after Staging evidence.

Existing pilot monitoring includes liveness/readiness endpoints with exact SHA and environment identity, Vercel runtime/error logs, structured redacted logging, correlation IDs, authenticated cron execution, GitHub CI/Security/CodeQL and migration-ledger gates. The notification worker now emits bounded structured batch/failure records without recipient data. Configure native alerts for repeated `5xx`, readiness failure and notification-worker failures before external data. Add a small external uptime check only if native alerts cannot monitor both health endpoints independently.

Current Vercel usage is within included allowance; no monitoring or spend service was purchased. Configure provider billing alerts manually at conservative pilot thresholds. Supabase PITR is not covered by its spend cap, so any later PITR approval must include an explicit monthly budget. Future email must start on an approved low-volume plan with daily/monthly sending alerts. Stripe remains sandbox-only and should use Dashboard webhook and dispute alerts when billing work begins.
