# Commercial billing lifecycle

Workstream 9 integrates Stripe behind provider-neutral contracts. Stripe is the first provider because hosted Checkout, the hosted Customer Portal, signed webhooks, test clocks and sandbox payment methods cover the approved lifecycle without handling raw card data in the application. Provider IDs remain confined to billing mapping, intent and webhook records.

## Commercial policy

- The ordinary trial remains no-card and starts only at Go Live. Its authoritative duration remains exactly 1,440 hours.
- Adding payment details during a trial passes the existing trial end to Stripe. Inside Stripe's 48-hour Checkout minimum, the provider receives a short trial that ends no earlier than the authoritative local trial; local trial history is not restarted, shortened or rewritten.
- Trial expiry enters a 168-hour conversion grace. Paid payment failure enters a 336-hour recovery grace.
- Grace and restricted modes never change RLS visibility, organisation membership, attendance evidence, corrections, rota, leave or payroll history.
- Restricted mode preserves existing-footprint attendance, necessary clock-out, attendance review/correction, essential reports, complete customer export and billing recovery. It blocks growth and premium mutations according to the frozen matrix.
- Cancellation is requested for period end. It does not delete customer data; final retention and deletion belong to the later offboarding workstream.

## Staging configuration

Configure only the dedicated `sh-workforce-staging` Vercel project and independent Commercial Staging Supabase project:

1. `STRIPE_SECRET_KEY`: Stripe test secret beginning `sk_test_`.
2. `STRIPE_WEBHOOK_SECRET`: signing secret for `/api/billing/stripe/webhook`.
3. `STRIPE_PRICE_MAP_JSON`: environment-scoped mapping, for example `{"staging":{"preview_standard":{"1":"price_test_..."}}}`.
4. Register the staging webhook destination for Checkout completion, subscription create/update/delete, invoice paid and invoice payment failed.
5. Configure the Stripe test Customer Portal for payment-method update, invoices and period-end cancellation.

The application refuses live billing in this milestone. None of these values use a `NEXT_PUBLIC_` prefix. Do not reuse staging keys, signing secrets, products or Prices for future Production. The retained `commercial-dev` branch and old PR Preview are rollback references only and have no staging authority.

## Reconciliation and ordering

The webhook signature is verified against the raw request body before any database call. The application stores a provider event ID, event type, object ID, provider-created timestamp and safe result only. Duplicate IDs are acknowledged without reapplying their outcome. Failed processing remains recorded and is retryable. Once a provider subscription is authoritative, subscription-scoped events must identify that exact subscription.

Failure, cancellation and deletion are classified before price changes. A changed Price is materialised only with a successful invoice, so it cannot end a live trial or restore access without payment. Invoice lifecycle ordering and subscription-object observations use separate timestamps. A newer active subscription observation can reject an older contradictory failure without itself counting as payment; an older successful invoice can still provide the payment evidence needed for recovery. Older lifecycle events cannot replace newer state. Equal-second conflicts use durable precedence: deletion, cancellation, successful payment, then failure. The first failure fixes the 336-hour paid grace deadline; later failure attempts do not restart it. A paid adjustment cannot clear a scheduled cancellation; only an explicit subscription update can do so. Resuming restores the appropriate active or still-trialling state and removes the scheduled restriction transition.

An hourly Supabase Cron job advances expired trials and grace intervals using database time. Provider reconciliation and scheduled reconciliation append lifecycle evidence. They never synthesize attendance actions.

## Test-mode lifecycle checklist

Use a fictional staging organisation and official Stripe test methods only:

1. Confirm the Go Live trial dates remain unchanged when Checkout is created.
2. Complete hosted Checkout and confirm the signed webhook links the customer and subscription.
3. Send invoice success, payment failure, recovery, plan change, period-end cancellation and deletion events.
4. Advance a Stripe test clock where available; independently confirm the database 168/336-hour reconciliation boundaries.
5. Compare counts and immutable hashes for clock events, corrections, attendance exceptions, staff, sites, rota, leave and payroll before and after.
6. Confirm zero offline-enabled devices and zero live offline authorisations.

## Operational recovery

Do not treat a browser return from Checkout as payment authority. If Checkout succeeds but the return page or webhook is interrupted, reuse the same local intent and Stripe idempotency key, inspect the webhook ledger, and retrieve the provider subscription before retrying. A provider outage must not shorten grace. Failed webhooks retain a safe failed status for support investigation without exposing payment data.
