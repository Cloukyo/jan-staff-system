# Production communications

Last reviewed: 12 September 2026

This runbook covers authentication and transactional communications for a controlled external nursery pilot. It does not approve a product name, domain purchase, unrestricted signup, marketing email, billing activation, or Commercial Production deployment.

## Current implementation

### Supabase Auth

- Email/password signup remains controlled by the server-side pilot grant gate.
- Signup confirmation and password recovery return through `/auth/callback`, then the existing safe post-auth continuation resolver.
- Manager and staff invitation continuations are application-relative, role-bound, organisation/site-authorised, time-limited, replay-protected, and MFA-preserving.
- Password reset uses a non-enumerating response and reports bounded rate-limit guidance.
- Application passwords retain the 12-character mixed-password policy. Provider-side Auth settings must not weaken it.
- Turnstile is now supported on signup, sign-in, and password reset, but remains absent until both Cloudflare and Supabase are configured.

### Application notifications

- The immutable outbox, atomic claim, retries, provider idempotency key, transient/permanent outcomes, and structured safe logging remain authoritative.
- Invitation delivery material is released only to the trusted worker and is not written to delivery logs.
- Commercial Staging delivery remains restricted to controlled `resend.dev` recipients.
- Production delivery remains fail closed unless its complete server-side configuration is present.
- Resend delivered, bounced, complained, and suppressed events can now be authenticated using the raw Svix-signed request and recorded through the existing service-role-only RPC.
- Duplicate provider events remain idempotent. Bounces, complaints, and provider suppressions continue to create tenant-scoped recipient suppression through the existing database lifecycle.
- Open and click tracking events are deliberately ignored and not persisted.

No new migration is required for this milestone.

## Permanent domain decision

Choose one registrable UK business domain before Production activation. Until that decision is approved, do not place placeholder domains in Production settings.

Recommended topology after selection:

| Purpose | Recommended form |
| --- | --- |
| Future public website | `https://<base-domain>` |
| SaaS application and canonical origin | `https://app.<base-domain>` |
| Human support/reply mailbox | `support@<base-domain>` |
| Transactional sending domain | `notify.<base-domain>` |
| Transactional From address | `no-reply@notify.<base-domain>` |
| Resend delivery webhook | `https://app.<base-domain>/api/webhooks/resend` |
| Future Stripe webhook | `https://app.<base-domain>/api/billing/stripe/webhook` |

The sending subdomain isolates transactional reputation from the later marketing site and any future marketing mail. Auth and application operational messages may share it because both are transactional. Marketing mail must use a separate stream/domain later.

## Canonical URLs and allow-lists

For Commercial Production:

1. Set Vercel `NEXT_PUBLIC_SITE_URL` to exactly `https://app.<base-domain>` with no path, query, or fragment.
2. Set Vercel `PRODUCTION_SITE_HOST` to exactly `app.<base-domain>`.
3. Set Supabase Auth Site URL to exactly `https://app.<base-domain>`.
4. Add the exact production redirect `https://app.<base-domain>/auth/callback` to the Production Auth allow-list.
5. Do not add Vercel preview wildcards to the Production Supabase project.
6. Keep exact staging and localhost callbacks only in their respective non-production projects.
7. Register `app.<base-domain>` as the Cloudflare Turnstile production hostname.
8. Use the application origin for future Stripe Checkout/Portal return URLs. Keep the signed webhook at the path shown above.

Application code rejects origins containing credentials, paths, queries, fragments, protocol-relative destinations, or non-HTTPS commercial origins.

## Preferred provider: Resend

Resend is preferred because the current worker already uses its API, it also provides SMTP for Supabase Auth, it supports verified sending domains, SPF/DKIM, DMARC alignment, signed Svix webhooks, delivery/bounce/complaint/suppression events, and provider idempotency without adding a second integration.

Pilot cost at the time of review:

- Free: USD 0/month, 3,000 transactional emails/month, maximum 100/day.
- Pro: USD 20/month for 50,000 transactional emails/month.

