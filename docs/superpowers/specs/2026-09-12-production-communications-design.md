# Production communications design

## Scope

Complete the provider-independent communications foundation without selecting a product name, purchasing a domain, enabling unrestricted signup, or deploying Commercial Production.

## Decisions

- Treat `NEXT_PUBLIC_SITE_URL` as the canonical application origin. It must be an absolute origin with no credentials, path, query, or fragment, and must use HTTPS outside local development.
- Build verification, recovery, invitation, and account links only from that validated origin and application-relative paths.
- Keep the existing notification outbox, worker, idempotency, delivery-event RPC, suppression, and staging-recipient containment.
- Add a Resend webhook endpoint that verifies the raw request with the endpoint signing secret before mapping only delivered, bounced, complained, and suppressed events into the existing service-role RPC.
- Keep the webhook secret server-only. Unsupported, correctly signed events are acknowledged without persistence; invalid requests fail closed.
- Add optional Cloudflare Turnstile to signup, sign-in, and password-reset forms. When a site key is configured, the server action requires the response token and passes it to Supabase Auth. Invitation acceptance and authenticated MFA continuation are not challenged.
- Add an optional provider reply-to address while preserving the existing from-address contract.
- Store production-neutral Supabase Auth email template sources in the repository. Provider and DNS activation remains manual.
- Do not add a database migration: the current `record_notification_provider_event` RPC already provides authoritative, idempotent, service-role-only persistence and suppression.

## Activation boundary

Application code and tests can be completed before a permanent domain exists. Production activation still requires an approved domain, DNS access, a Resend account/domain/API key/webhook secret, a Cloudflare Turnstile site/secret pair, and Supabase/Vercel dashboard configuration.
