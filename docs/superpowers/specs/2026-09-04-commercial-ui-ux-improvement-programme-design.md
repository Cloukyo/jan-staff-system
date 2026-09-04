# Commercial UI/UX Improvement Programme Design

**Date:** 4 September 2026  
**Candidate baseline:** `c1da0a0a94bcd9328f3356f187fe7e5f804eb1a4`  
**Status:** Design specification for approval. No UI implementation is included in this document.

## 1. Purpose

This milestone refines the commercial workforce application for independent UK nurseries and preschools. It does not replace the existing product structure or visual identity. It improves prioritisation, task completion, responsive behaviour, accessibility and consistency around the established operational model:

`Staff record -> compliance -> rota -> clock-in -> attendance -> leave -> payroll-ready hours`

The intended outcome is a release-candidate-quality application that a busy nursery manager can understand and operate confidently without learning the application's internal data or state-machine terminology.

## 2. Evidence reviewed

The design is based on:

- The exact commercial candidate at `c1da0a0a94bcd9328f3356f187fe7e5f804eb1a4`.
- Current manager, staff, kiosk, onboarding and commercial-admin routes and components.
- The existing 55-image UX audit package and its feature coverage matrix.
- The previous manager UX implementation plan and preserved design specifications.
- The Competitive Readiness implementation, including recruitment, suitability, operational-readiness, leave-evidence and payroll-readiness states added after the original screenshots.
- Current shared primitives, navigation, global styling and focused UI tests.
- Rendered local demo states at 1440 x 1000 and 390 x 844 using fictional data.
- Current Commercial Staging release evidence. The deployment is Vercel-protected, so anonymous visual inspection is intentionally unavailable. Visual inspection therefore uses the same candidate locally, while staging SHA, health and environment checks remain separate release evidence.

The existing audit package remains useful as interaction documentation, but it is no longer a sufficient representation of the current commercial product. It predates newer commercial onboarding, tenant administration and Competitive Readiness states.

## 3. Users and operating conditions

### Manager and owner

Needs a fast operational overview, clear queues, efficient desktop comparison and safe bulk actions. The user is often interrupted and should be able to resume without reconstructing hidden state.

### Deputy manager

Uses most day-to-day rota, attendance, leave and staff workflows, subject to organisation and site permissions. The UI must make unavailable actions clearly read-only rather than appearing broken.

### Staff member

Needs simple access to personal rota, attendance, correction requests, leave and profile/security tasks. Private pay and other staff records remain inaccessible.

### Kiosk user

Needs a short, touch-first flow: choose name, enter PIN, choose attendance action, receive unmistakable confirmation, and return automatically.

### Commercial administrator

Uses a separate permission-controlled administration area. Environment and organisation context must remain visible because it prevents operational mistakes.

## 4. Baseline assessment

The application already has a coherent foundation:

- Persistent grouped navigation on desktop and an accessible mobile drawer.
- A restrained purple, lavender and white identity with conventional controls.
- Useful desktop information density.
- Large controls and visible focus treatment in many key flows.
- Text labels accompanying status colour.
- Strong immutable-evidence and audit explanations in attendance and payroll.
- A suitable desktop rota grid and a production rota component that already supports day-focused mobile use.
- Direct links from the dashboard to several operational destinations.
- Staff lifecycle behaviour that explains what deactivation preserves and archives.
- A clear kiosk interaction model with large touch targets and recovery states.

The main weakness is inconsistent prioritisation. Several screens expose all available controls, counters or technical status at equal weight. This makes safe, capable workflows feel more complicated than their actual manager decisions.

## 5. Consolidated audit findings

### 5.1 Findings already resolved or materially superseded

These findings must not be implemented again:

- The primary manager navigation has already been reduced to task-oriented labels such as `Clock-ins & hours`, `Staff records`, `Export pay hours`, `Rota templates` and `Clocking-in devices`.
- Compliance and account setup no longer require equal permanent primary-navigation weight. They are reachable contextually through staff records and relevant manager flows.
- The dashboard is no longer purely passive. It includes direct routes for attendance, leave, rota and compliance work.
- Attendance correction already distinguishes original evidence from manager corrections and explains correction scope.
- Staff records already provide contextual sections for clocking, login and pay where appropriate.
- Deactivation now explains and performs the required archival and access effects while preserving history.
- The production rota already supports a one-day mobile view and accessible previous/next controls.
- The mobile navigation drawer already includes focus return, Escape handling and a compact page-section selector.
- Customer-facing navigation no longer depends on internal labels such as `Accounts` or multiple equal top-level payroll destinations.