Start on Free only if the 100/day limit and support level are acceptable for the controlled pilot. Move to Pro before ordinary customer operation if volume, overage handling, retention, or support warrants it.

Official references:

- https://resend.com/docs/knowledge-base/what-is-resend-pricing
- https://resend.com/docs/dashboard/domains/introduction
- https://resend.com/docs/webhooks/verify-webhooks-requests
- https://resend.com/docs/webhooks/event-types

## Fallback provider: Postmark

Postmark is the operational fallback. It provides SMTP and API delivery, transactional message streams, DKIM/custom Return-Path support, delivery/bounce/spam-complaint webhooks, suppression handling, and established deliverability tooling. Its webhook protection uses configured HTTP authentication and optional IP allow-listing rather than Resend's signed payload contract, so adopting it requires a separate provider adapter and webhook verifier.

Pilot cost at the time of review:

- Free developer plan: USD 0/month, 100 emails/month, suitable only for testing.
- Basic: USD 15/month for 10,000 emails/month.

Official references:

- https://postmarkapp.com/pricing
- https://postmarkapp.com/developer/webhooks/webhooks-overview
- https://postmarkapp.com/support/article/1002-getting-started-with-postmark

## Manual Resend setup

After the permanent domain is approved:

1. Create or use a business-controlled Resend account and require MFA for administrators.
2. Add `notify.<base-domain>` as a sending domain.
3. Add exactly the SPF, DKIM, MX/Return-Path records generated by Resend. Do not copy record values from this document.
4. Add DMARC monitoring for the aligned domain. Begin with `p=none` and an actively monitored aggregate-report mailbox. Move to quarantine/reject only after confirming all legitimate senders and alignment.
5. Disable provider link tracking for Auth and invitation messages so verification links are not rewritten.
6. Create a least-privilege API key for application transactional sending.
7. Create the webhook endpoint for delivered, bounced, complained, and suppressed events at the exact application URL.
8. Store the endpoint signing secret as server-only `RESEND_WEBHOOK_SECRET`.
9. Set `RESEND_FROM_ADDRESS`, optional `RESEND_REPLY_TO_ADDRESS`, and `RESEND_API_KEY` in the intended Vercel environment.
10. Configure Supabase custom SMTP with Resend's SMTP host, port, username, and a separately scoped credential where available.

Never place API, SMTP, webhook, Turnstile, or service-role secrets in `NEXT_PUBLIC_` variables.

## Manual Cloudflare Turnstile setup

