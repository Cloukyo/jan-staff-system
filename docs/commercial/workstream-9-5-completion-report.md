# Workstream 9.5 Completion Report

Status: complete

Acceptance date: 18 August 2026

Environment: independent Commercial Staging only

## Environment boundary

- Repository: `Cloukyo/sh-workforce-platform`
- Supabase project: Commercial Staging, `vytfzjreiptfapybtanx`, London (`eu-west-2`)
- Vercel staging application: `https://sh-workforce-staging.vercel.app`
- Stripe: `SH Digital Works sandbox`, test resources only
- Application baseline accepted before this report: `3cf4a56b09cb503fcb936c1e8f0f3a612e571068`
- Commercial Production does not exist and no Production deployment was created.
- Jan Production was neither accessed nor modified during this closure pass.
- Offline attendance remained disabled throughout.

## Closure results

### 1. Stripe Hosted Checkout

Pass. A new fictional organisation completed the actual application Checkout flow through Stripe-hosted Checkout. The browser return did not independently grant paid access. Signed `checkout.session.completed`, `customer.subscription.created`, and `invoice.paid` webhooks reached Commercial Staging and established one authoritative provider customer and one provider subscription. The original 60-day application trial timestamps were preserved. No duplicate subscription or operational evidence change occurred.

### 2. Stripe failure, grace, restriction and recovery

Pass.

- The Stripe subscription was converted from trialing to active in sandbox and the signed paid-invoice webhook activated the application subscription.
- Stripe's official decline-after-attachment test card was attached to the fictional sandbox customer.
- A real £49 sandbox invoice attempt was declined. Stripe recorded the failed attempt and delivered a signed `invoice.payment_failed` webhook.
- Commercial Staging entered `past_due` with one fixed 14-day grace window: 18 August 2026 02:02 BST to 1 September 2026 02:02 BST.
- During grace, clock-in, clock-out, corrections, attendance review, essential reports, customer export and subscription recovery remained available. Growth, imports, advanced exports, integrations and premium mutation were blocked.
- The production scheduler boundary was evaluated one second after the recorded deadline. It entered `billing_suspended` and appended `restricted_mode_entered`; it did not manufacture a provider event.
- In restricted mode, operational continuity, customer export and recovery remained available while growth stayed blocked.
- The original successful sandbox payment method was restored and the open invoice was genuinely paid through Stripe. The signed `invoice.paid` webhook recorded `payment_recovered`, restored `active` and restored full Standard entitlements.
- Trial history remained preserved and no organisation or subscription duplication occurred.
- A prior Northstar sandbox sequence contains two distinct failure deliveries but only one `grace_started` event, supporting the non-sliding grace invariant. Processor and pgTAP tests independently assert later failures do not extend the original deadline.

The Checkout-created customer was not created under a Stripe Test Clock, and Stripe does not permit attaching one later. A periodic renewal for that particular customer was therefore not falsely claimed. Genuine `renewal_succeeded` evidence already exists for the fictional Northstar subscription in the same independent Stripe sandbox and Commercial Staging database.

### 3. Assignment transfer

Pass. The supported post-live command added Site B assignment and changed the fictional staff member's primary operational site with effective dates. Historical attendance, rota and payroll site attribution remained unchanged. New operational context resolved through the current assignment.

### 4. Site-manager scope

Pass. A fictional, auto-confirmed Site A manager with AAL2 was exercised through the application/server boundaries. Site B site edit, staff assignment, kiosk management, rota edit and leave approval returned `permission_denied`. Sensitive Site B payroll returned a non-enumerating result and no data. The owner equivalent succeeded in rolled-back acceptance transactions. The fixture membership, role and site access were revoked after the test; the fictional Auth identity and immutable onboarding evidence remain documented staging fixtures.

### 5. Kiosk replacement and revocation

Pass. A fictional online kiosk was registered, claimed, verified, revoked and replaced through supported post-live device management. The revoked credential failed immediately, the replacement credential worked, the old credential remained invalid, site binding was correct, and historical attendance/device audit remained intact. No unnecessary attendance was created. Offline capability and authorisation remained unavailable.

### 6. Unauthenticated `/admin`

Pass. The root cause was an expected commercial identity exception escaping the protected server component and becoming HTTP 500. A shared protected-route recovery boundary now maps unauthenticated/expired sessions to sign-in, stale or revoked organisation context to authoritative selection, MFA downgrade to the existing MFA route, and permission denial to a non-enumerating not-found result. Unexpected failures still rethrow. Regression coverage includes unauthenticated, expired, invalid preference and revoked-membership states across protected administration routes.

### 7. Supabase security advisor

Pass. The opening dashboard showed approximately 126 notices. The final advisor result is 113 notices: 9 `rls_enabled_no_policy`, 11 anonymous `SECURITY DEFINER`, and 93 authenticated `SECURITY DEFINER`. Category A unresolved findings are zero. Every retained category is dispositioned in `docs/commercial/supabase-security-advisor-disposition.json`, including the fixed search path, narrow grant, token or membership authority, tenant fence and test evidence. The remaining notices are deliberate deny-all tables, token-authenticated public workflows, membership-guarded application RPCs, or documented compatibility boundaries.