### 5.2 Findings that remain valid

- Status meaning is encoded with feature-specific colours and copy rather than one shared semantic contract.
- Informational, attention, warning, blocking and destructive states are not consistently distinguished.
- Dashboard information is actionable but still lacks one ranked `needs attention` hierarchy across attendance, leave, recruitment and payroll readiness.
- Attendance filters, summary counts, status tabs and bulk actions compete visually before the user sees the records that need a decision.
- Attendance exception text repeats per row and can obscure the difference between cause, consequence and next action.
- Payroll preparation exposes period, run, revision and approval details before answering whether the selected period is ready and what the manager must do next.
- Payroll warnings, adjustments, acknowledgement, approval and export are technically safe but visually presented as separate implementation stages.
- The demo payroll table becomes a long, low-context sequence on mobile before row-level decisions become available.
- Rota destructive actions compete with routine controls, and similarly named copy actions need explicit scope.
- Rota warning icons are accessible but need a consistent visible severity and explanation pattern.
- Compliance summary counters have equal visual weight even when consequences differ substantially.
- The expanded recruitment and suitability record is necessarily detailed, but mobile users encounter a long undifferentiated form before seeing immediate actions.
- Forms and dialogs use several locally implemented patterns for feedback, action order and destructive controls.
- Loading, partial-error, empty and post-success treatment varies by feature.
- Source-level accessibility assertions exist, but there is not yet a single automated accessibility check across representative rendered routes and interaction states.

### 5.3 Findings deliberately rejected

- A wholesale visual redesign or new brand language.
- Replacing efficient desktop tables with decorative card lists.
- Removing operational detail from desktop views solely to create whitespace.
- Replacing the desktop weekly rota grid.
- Adding charts without a direct operational decision.
- Adding broad animation, glass effects, decorative gradients or novelty interactions.
- Turning payroll into a wizard that hides the manager's ability to move between staff and issues.
- Adding confirmation dialogs to every save or reversible action.
- Building a tutorial system when direct copy, useful empty states and clear labels are sufficient.
- Adding child-management or generic nursery-management features during a UI milestone.

## 6. New Competitive Readiness implications

The newer authoritative states change how several screens should communicate, but they do not justify duplicating business logic in the UI.

- Recruitment and suitability must use the shared server-derived action state. UI components display the result and direct the manager to the authoritative staff record.
- `Blocked from starting`, `Action required`, `Due soon` and `Complete` must not appear as visually equivalent compliance badges.
- Rota should surface recruitment or suitability context only when it affects the shift being viewed or edited. It must not become a second compliance dashboard.
- Payroll should present authoritative blocker, warning and information counts before internal run details. The exact revision and fingerprint remain available as secondary audit detail.
- Leave and holiday-pay evidence remain available in the records workflow, but ordinary approval should show only information required for the decision.
- Encrypted or restricted evidence controls, including DBS last-four reveal, must clearly state what will be shown without implying that a complete identifier is exposed.
- Dashboard queues should link to filtered authoritative views rather than recalculate readiness in browser code.

## 7. Design direction options

### Option A: token-only polish

Refine colours, spacing and component appearance without changing screen hierarchy. This is low risk but too shallow for attendance, payroll and compliance.

### Option B: controlled workflow-led refinement

Keep routes, domain behaviour and desktop operational models. Add shared semantic primitives and revise each major screen around the user's next decision. Use responsive task-specific presentations where the current table cannot support mobile completion.

**Recommended.** This addresses the audits while preserving tested architecture and limiting each pass to reviewable changes.

### Option C: new information architecture and visual system

Replace navigation, layouts and major workflows together. This creates unnecessary relearning, regression risk and scope expansion. It is rejected.

## 8. Shared design system contract

### 8.1 Preserved visual foundation

- Existing purple brand family, lavender page background and white operational surfaces.
- Existing typography family and familiar heading character.
- Existing sidebar and mobile drawer behaviour.
- Existing compact desktop spacing where it supports comparison.
- Existing 44px minimum ordinary target and larger kiosk targets.
- Existing soft borders and shadows, reduced where hierarchy does not require elevation.

### 8.2 Semantic state model

Introduce semantic names independent of feature implementation:

| Semantic level | Meaning | Typical examples | Required treatment |
| --- | --- | --- | --- |
| Information | Context only | Export detail, evidence source | Neutral/blue-grey surface, information icon, no action implication |
| Success | Completed/current | Approved, ready, synced | Green treatment, explicit completed label |
| Attention | Review is useful | Expiry approaching, pending request | Amber treatment, direct optional/review action |
| Blocking | Must be resolved | Missing required clock event, unsafe start, stale payroll inputs | Red treatment, reason and direct required action |
| Destructive | Action can remove/revoke/close | Clear week, deactivate, revoke, reopen approved revision | Red control reserved for the action, concrete confirmation when needed |

Status components must always include text. Icons supplement meaning but do not replace labels. Counts inherit the highest consequence represented, not merely the largest number.

### 8.3 Core primitives to refine or introduce

- `PageHeader`: eyebrow, page title, concise purpose and one primary action area.
- `StatusBadge`: semantic `information`, `success`, `attention`, `blocking`, `neutral` API. Existing colour-tone calls are migrated incrementally.
- `Alert`: title, concise explanation, optional next action, semantic level and optional expandable evidence.
- `ActionSummary`: ranked counts and direct destinations for the current workflow.
- `EmptyState`: first-use and filtered-empty variants with an appropriate primary action.
- `InlineFeedback`: pending, success and failure announcement with `aria-live` behaviour.
- `Dialog`: labelled title/description, focus trap, Escape/close behaviour, initial focus and return focus.
- `FormActions`: consistent primary, secondary and destructive order; mobile stacking without changing semantic order.
- `ResponsiveDataView`: preserves tables for desktop comparison and provides labelled focused records on mobile when horizontal scrolling would prevent task completion.
- `DetailDisclosure`: hides evidence and audit metadata until requested while keeping it keyboard reachable.
- `Skeleton` or bounded loading panel only where a route genuinely streams or waits. Do not add decorative loading effects to synchronous demo views.

### 8.4 Typography and spacing

- One `h1` per page with a concise supporting sentence.
- `h2` for task regions, `h3` for records or subsections, not for visual size alone.
- Summary numbers use a consistent compact metric style with labels above values.
- Page sections use a predictable 20 to 24px vertical rhythm on desktop and 16 to 20px on mobile.
- Operational tables remain compact, with sufficient row separation and sticky headers where scrolling is expected.
- Long forms group fields by decision rather than by database table.

### 8.5 Buttons and actions

- At most one visually dominant primary action per task region.
- Secondary actions remain bordered/neutral.
- Destructive red is reserved for destructive actions, never ordinary rejection state display.
- Link labels describe destinations: `Fix attendance`, `Review 3 requests`, `Open staff record`.
- Consequential confirmations state object, count, date range and preservation/reversibility where relevant.
- Reversible ordinary saves do not receive confirmation dialogs.

### 8.6 Forms and validation

- Labels remain visible and do not rely on placeholders.
- Required state is communicated in text at form level and field level where ambiguity exists.
- Errors appear next to the affected field and in an accessible summary for long forms.
- Server errors preserve entered values where safe.
- Successful saves produce a visible, announced result and retain context.
- Contextual editors identify the staff member, date, period or record in the heading.
- Unsaved-change protection is used only for substantial forms where accidental loss is plausible.

### 8.7 Responsive principle

**Desktop:** overview, comparison and bulk operations.  
**Mobile:** lookup, focused decision and individual action.

Mobile must not hide an action required to complete a reasonable manager task. Dense desktop tables may become labelled record summaries, but their information and actions remain available.

## 9. Navigation and page architecture

The simplified primary manager navigation remains. No top-level restructuring is planned in Pass B unless interaction testing identifies a concrete failure.

- `Export pay hours` remains the task-oriented primary destination.
- Pay arrangements, import review and pay preparation remain separate routes for safety and deep linking, but receive a shared local Payroll navigation and clear stage descriptions.
- Staff login/account functions remain contextual to staff records where possible.
- Compliance remains reachable through staff records and direct action links.
- Browser back/forward behaviour and direct routes remain supported.
- Permission-hidden destinations remain absent rather than disabled without explanation.

## 10. Controlled implementation passes

Each pass begins from a clean candidate, records baseline screenshots, adds focused tests before implementation, runs the relevant suite, captures updated screenshots, performs keyboard/mobile interaction checks and ends in one coherent commit.

### Pass A: design system and shared semantics

**Problem:** Repeated local styles and colour-based feature semantics make later improvements inconsistent.

