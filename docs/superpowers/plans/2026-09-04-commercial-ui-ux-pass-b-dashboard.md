# Commercial UI/UX Pass B Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the production manager dashboard answer what needs attention now, while preserving its existing authoritative data, daily context and navigation.

**Architecture:** Add a pure presentation mapper that converts existing server-authoritative dashboard counts into ordered semantic action items. Render those items through Pass A primitives, retain the current Today and records sections, and provide equivalent table/mobile presentations for upcoming shifts. No query, RPC, permission or navigation destination changes are required.

**Tech Stack:** Next.js App Router, React 19 server components, TypeScript, Vitest, shared Pass A UI primitives, Playwright visual evidence.

**Spec:** `docs/superpowers/specs/2026-09-04-commercial-ui-ux-improvement-programme-design.md`

## Global constraints

- Use only fields already supplied by `ProductionDashboardSummary`.
- Do not infer recruitment, compliance or payroll readiness not present in the authoritative response.
- Do not change Supabase RPCs, migrations, permissions, tenancy or calculations.
- Preserve `Home`, current navigation groups and direct route behaviour.
- Preserve useful desktop density and all current Today/records information.
- Mobile must support lookup and direct action without a horizontally scrolling shifts table.
- Empty action queues must communicate that no immediate manager action is present.
- Use tests first and commit coherent units.

---

### Task 1: Authoritative action presentation mapper

**Files:**
- Create: `src/components/dashboard/dashboard-presentation.ts`
- Create: `tests/dashboard-presentation.test.ts`

**Interfaces:**
- Produces: `buildDashboardActionItems(data: ProductionDashboardSummary): ActionSummaryItem[]`
- Produces fixed order: unresolved attendance, pending corrections, rota leave conflicts, pending leave.
- Omits zero-count items.

- [ ] **Step 1: Write failing mapper tests**

Create a complete `ProductionDashboardSummary` fixture and assert:

```ts
expect(buildDashboardActionItems(summary).map((item) => item.key)).toEqual([
  "attendance",
  "corrections",
  "rota-conflicts",
  "leave",
]);
expect(buildDashboardActionItems(summary)[0]).toMatchObject({
  count: summary.unresolvedAttendanceIssues,
  tone: "blocking",
  href: "/attendance?view=needs-attention",
  actionLabel: "Review attendance",
});
```

Set selected counts to zero and assert those items are omitted. Assert singular/plural labels for count one and multiple counts.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/dashboard-presentation.test.ts`

Expected: FAIL because the mapper does not exist.

- [ ] **Step 3: Implement the pure mapper**

Map existing fields only:

- `unresolvedAttendanceIssues` -> `blocking`, attendance filtered route.
- `pendingCorrections` -> `attention`, attendance filtered route.
- `approvedLeaveRotaConflicts` -> `blocking`, current weekly rota route.
- `pendingLeaveRequests` -> `attention`, leave requests route.

The mapper receives the current week start for the rota URL. It preserves declared order and filters `count > 0`.

- [ ] **Step 4: Run focused tests**

Run: `npm test -- tests/dashboard-presentation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/components/dashboard/dashboard-presentation.ts tests/dashboard-presentation.test.ts
git commit -m "Add dashboard action presentation model"
```

---

### Task 2: Action-first dashboard hierarchy

**Files:**
- Modify: `tests/dashboard-production.test.ts`
- Modify: `src/components/dashboard/production-dashboard.tsx`

**Interfaces:**
- Consumes `PageHeader`, `ActionSummary`, `Alert`, `StatusBadge`, `buildDashboardActionItems`.
- Preserves `ProductionDashboard({ data })` and `ProductionDashboardError()` signatures.

- [ ] **Step 1: Write failing production-dashboard tests**

Replace brittle copy-order assertions with rendered/source contracts that require:

- `PageHeader` with title `Home` and dated purpose copy.
- `ActionSummary` before the `Today` section.
- An all-clear success alert when the action list is empty.
- No old `attentionClass` or four always-visible zero-count action links.
- Direct links remain to attendance, leave and the selected rota week.
- The error state uses a blocking `Alert` and still states that no placeholder figures are shown.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/dashboard-production.test.ts tests/dashboard-presentation.test.ts`

