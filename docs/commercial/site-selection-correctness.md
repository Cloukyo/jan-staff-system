# Commercial organisation and site selection

## Scope and root cause

The authenticated UX review at `2716c8562ffc5e180ab373a2c105857bba82f10a` found that choosing an organisation persisted a null site and continued to Home. Home requires a site-scoped attendance actor, so the request reached the error boundary with `site_unavailable` even for an authorised four-site manager.

This correction changes navigation and signed preferences only. It does not change memberships, permissions, MFA, RLS, migrations, recruitment rules, attendance evidence, or payroll calculations. General UX work remains paused until staging acceptance is complete.

## Authoritative context

The existing `commercial_membership` HTTP-only, SameSite=Lax, HMAC-signed cookie remains the only preference. It contains membership ID, site ID and authorisation revision; it is not a permission grant. The current database identity snapshot remains authoritative. Server actions and data loaders continue to enforce permissions independently of middleware.

The site-choice loader uses the authenticated Supabase client, the current organisation, and only site IDs in the current permission map. It also filters inactive and archived sites. Client-submitted membership and site IDs are checked against a newly loaded identity before any preference is written.

## Behaviour

| Situation | Outcome |
| --- | --- |
| Organisation has no authorised sites | A clear No accessible sites state; no entry into Home |
| Organisation has exactly one authorised site | Select it automatically on organisation selection or first direct operational navigation |
| Organisation has multiple authorised sites | Choose a site explicitly before entering operations |
| Valid selected site and revision | Preserve the existing preference across navigation |
| Selected site revoked or revision changed | Reject the previous selection, clear the site preference and request selection again; never silently substitute another site |
| Organisation unavailable | Return to organisation selection without exposing other tenants |
| Organisation switch | Discard the previous organisation's site; apply the zero/one/many rule to the destination |
| Successful password login or logout | Clear the previous membership/site preference |
| Identity provider lookup fails | Fail closed with a non-sensitive retry response |

Home displays the organisation and selected site, with a Change site link. The selector uses the existing shared form and button primitives, with labelled radio controls and mobile-sized touch targets.

## Navigation versus mutations

The GET navigation guard covers Home, Rota, Attendance, Payroll, Compliance, Staff, Leave, Settings, Accounts, Profile and staff self-service route prefixes. Organisation selection, the site selector, onboarding, MFA, kiosk and organisation administration remain outside the site-navigation loop so access can be recovered.

POST actions are not redirected around authorization. Existing sensitive-context, permission and database checks remain in force. A legacy account with no commercial memberships keeps its established account path; an identity RPC failure is not treated as permission to fall back to legacy access.

Safe continuation paths are allowlisted. Unsupported deep-link paths return to Home rather than creating an open redirect.

## Regression evidence

The following executable suites cover the correction:

- `tests/commercial-site-navigation.test.ts`: zero/one/many sites, fresh authorization, cross-organisation rejection, archived/revoked membership, stale revisions, signed preference persistence, protected route coverage and recovery routes.
- `tests/commercial-site-actions.test.ts`: actual selection actions, empty/forged IDs, changes between rendering and submission, unavailable organisations, safe continuation and logout reset.
- `tests/commercial-site-middleware.test.ts`: actual middleware GET redirects, single-site response/request cookie propagation, stale-context clearing, RPC failure, unauthenticated requests, POST separation and legacy compatibility.

Tests were written before implementation. The action tests first reproduced the incorrect Home redirect, missing single-site selection and missing logout reset; middleware tests reproduced direct navigation passing through without a site.

## Staging acceptance and stop point

Use only the retained fictional MFA-enabled Commercial Staging review account. Do not reset its password, disable MFA, accept legal terms, or create real staff records. The pre-verification staging baseline is 5 Auth users, 3 organisations, 5 sites, 6 memberships and 1 staff profile. Existing fictional fixtures are retained; this correction does not require creating new fixtures.

Before closing the gate, verify the exact merged SHA through the established commercial staging workflow, CI, Security and CodeQL; check London runtime, liveness, readiness and the unchanged 78-entry migration ledger ending at `20260908015659`. Exercise organisation selection, the four-site selector, Home context, site switching and site-scoped navigation, including mobile selection. Report browser gaps separately from automated test coverage.

Once the correctness gate is closed, resume the authenticated current-state UX review of the already-merged shared primitives, Dashboard, Attendance and Payroll passes. Do not redo those passes from scratch. Use that rendered evidence to close their verification gaps before beginning the next planned Rota desktop/mobile pass. The public website remains deferred.