**Solution:** Add semantic state tokens and the shared primitives in Section 8. Preserve existing visual values where they already satisfy the contract. Migrate representative shared components first; do not mechanically rewrite all components.

**Likely files:** `src/app/platform.css`, `src/components/ui/primitives.tsx`, `src/components/shared/status-badge.tsx`, `src/components/shared/empty-state.tsx`, new narrowly scoped shared components, component tests.

**Acceptance:** All semantic states include text, controls retain at least 44px targets, focus remains visible, and reduced-motion preferences remain respected.

### Pass B: dashboard and navigation

**Problem:** Existing useful signals do not form one clear answer to `What needs my attention now?` and newer readiness states are not prioritised together.

**Solution:** Create a ranked action queue with direct filtered links, followed by today's staffing context and then lower-priority summaries. Do not duplicate the same issue in both metrics and cards. Add recruitment/payroll readiness only when it changes a manager decision. Keep the current navigation labels and structure unless testing proves a route is undiscoverable.

**Desktop:** compact queue plus operational today view.  
**Mobile:** action queue first; secondary summaries follow.  
**Likely files:** dashboard components, manager navigation only if evidence requires it, dashboard query/view-model code and tests.

**Acceptance:** A manager can identify the highest-priority action and open its filtered destination without interpreting raw counts.

### Pass C: attendance

**Problem:** Filters, counts, tabs and bulk actions compete, while repeated exception pills make scanning difficult.

**Solution:** Order the page as: attention summary, scoped filters, records, contextual bulk action. Keep clean/exception segmentation. Show the primary reason and action in each row; move supporting evidence into row detail. Keep original events visible in review/correction. Bulk controls must state visible/selected/range scope and exclude ineligible rows clearly.

**Desktop:** retain comparison table and efficient selection.  
**Mobile:** focused record list, persistent current filters, individual review/correct/approve, and scoped bulk action only where safe.  
**Likely files:** production and demo attendance screens, review and correction components, page navigation, shared table/feedback primitives and attendance UI tests.

**Acceptance:** A manager can distinguish blockers from clean records, understand why a record needs action, correct it without losing evidence, and see the result after returning.

### Pass D: payroll

**Problem:** The safe state machine is visible as implementation terminology and the next action is not visually dominant.

**Solution:** Lead with period/scope and a single readiness statement. Present blockers, warnings and information in ranked groups with direct remediation. Prepare/recalculate automatically when architecture safely permits it; otherwise use a clear single action. Keep acknowledgement only for genuine warnings and collect one meaningful note for the acknowledged set. Make `Export approved revision` the primary action when ready. Put revision, fingerprint, audit and prior-export data in expandable details.

**Clean path:** select period -> review concise summary -> approve/export exact revision.  
**Problem path:** show `N things need attention`, direct attendance or adjustment remediation, return to the same period, then approve/export.  
**Desktop:** keep a compact staff comparison table with readiness first and details available.  
**Mobile:** readiness records with blocker/action first, then hours/details disclosure.  
**Likely files:** production payroll screen, payroll reporting/view models, local/demo payroll presentation, pay sub-navigation, review/arrangement context headers and UI tests. No calculation or database change is planned.

**Acceptance:** The UI never weakens freshness, fingerprint, approval or exact-revision export controls, but managers do not need to understand `run` and `revision` to choose the next safe action.

### Pass E: rota desktop and mobile

**Problem:** Warning and action scope can be ambiguous, destructive controls are prominent, and the mobile task model needs to consistently prefer focused views.

**Solution:** Preserve the desktop weekly grid. Improve staff/date context in the shift editor, visible warning severity, cell scanning and copy-action wording. Move `Clear week` into a secondary overflow or destructive region with a concrete confirmation. Explicitly distinguish `Copy previous week` from `Copy this employee's hours`. Surface operational-readiness context only for an affected shift.

**Desktop:** weekly grid remains default.  
**Mobile:** Day view is default, Staff view is one tap away, and Week grid is an explicit horizontal overview.  
**Likely files:** production rota, rota grid/editor, template manager/grid, relevant demo presentation, rota tests and responsive styles.

**Acceptance:** Before saving, the editor names the person and date and explains any consequence. Mobile users can find today's staff, inspect one person and edit a shift without navigating a compressed seven-day grid.

### Pass F: compliance and recruitment

**Problem:** Many counters and evidence fields have equal prominence despite different urgency.

