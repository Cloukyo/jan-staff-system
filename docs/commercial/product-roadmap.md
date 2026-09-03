# Commercial Product Roadmap

## Product position

The initial product is for independent UK nurseries and preschools.

> Staff management for independent nurseries - rota, clock-in, leave, compliance and payroll-ready hours in one place.

> Works alongside the nursery software you already use.

The product does not initially replace Tapestry, Famly, or a full nursery-management platform. Its core connected loop is:

`Staff record -> compliance -> rota -> clock-in -> attendance -> leave -> payroll-ready hours`

The commercial wedge is staff operations. Competition across rota, clocking, live ratios, DBS and qualification tracking, compliance, payroll hours, and inspection evidence does not justify copying every all-in-one feature. Child learning journals, parent communication, child invoicing, medicine and incident management, observations, enquiries, extra-day requests, and pickup management remain out of scope unless customer evidence changes the decision.

## Milestone 1: Pilot containment and release discipline

Control pilot signup, contain public signup, repair the notification worker path, reconcile release lineage, require exact-SHA staging evidence, strengthen deployment guardrails, align password and abuse controls, and document administrator-security prerequisites. Complete and verify this milestone before later work.

## Milestone 2: Domain, email, and production security

Select the permanent brand and domain architecture before final Auth redirects, email branding, Stripe webhooks, legal URLs, and marketing links. The likely pattern is a public `brand.co.uk` site and an `app.brand.co.uk` application, but names are not assumed yet.

Configure production-capable verification, invitation, security, trial, payment-recovery, and operational email with SPF, DKIM, DMARC, bounce handling, suppression handling, and delivery-failure visibility. Complete the PITR decision and restore rehearsal, administrator MFA and recovery controls, network and SSL hardening, usage alerts, abuse controls, CAPTCHA/rate-limit decisions, and practical region alignment.

## Milestone 3: Competitive readiness

Strengthen the staff-operations wedge rather than broaden the product indiscriminately.

- Verify September 2026 EYFS recruitment and suitability requirements from current authoritative sources before implementing employee/volunteer classification, DBS status and dates, start-date safeguards, suitability declarations, evidence history, and inspection export.
- Verify UK employer requirements for annual-leave and holiday-pay records before changing leave, attendance, payroll preparation, audit, export, or retention behaviour.
- Improve inspection and payroll evidence exports without becoming a generic document platform.
- Explore a manager-readable connection between planned hours, clocked hours, attendance exceptions, leave, approved/payable hours, payroll readiness, and staff compliance. This requires UX design before implementation.

## Milestone 4: UI/UX improvement programme

Consolidate the completed independent audits into one implementation specification. Preserve the useful operational density and current visual language rather than performing a wholesale redesign.

Priorities are dashboard work queues, attendance review, payroll hierarchy, rota warning hierarchy, mobile rota, mobile attendance/payroll, compliance polish, shared design consistency, accessibility verification, and remaining screen polish. Keep useful desktop tables, the weekly rota grid, and the simple kiosk flow unless user testing supports a change. Avoid decorative trends, unnecessary cards, animation, and whitespace that slow busy managers.

## Milestone 5: Public website and SEO

Launch the public website relatively early with `Join the pilot` as the initial primary CTA. Cover staff management, rota, clock-in, attendance, leave, compliance, payroll-ready hours, and pricing.

Research regulatory and high-intent content from current authoritative UK sources before publication, including nursery DBS and volunteer requirements, starting before DBS clearance, EYFS suitability, leave and holiday-pay records, rota software, and clock-in/payroll hours. Content must be useful and accurate rather than SEO spam.

## Milestone 6: Billing and commercial operations

After domain and email foundations, configure live Stripe products and prices, Checkout, Customer Portal, signed webhooks, trial conversion, payment failure, grace, recovery, cancellation, reconciliation, and cost alerts. Keep the existing production billing guard until this phase is separately reviewed and tested. Pricing remains a hypothesis: founding customers around GBP 29-39 monthly with free onboarding, standard pricing around GBP 49 monthly, and later multi-site tiers, subject to updated competitor and unit-economics review.

## Milestone 7: Monitoring, legal, and operations

Before normal paid customers, establish external uptime and error monitoring, notification and cron alerts, billing webhook monitoring, database health, incident response, support, privacy and terms, retention/deletion procedures, vendor documentation, business contact details, and production cost alerts.

## Milestone 8: Controlled real-nursery pilot

Onboard at least one external nursery through owner signup, organisation setup, staff import/invitations, compliance, rota, kiosk, clocking, attendance review, leave, payroll preparation, and export. Exercise email, recovery, MFA, any enabled pilot billing, cancellation/export, support, and incident procedures. The proof point is operation without developer intervention.

## Go-to-market sequence

Market only the Early Years/nursery product initially while avoiding unnecessary core-platform assumptions that would obstruct later Care, Clubs, or Clinics variants. Progress deliberately from one external nursery to 5, 25, and 50 before validating another vertical.

## Product-planning test

Evaluate major work against four questions:

1. Production: is it secure, reliable, tenant-safe, and supportable?
2. UX: can a busy nursery manager or staff member use it efficiently?
3. Competitive: does it strengthen real differentiation rather than copy competitors?
4. Commercial: does it materially help acquisition, conversion, retention, or supportability?

Avoid features that score poorly across these dimensions merely because a competitor offers them.

