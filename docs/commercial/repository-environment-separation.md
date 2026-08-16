# Commercial Repository and Environment Separation

This document records the Workstream 9.5 infrastructure boundary. It contains identifiers and verification evidence only, never credentials.

## Source checkpoint

- Source repository: `Cloukyo/jan-staff-system`
- Source branch: `codex/commercial-production`
- Approved source SHA: `b8c09c27ada7fe1bcc5469ed995829c68617f9c7`
- Commercial migration history: 66 immutable versions
- Existing PR #8, old Preview and `commercial-dev`: retained as rollback/reference only

## Independent commercial boundary

- Private repository: `Cloukyo/sh-workforce-platform`
- Commercial main initially received the exact approved SHA without rewriting history
- Staging Supabase project: `Commercial Staging`
- Staging Supabase ref: `vytfzjreiptfapybtanx`
- Staging region: London (`eu-west-2`)
- Staging Vercel project: `sh-workforce-staging`
- Staging application target: isolated Vercel Preview configuration with `APP_ENV=staging`
- Automatic deployment from `main`: disabled in `vercel.json`; exact-SHA staging deployment remains manual and pull-request Preview branches remain available
- Stripe: Sandbox/test mode only

The Supabase project is a separately provisioned top-level project. It is not Jan Production, `commercial-dev`, or a branch of either. It began empty and received all 66 migration versions in recorded order.

## Deployment authority

Commercial deploy workflows require `github.repository == 'Cloukyo/sh-workforce-platform'`. Staging provider values belong only to the dedicated Vercel project. The new Vercel project is connected only to the private commercial repository and does not own the Jan Production alias.

No Jan credential may be copied into commercial provider configuration. Future Commercial Production identifiers remain deliberately unprovisioned and non-routable until the approved production-readiness milestone.

## Verification checkpoint

- Fresh application suite at the approved source SHA: 1,127 passing tests
- Staging migration ledger: 66 versions, first `202606100001`, final `20260816025812`
- Staging pgTAP: 9 files and 119 planned assertions passed
- Staging data after replay: zero organisations and zero clock events
- Offline-enabled staging devices: zero
- Staging offline authorisations: zero

Provider acceptance, final CI/security evidence and the before/after Jan comparison must be appended to the completion report after staging deployment. Do not record secrets in this file.

## Protection limitation

GitHub currently states that branch rulesets and classic branch protection are not enforced for this private repository under the organisation's present plan. Before commercial production work, move the repository to an organisation with GitHub Team or Enterprise, require pull requests and the documented checks, require CODEOWNERS review, block force pushes/deletion, and protect the `commercial-staging` and `commercial-production` environments.
