# Commercial rota and leave tenancy

Workstream 8A adds an owned commercial path without changing the wholly unowned Jan compatibility path.

## Converted tables

The additive migration converts all seven inherited operational tables:

1. `rota_settings`
2. `rota_weeks`
3. `rota_shifts`
4. `rota_templates`
5. `rota_template_shifts`
6. `rota_template_applications`
7. `leave_requests`

Commercial settings, weeks, shifts, templates and applications are organisation/site fenced. Leave remains organisation/staff owned, with only optional source-site context.

## Ownership

- Commercial rota weeks and shifts are owned by one organisation and one occurrence site.
- Commercial template definitions, template shifts and applications are owned by the same organisation and site.
- Commercial leave requests are owned by the organisation and staff profile. `source_site_id` is optional context, not the leave tenant boundary.
- Shift occurrence sites and leave history remain unchanged when staff assignments later change.

Composite foreign keys fence organisations, sites, staff profiles and work areas. Ownership triggers reject moving a commercial record to another organisation or site. New commercial writes use guarded commands, expected revisions and idempotency receipts. Append-only rota and leave events retain safe audit evidence.

## Permissions and conflicts

Rota reads and changes use the commercial permission catalogue and selected-site scope. Leave self-service resolves the authenticated membership's linked staff profile. Leave review rechecks organisation permissions, relevant site scope and AAL2.

Shift validation is server authoritative. It checks effective-dated site assignment, the selected site's work areas and closures, approved leave, and overlapping shifts across all organisation sites. Approved leave never deletes or rewrites an existing shift. Review results report how many shifts require manager attention.

Date-only week, shift and leave values remain PostgreSQL `date` values and are accepted only in exact `YYYY-MM-DD` form at the RPC boundary. The UI continues to display UK dates. Attendance instants remain governed by Europe/London semantics in the existing attendance engine.

A site-scoped manager receives stable generic conflict codes such as `cross_site_overlap` without another site's private schedule details. Organisation-wide authorised schedulers can use their permitted site views to investigate. Commercial lifecycle changes are RPC-only; direct customer writes have no commercial RLS policy.

## Planned hours

`get_commercial_planned_shifts` is the authoritative commercial adapter. It returns published, active shifts for the requested organisation/site/date scope. Attendance comparison and payroll context consume this adapter, while attendance pairing and payable-minute calculations remain unchanged.

The commercial planned-hours correction functions append corrections separately from immutable clock evidence. They require the selected site, `attendance.correct`, AAL2 and the displayed attendance revision. They do not rewrite clock events.

## Jan compatibility

Rows with both `organisation_id` and `site_id` null remain on the existing Jan code, RLS policies and RPCs. Commercial records cannot fall back to this path. No Jan rows are backfilled or assigned guessed ownership in Workstream 8A.

The legacy path can be removed only after a separately approved Jan migration has assigned and verified organisation/site ownership, all callers use commercial identity, and production evidence/reconciliation checks have passed. That removal is outside Workstream 8A.

## Remaining boundary

Workstream 8B may add ordinary post-live customer administration. It must reuse these tenant boundaries. Billing-provider integration, offline attendance and any Jan migration remain out of scope.