**Solution:** Lead with shared authoritative categories: blocked/action now, due soon, incomplete evidence and complete. Provide direct filtered staff lists. On staff detail, show an operational-readiness summary and immediate actions before grouped evidence sections. Keep full evidence available. Use progressive disclosure for audit history and low-frequency metadata. Preserve restricted DBS handling and make reveal scope explicit.

**Desktop:** filtered evidence table remains for comparison.  
**Mobile:** status summary, section navigation and action-first grouped forms.  
**Likely files:** compliance summary/detail, staff-record navigation and readiness components, compliance styles/tests.

**Acceptance:** A manager can tell whether a person may start, what evidence is missing, what is merely approaching expiry and where to resolve it without inferring from raw field counts.

### Pass G: remaining manager screens

**Scope:** staff, leave, settings, clocking devices, pay arrangements/import review, organisation/site administration and account/invitation surfaces.

**Approach:** Preserve strong existing workflows. Apply shared page headers, states, feedback and responsive forms. Keep staff and leave patterns as restrained benchmarks. Ensure statutory leave evidence remains a separate manager record view. Review all consequential actions for concrete scope and avoid new confirmation fatigue.

**Acceptance:** Shared status and feedback meaning is consistent, mobile actions remain available, and no new top-level complexity is introduced.

### Pass H: staff self-service and kiosk

**Problem:** These strong workflows need consistency and accessibility validation, not redesign.

**Solution:** Apply shared feedback/error treatment to personal rota, attendance, correction request, leave and security/profile flows. Preserve kiosk selection, PIN, action and confirmation sequence. Validate failure, offline, pending-sync and automatic-return states. Keep pay and manager information absent.

**Acceptance:** Staff can complete each personal task by keyboard and touch, kiosk success returns safely, and offline evidence remains explicit.

### Pass I: accessibility, responsive and non-happy-path sweep

**Scope:** representative manager, staff, kiosk, onboarding and admin journeys.

**Solution:** Add rendered automated accessibility checks where practical, then manually verify keyboard order, focus traps/return, zoom, labels, error association, status independence and table navigation. Exercise first-use, empty, loading, permission, partial-error, success and retry states. Remove customer-facing demo/internal copy from commercial production paths while retaining clear staging/admin environment indicators.

**Acceptance:** No known critical automated accessibility violation remains; all priority workflows are keyboard-completable; mobile at 390px has no page-level horizontal overflow except the explicitly labelled rota week overview; errors and successful actions remain understandable without colour.

## 11. Consequential-action policy

| Action | Confirmation | Required scope copy |
| --- | --- | --- |
| Clear rota week | Yes | Week commencing date, affected shift count, preserved history behaviour |
| Copy prior week | Yes only when overwriting populated targets | Source week, target week, affected staff/shifts |
| Copy employee hours | Inline preview then confirm if overwriting | Employee, source/target dates |
| Bulk attendance approval | Yes when action is submitted | Eligible record count, excluded count, date range and site |
| Payroll warning acknowledgement | Inline explicit acknowledgement | Warning count/types and period |
| Payroll approval | Yes within approval action | Period, site scope and exact revision |
| Payroll export | No extra confirmation once exact revision is approved and fresh | Period, scope and file type |
| Deactivate staff | Yes | Person, archived future/template records, disabled access, preserved history |
| Revoke invitation/device | Yes if immediately disruptive | Person/device and access consequence |
| Ordinary save/edit | No | Visible success feedback |

## 12. Accessibility verification design

### Automated

- Render representative routes at desktop and mobile using fictional deterministic data.
- Run a WCAG-oriented scanner against dashboard, attendance, payroll, rota, compliance, leave, staff self-service, kiosk and key dialogs.
- Assert page-level overflow, unique main heading, labelled dialogs, accessible names for icon controls and field error association.
- Retain current source-level tests for navigation focus behaviour and rota accessible labels.

If adding a scanner requires a new dependency, use a dev-only, widely maintained package and document why. Do not ship it in the browser bundle.

### Manual

- Keyboard-only completion of attendance review, payroll remediation/export preparation, shift edit, leave decision and staff evidence edit.
- Focus enters dialogs predictably, remains trapped, closes with Escape where safe and returns to the triggering control.
- 200% browser zoom on desktop and portrait mobile viewport.
- Status understood in greyscale and without icon colour.
- Kiosk keypad and roster targets checked by touch-sized viewport.
- Screen-reader spot checks for page landmarks, tables, error summaries and asynchronous feedback.