### 8. Staging Production authority

Pass. Git-triggered Vercel deployment is disabled for the staging project. Production aliases and Production secrets are absent. Environment validation fails closed if `APP_ENV=staging` is paired with `VERCEL_ENV=production`. A future Commercial Production release requires a different project and explicit promotion process. The historical failed `target=production` record is retained as harmless audit evidence and never became READY.

### 9. Repository and staging alignment

Pass at the accepted application baseline. Commercial repository `main`, the manual Vercel staging deployment and `/api/health` all reported `3cf4a56b09cb503fcb936c1e8f0f3a612e571068` before this documentation-only closure commit. The closure document is the only subsequent repository delta and must pass the same CI and staging SHA check after publication.

### 10. Authenticated visual acceptance

Pass. Thirty-nine authenticated route/viewport combinations were reviewed across desktop, tablet and 390px mobile. Coverage included live welcome/dashboard, staff, rota, attendance, leave, payroll, sites, access, kiosk devices, settings, billing and historical onboarding/readiness. Navigation, site context, hierarchy, overflow, tables, touch targets, focus, errors, empty states, loading states, confirmation and permission-denied states were accepted. No acceptance-blocking visual defect remained.

The billing screenshot shown during Hosted Checkout acceptance used an explicitly fixed 1280 x 900 test viewport. On ordinary maximised browsers the shell occupies the window; primary content is intentionally capped near 1280px for legibility on very wide screens.

## Full staging smoke

Pass. Authentication, organisation selection, multi-site data, staff, effective assignments, permissions, online kiosk, attendance, correction, rota, leave, planned-versus-actual comparison, payroll preparation, billing, post-live administration and tenant isolation were exercised with fictional data only.

## Verification

- Complete Vitest suite: 146 files, 1,147 tests passed.
- Focused closure regression suite: 19 passed.
- Focused kiosk and migration suite: 15 passed.
- pgTAP: 9 files, 123 planned assertions passed.
- Migration history: 6 commercial history checks passed.
- PGlite migration replay: passed.
- Clean Docker-backed Supabase replay: passed in CI.
- TypeScript: passed.
- ESLint: passed with 0 errors and 3 documented non-blocking warnings.
- Production build: passed.
- Dependency audit: 0 vulnerabilities.
- CodeQL/private SARIF: passed.
- Gitleaks and browser sensitive-marker scan: passed.
- Dependency review: passed.
- Supabase advisor: 113 fully dispositioned notices; 0 unresolved Category A findings.

## Evidence invariants

Northstar operational evidence remained stable through billing acceptance:

- Clock events: 2, exactly one clock-in and one clock-out.
- Corrections: 1, retained separately from original events.
- Sites: 4.
- Staff profiles: 1.
- Staff-site assignments: 2.
- Rota weeks: 1; rota shifts: 2.
- Leave requests: 1.
- Payroll preparation runs: 1; rows: 1.
- Unresolved attendance exceptions: 0.
- Open-shift balance: 0.
- Offline-enabled devices: 0.
- Offline authorisations in Commercial Staging: 0.

The accepted before/after attendance and correction comparisons remained equal. The final canonical database fingerprints recorded after billing acceptance are:

- Clock-event rows: `0b15b193303128cb690907eae7f230913d7756822a827db65acb6a494a22c769`
- Correction rows: `d991372ff85c3526c2fe84b8fe46343b8ea914ddd56da7f680c884f6516f5265`

These fingerprints cover the complete stored fictional rows in deterministic ID order. They supplement, rather than replace, the earlier field-scoped acceptance fingerprints.

## Deferred boundary

Workstream 10 owns Production Email and Notifications: real email delivery, verified sender/domain configuration, template delivery, bounce handling, notification preferences and operational monitoring. Controlled fictional identities remain acceptable staging fixtures. No production verification bypass exists; staging helpers remain environment-gated.

## Old infrastructure cleanup recommendation

No old infrastructure was deleted during Workstream 9.5. After explicit approval, clean up in this order:

1. Export final audit metadata for old draft PR #8, `commercial-dev`, and old Preview deployments.
2. Confirm independent Commercial Staging remains healthy and its secret inventory is complete.
3. Remove old Preview-only Vercel environment variables and deployment aliases.
4. Delete the old `commercial-dev` Supabase branch only after its project reference is rechecked and confirmed different from both Commercial Staging and Jan Production.
5. Close or archive PR #8 with a pointer to `Cloukyo/sh-workforce-platform`.
6. Retain repository history and deployment audit records; do not erase evidence merely to make dashboards look clean.

Each destructive step requires separate explicit approval. Jan Production is excluded from every cleanup target.

## Final decision

Workstream 9.5 meets its definition of done. The independent commercial repository, Supabase staging project, Vercel staging application and Stripe sandbox operate together; no unresolved pilot-blocking Critical or Important commercial security issue remains. Workstream 10 has not begun.