Expected: FAIL on the new shared-primitives and removed-clutter assertions.

- [ ] **Step 3: Implement the hierarchy**

In `ProductionDashboard`:

1. Build action items once.
2. Render `PageHeader`.
3. Render `ActionSummary` when items exist.
4. Otherwise render a success `Alert` titled `No immediate manager actions`.
5. Keep attendance warning evidence directly beneath the summary, with a single introductory label and direct link.
6. Keep Today, Quick actions and Records and checks summary in their existing order.

Use semantic badges for rota status. Do not convert current staff cards or records links wholesale.

- [ ] **Step 4: Implement the error state**

Use a blocking `Alert` with `Live dashboard unavailable` and the existing no-placeholder statement. Do not add demo fallback values.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/dashboard-production.test.ts tests/dashboard-presentation.test.ts tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/dashboard/production-dashboard.tsx tests/dashboard-production.test.ts
git commit -m "Prioritise manager dashboard actions"
```

---

### Task 3: Focused mobile upcoming shifts

**Files:**
- Modify: `tests/dashboard-production.test.ts`
- Modify: `src/components/dashboard/production-dashboard.tsx`
- Modify: `src/app/platform.css`

**Interfaces:**
- Consumes `ResponsiveDataView`.
- Desktop presentation remains the existing table.
- Mobile presentation is a labelled list containing date, staff, time, work area/role and rota status.

- [ ] **Step 1: Add failing responsive contracts**

Assert the production dashboard source contains `ResponsiveDataView`, `ui-dashboard-shift-list` and visible labels for `Shift` and `Work area or role` in the mobile record. Assert the desktop table headings remain.

- [ ] **Step 2: Run and confirm failure**

Run: `npm test -- tests/dashboard-production.test.ts`

Expected: FAIL because the current table has no mobile equivalent.

- [ ] **Step 3: Implement equivalent presentations**

Wrap the existing table and a new semantic list in `ResponsiveDataView` with label `Today and tomorrow shifts`. Reuse `StatusBadge` and the same data fields. Do not duplicate links or mutations because this section is read-only.

- [ ] **Step 4: Add scoped mobile list styles**

Add `.ui-dashboard-shift-list` and child classes to `platform.css`. Use compact white records, 12px labels, 14px values and no horizontal overflow. Do not alter unrelated tables.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- tests/dashboard-production.test.ts tests/dashboard-presentation.test.ts tests/ui-layout-primitives.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```powershell
git add src/components/dashboard/production-dashboard.tsx src/app/platform.css tests/dashboard-production.test.ts
git commit -m "Add focused mobile dashboard shifts"
```

---

### Task 4: Pass B verification and evidence

**Files:**
- Generate untracked evidence under `ux-audit-package/current/pass-b/`.

- [ ] **Step 1: Run focused and full verification**

Run:

```powershell
npm test -- tests/dashboard-presentation.test.ts tests/dashboard-production.test.ts tests/ui-semantic-primitives.test.tsx tests/ui-layout-primitives.test.tsx
npm run lint
npm run typecheck
npm test
npm run build
git diff --check
```

Expected: all commands pass; existing lint warnings may be reported but no new warning is accepted.

- [ ] **Step 2: Capture production dashboard preview evidence**

Run the local application using the established safe preview mode that renders `ProductionDashboard` with fictional data. Capture 1440 x 1000 and 390 x 844 for:

- action queue populated;
- all clear;
- upcoming shifts;
- production error state if the existing preview supports it.

Store route, state, viewport and SHA in `manifest.json`. If preview-mode routing cannot expose a state without changing application code, document it rather than adding a customer route.

- [ ] **Step 3: Browser interaction and accessibility checks**

Confirm links have descriptive names, keyboard order follows action priority, status remains textual, 200% zoom remains usable and neither viewport has page-level overflow.

- [ ] **Step 4: Inspect scope and report boundary**

Tracked changes must be limited to dashboard presentation, shared scoped CSS, tests and this plan. Report commits, screenshots, verification and any unavailable preview state. Do not alter dashboard RPCs or begin Pass C until Pass B is complete.