## 13. Screenshot and interaction evidence

For every pass capture before/after evidence with a consistent 1440px desktop viewport and 390px mobile viewport. Use full-page images where needed, plus focused interaction captures for dialogs and long pages.

The final current-state package must include at least:

- Dashboard default, clean and attention states.
- Attendance default, filtered, row review/correction, bulk scope, success and error states.
- Payroll clean ready, blockers, warnings/acknowledgement, adjustment, approved/export and mobile states.
- Rota desktop week, mobile day/staff, shift editor, conflict and destructive confirmation states.
- Compliance summary filters, staff readiness, evidence edit and restricted reveal states.
- Staff add/edit/deactivate, leave request/decision/evidence, settings/devices and account/invitation states.
- Staff self-service desktop/mobile states.
- Kiosk selection, PIN, action, success, failure and offline/sync states.
- Onboarding and commercial administration representative states affected by shared primitives.
- Empty, loading, permission, validation and partial-error examples without redundant captures.

The package must map features and states to filenames, not merely routes. All data must be fictional and no secrets may appear.

## 14. Testing and release discipline

### Per pass

1. Add or update focused tests before implementation.
2. Capture deterministic baseline screenshots.
3. Implement only the approved pass scope.
4. Run focused tests, lint and typecheck.
5. Run browser interaction tests at desktop and mobile.
6. Capture updated screenshots and compare task behaviour.
7. Run `git diff --check` and commit one coherent pass.

### Milestone completion

Run:

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run verify:migrations`
- `npm run verify:browser-bundle`
- `npm run audit:dependencies`
- `git diff --check`
- CI, security workflow and CodeQL for the exact final SHA

Deploy only through the protected commercial release workflow. Verify Commercial Staging serves the exact final SHA and passes liveness, readiness, environment identity, Europe/London runtime, migration-ledger and synthetic-residue checks. This milestone does not authorise Commercial Production promotion.

## 15. Behavioural and architectural boundaries

This programme is presentation and workflow orchestration unless a later pass identifies a separately approved capability gap.

It must not change:

- Attendance calculation or immutable evidence.
- Manager correction storage.
- Payroll calculations, payable-minute rules, adjustment history, readiness rules, fingerprints, revisions, approvals or exact-revision export.
- RLS, tenant/site permission enforcement or organisation boundaries.
- Compliance readiness derivation or legal evidence semantics.
- Leave calculation or retention rules.
- Kiosk attendance security and offline evidence handling.
- Billing, signup containment, production email/domain configuration or public launch scope.

UI code may request an already-authoritative state or link to a filtered destination. It must not create a competing browser-derived readiness rule.

## 16. Risks and mitigations

- **Risk: semantic migration changes perceived severity.** Migrate feature by feature and retain explicit text during the transition.
- **Risk: responsive views hide required evidence.** Define a mobile task and information contract before converting any table.
- **Risk: payroll simplification weakens safety.** Keep all server checks authoritative and expose audit details through disclosure rather than removal.
- **Risk: dashboard duplicates domain logic.** Consume shared server-derived counts and links only.
- **Risk: broad CSS changes regress onboarding/admin.** Add scoped primitives, visual evidence and representative route checks in Pass A.
- **Risk: screenshot-only review misses interaction failures.** Require keyboard, mobile and browser interaction testing in every pass.
- **Risk: long milestone creates release drift.** Keep each pass independently tested and committed; stage only exact candidate SHAs.

## 17. Completion criteria

The milestone is complete when:

- Shared semantic states and feedback patterns are used across priority workflows.
- Dashboard prioritises genuine manager actions.
- Attendance and payroll have clear desktop and mobile completion paths.
- Desktop rota density is preserved and mobile rota is task-focused.
- Compliance and recruitment distinguish blockers, current actions, upcoming issues and complete states.
- Strong staff, leave and kiosk workflows remain recognisable and no less efficient.
- Priority workflows pass automated and manual accessibility checks with documented residual limitations.
- Customer-facing commercial routes do not expose inappropriate demo or implementation terminology.
- A fresh feature/state-based UX review package represents the final candidate.
- Full local verification and protected Commercial Staging verification pass for one exact SHA.

## 18. Recommended execution decision

Proceed with **Option B: controlled workflow-led refinement**, beginning with Pass A only after this specification is approved. Later passes must not be started automatically from this design phase; each remains bounded by its tests, screenshots and coherent commit.