1. Create a Turnstile widget under a business-controlled Cloudflare account.
2. Allow only the permanent application hostname for Production. Use a separate test widget for staging/local verification.
3. Store the public site key as Vercel `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
4. Configure the private Turnstile secret in Supabase Auth under Bot and Abuse Protection. The application does not need or store that secret.
5. Deploy the code/site key before enabling Supabase CAPTCHA. To roll back, disable Supabase CAPTCHA first, then remove the site key.
6. Verify signup, sign-in, password reset, expired challenge, blocked challenge, keyboard use, and screen-reader labeling.

CAPTCHA is not added to authenticated MFA continuation or invitation acceptance because those flows already rely on authenticated/token-bound controls and adding another challenge would not materially improve the current threat model.

## Supabase Auth configuration and templates

Production requires custom SMTP. Supabase's default SMTP is not a production service and is restricted/rate-limited. Preserve:

- email confirmation enabled;
- secure email-change behaviour;
- manager MFA requirement;
- the application 12-character mixed-password rule;
- controlled pilot signup;
- current Auth rate limits unless pilot evidence justifies a stricter value;
- CAPTCHA enabled only after the application site key and provider secret are both ready.

Repository template sources:

| Supabase template | Source | Suggested subject |
| --- | --- | --- |
| Confirm signup | `supabase/templates/confirm-signup.html` | Verify your email address |
| Reset password | `supabase/templates/recovery.html` | Reset your password |
| Password changed security notice | `supabase/templates/password-changed.html` | Your password was changed |
| MFA factor changed security notice | `supabase/templates/mfa-factor-changed.html` | Your verification method changed |

Upload the rendered source through the Supabase dashboard or Management API after replacing no content except any approved final product name/support wording. Retain `{{ .ConfirmationURL }}` exactly for confirmation and recovery. Enable the password and MFA security notifications.

## Environment variables

| Variable | Exposure | Required when |
| --- | --- | --- |
| `NEXT_PUBLIC_SITE_URL` | Browser-safe origin | Commercial runtime |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | Browser-safe public key | CAPTCHA enabled |
| `RESEND_API_KEY` | Server secret | notification delivery enabled |
| `RESEND_FROM_ADDRESS` | Server configuration | notification delivery enabled |
| `RESEND_REPLY_TO_ADDRESS` | Server configuration | replies should reach support |
| `RESEND_STAGING_RECIPIENT` | Server configuration | staging delivery enabled |
| `RESEND_WEBHOOK_SECRET` | Server secret | Production delivery enabled and webhook configured |
| `CRON_SECRET` | Server secret | worker enabled |
| `SUPABASE_SERVICE_ROLE_KEY` | Server secret | worker/webhook persistence |

Current Commercial Staging has no notification-provider or Turnstile variables configured. Delivery therefore remains disabled and fail closed until the manual provider setup is approved.

## Activation and rollback order

### Staging acceptance

1. Configure a Resend test domain/account and staging-safe credentials.
2. Add a test Turnstile site and Supabase CAPTCHA secret.
3. Deploy the exact candidate SHA through the guarded workflow.
4. Send only to Resend test recipients first.
5. Verify signup confirmation, manager invitation, staff invitation, password reset, password-change notice, MFA-change notice, delivery event, hard bounce, complaint, suppression, retry, duplicate webhook, invalid signature, expired signature, and worker-disabled states.
6. Confirm the staging deployment SHA, London runtime, readiness/liveness, migration endpoint, and zero unintended synthetic residue.

### Production activation

1. Approve the domain and provider account.
2. Complete DNS and wait for provider verification.
3. Configure the permanent application hostname and exact Supabase URLs.
4. Configure Resend API/SMTP/webhook and verify signed events.
5. Upload Auth templates and enable security notices.
6. Configure Turnstile site key, then enable Supabase CAPTCHA.
7. Keep `NOTIFICATION_DELIVERY_ENABLED=false` until all preceding checks pass.
8. Perform controlled pilot-recipient tests, then enable the worker.

### Rollback

1. Set `NOTIFICATION_DELIVERY_ENABLED=false` to stop application sends without deleting queued messages.
2. Disable Supabase CAPTCHA before removing the application site key if CAPTCHA causes access failure.
3. Restore the previous Supabase Site URL/template/SMTP settings from the captured pre-change snapshot if Auth mail fails.
4. Disable the Resend webhook endpoint in Resend if verification or persistence fails. Do not delete the database delivery ledger.
5. Revert the application release through the protected deployment workflow if code rollback is required.

## Acceptance matrix

The communications milestone is not complete until all rows pass in a non-production environment using fictional identities:

| Flow | Required evidence |
| --- | --- |
| New owner | pilot grant, CAPTCHA, signup, email verification, callback, MFA, legal/onboarding |
| Manager | invitation email, time-limit/replay/binding failures, acceptance, MFA, organisation/site |
| Staff | invitation email, binding/replay failures, acceptance, site selection, self-service |
| Recovery | generic request response, CAPTCHA/rate limit, newest valid link, callback, password change, session finalisation |
| Delivery | accepted, delivered, transient retry, permanent failure, duplicate event |
| Suppression | bounce, complaint, provider suppression, future-send denial, audited manager clearing |
| Security | invalid/stale webhook signature, secret absence, provider outage, disabled worker, no sensitive logs |

## Authoritative references

- Supabase custom SMTP: https://supabase.com/docs/guides/auth/auth-smtp
- Supabase redirect URLs: https://supabase.com/docs/guides/auth/redirect-urls
- Supabase Auth templates: https://supabase.com/docs/guides/auth/auth-email-templates
- Supabase CAPTCHA: https://supabase.com/docs/guides/auth/auth-captcha
