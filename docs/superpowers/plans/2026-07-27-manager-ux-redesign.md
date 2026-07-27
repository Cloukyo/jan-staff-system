# Manager UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make manager workflows easy to find through familiar wording, clear action hierarchy, page submenus, unified staff records and a searchable Help area.

**Architecture:** Keep the current Next.js routes, Supabase actions and immutable attendance model. Introduce typed navigation/help configuration, a reusable manager page submenu, query-driven task views for long pages and focused staff-record panels that reuse existing server actions. No database migration is required.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Tailwind CSS, Supabase server actions, Vitest and the existing Browser-based rendered QA workflow.

## Global Constraints

- Use UK date, time and currency formats.
- Use the Europe/London timezone.
- Do not calculate tax, PAYE, National Insurance, pensions or payslips.
- Preserve original clock events.
- Manager corrections must be stored separately from original clock records.
- Do not silently overwrite historic hourly rates or salary values.
- Never expose salary or pay-rate information on the public clocking kiosk.
- Staff must not be able to edit their own attendance history.
- Keep touch targets at least 44 px high.
- Use plain nursery-manager language and do not use em dashes in user-facing copy.
- Keep demo functionality intact.
- Avoid new runtime dependencies.
- Preserve the existing manager and staff permission checks.
- Run lint, type checking, tests and a production build before completion.

---

## File Structure

### Shared manager information architecture

- Create `src/lib/navigation/manager-navigation.ts`: typed manager menu configuration and active-route helpers.
- Create `src/components/layout/manager-page-nav.tsx`: reusable desktop submenu and mobile Jump to control.
- Create `src/components/help/manager-help-link.tsx`: small contextual link to a specific Help task.
- Modify `src/components/layout/app-shell.tsx`: consume the new menu and familiar labels.
- Modify `src/app/globals.css`: sticky submenu, mobile control and compact operational-list styles.

### Help

- Create `src/lib/help/manager-help.ts`: typed, searchable static Help task definitions.
- Create `src/components/help/manager-help-screen.tsx`: grouped task instructions and shortcuts.
- Create `src/app/help/page.tsx`: manager-only Help route.
- Create `tests/help.test.ts`: task coverage, search and safe-shortcut tests.

### Attendance

- Create `src/lib/attendance/manager-view.ts`: accepted view values and URL builders.
- Create `src/components/attendance/attendance-page-nav.tsx`: Attendance submenu.
- Modify `src/app/attendance/page.tsx`: top-level primary action and selected view.
- Modify `src/components/attendance/attendance-review.tsx`: clearer decisions and reduced repeated forms.
- Modify `src/components/attendance/production-attendance.tsx`: export focused Today, Hours summary, correction and history views.
- Modify `tests/attendance-review.test.ts`: view, hierarchy and immutability assertions.

### Staff records and clocking-in access

- Create `src/components/staff/add-staff-form.tsx`: focused add-staff action.
- Create `src/lib/staff/record-sections.ts`: accepted staff-record sections and URLs.
- Create `src/components/staff/staff-record-nav.tsx`: staff-record submenu.
- Create `src/components/staff/staff-record-clocking.tsx`: one-person Staff Clock access and PIN controls.
- Create `src/components/staff/staff-record-login.tsx`: one-person app-login controls.
- Create `src/components/staff/staff-record-pay.tsx`: one-person effective pay history and editor.
- Create `src/components/payroll/pay-arrangements-screen.tsx`: dedicated all-staff pay management moved out of the staff directory.
- Modify `src/app/staff/page.tsx`: load the staff directory and add-staff workflow.
- Modify `src/components/staff/production-staff-screen.tsx`: compact searchable directory without pay values.
- Modify `src/app/compliance/page.tsx`: preserve the legacy URL by redirecting to Staff records.
- Modify `src/app/compliance/staff/[staffId]/page.tsx`: load selected staff-record support data.
- Modify `src/components/compliance/production-compliance-detail.tsx`: query-driven sections and plain wording.
- Modify `src/components/accounts/production-accounts.tsx`: export a reusable one-person access panel.
- Modify `src/components/kiosk/staff-kiosk-management.tsx`: export a reusable one-person clocking panel.
- Modify `src/app/payroll/arrangements/page.tsx`: use the dedicated pay-management screen.
- Modify `tests/navigation.test.ts`, `tests/compliance.test.ts` and `tests/kiosk.test.ts`.

### Remaining manager hierarchy and wording

- Modify `src/app/settings/kiosk/page.tsx` and `src/components/kiosk/device-management.tsx`: devices only and Staff Clock refresh.
- Modify `src/lib/compliance/actions.ts`: revalidate all staff-name consumers.
- Modify `src/lib/kiosk/actions.ts`: manager refresh action without changing records.
- Modify `src/components/dashboard/production-dashboard.tsx`: Home wording and action-led priorities.
- Modify `src/components/rota/production-rota.tsx`: page submenu and clearer tool hierarchy.
- Modify `src/app/payroll/page.tsx`, `src/app/payroll/review/page.tsx` and `src/app/payroll/arrangements/page.tsx`: distinct pay wording.
- Modify `src/components/settings/production-settings.tsx`: familiar settings labels.
- Modify `tests/dashboard-production.test.ts`, `tests/rota-grid-interface.test.ts`, `tests/payroll-production.test.ts` and `tests/navigation.test.ts`.

---

### Task 1: Shared Manager Navigation and Page Submenu

**Files:**
- Create: `src/lib/navigation/manager-navigation.ts`
- Create: `src/components/layout/manager-page-nav.tsx`
- Modify: `src/components/layout/app-shell.tsx`
- Modify: `src/app/globals.css`
- Test: `tests/navigation.test.ts`

**Interfaces:**
- Produces: `managerNavigation: NavGroup[]`
- Produces: `itemIsActive(item: NavItem, pathname: string): boolean`
- Produces: `ManagerPageNav({ items, activeId, label }: ManagerPageNavProps)`
- Consumes: existing `AppShell` role selection and Next.js `Link`

- [ ] **Step 1: Write failing navigation tests**

Add assertions that the manager menu contains the approved labels and does not expose the removed technical destinations:

```ts
const navigation = source("src/lib/navigation/manager-navigation.ts");

it("uses manager task language", () => {
  expect(navigation).toContain('label: "Home"');
  expect(navigation).toContain('label: "Clock-ins & hours"');
  expect(navigation).toContain('label: "Leave requests"');
  expect(navigation).toContain('label: "Staff records"');
  expect(navigation).toContain('label: "Export pay hours"');
  expect(navigation).toContain('label: "Clocking-in devices"');
  expect(navigation).toContain('label: "Help"');
  expect(navigation).not.toContain('label: "Compliance"');
  expect(navigation).not.toContain('label: "Accounts"');
  expect(navigation).not.toContain('label: "Payroll review"');
});
```

Add a source assertion for the mobile Jump to control:

```ts
const pageNav = source("src/components/layout/manager-page-nav.tsx");
expect(pageNav).toContain("Jump to");
expect(pageNav).toContain("sticky");
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/navigation.test.ts`

Expected: FAIL because the familiar labels and `ManagerPageNav` do not exist.

- [ ] **Step 3: Extract typed manager navigation**

Create `manager-navigation.ts` with the approved structure:

```ts
export const managerNavigation: NavGroup[] = [
  {
    label: "Daily work",
    items: [
      { href: "/dashboard", label: "Home", icon: BarChart3 },
      { href: "/rota", label: "Rota", icon: CalendarDays },
      { href: "/attendance", label: "Clock-ins & hours", icon: ClipboardCheck },
      { href: "/leave/requests", label: "Leave requests", icon: CalendarX2 },
    ],
  },
  {
    label: "Staff",
    items: [{ href: "/staff", label: "Staff records", icon: Users }],
  },
  {
    label: "Pay hours",
    items: [{ href: "/payroll", label: "Export pay hours", icon: FileSpreadsheet }],
  },
  {
    label: "Settings",
    items: [
      { href: "/rota/templates", label: "Rota templates", icon: LayoutTemplate },
      { href: "/settings/kiosk", label: "Clocking-in devices", icon: KeyRound },
      { href: "/settings", label: "Nursery settings", icon: Settings },
    ],
  },
  {
    label: "Support",
    items: [{ href: "/help", label: "Help", icon: CircleHelp }],
  },
];
```

Keep legacy URLs working. Only remove them from primary navigation.

- [ ] **Step 4: Build the reusable page submenu**

Implement real links on desktop and a native select on mobile:

```ts
export type ManagerPageNavItem = {
  id: string;
  label: string;
  href: string;
};

export function ManagerPageNav({
  items,
  activeId,
  label,
}: {
  items: ManagerPageNavItem[];
  activeId: string;
  label: string;
}) {
  // Desktop: sticky nav links with aria-current.
  // Mobile: labelled Jump to select that calls router.push.
}
```

The component must not mix commands into the view tabs.

- [ ] **Step 5: Add focused submenu styles**

Add stable sticky positioning, horizontal overflow protection and a 44 px mobile select. Use neutral borders and reserve purple for the active destination.

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/navigation.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/lib/navigation/manager-navigation.ts src/components/layout/manager-page-nav.tsx src/components/layout/app-shell.tsx src/app/globals.css tests/navigation.test.ts
git commit -m "Add manager task navigation and page submenus"
```

### Task 2: Searchable Manager Help

**Files:**
- Create: `src/lib/help/manager-help.ts`
- Create: `src/components/help/manager-help-screen.tsx`
- Create: `src/components/help/manager-help-link.tsx`
- Create: `src/app/help/page.tsx`
- Create: `tests/help.test.ts`

**Interfaces:**
- Produces: `ManagerHelpTask`
- Produces: `managerHelpTasks: ManagerHelpTask[]`
- Produces: `filterManagerHelpTasks(query: string): ManagerHelpTask[]`
- Produces: `ManagerHelpLink({ taskId }: { taskId: string })`
- Consumes: `AppShell`, `requireAccount(["manager"])` and internal Next.js links

- [ ] **Step 1: Write failing Help data tests**

```ts
import { filterManagerHelpTasks, managerHelpTasks } from "@/lib/help/manager-help";

it("covers the approved manager tasks", () => {
  expect(managerHelpTasks.map((task) => task.id)).toEqual(expect.arrayContaining([
    "add-missing-clock-event",
    "add-staff-member",
    "change-staff-clock-name",
    "enable-staff-clock",
    "manage-staff-login",
    "edit-rota",
    "review-leave",
    "review-attendance",
    "export-pay-hours",
    "manage-clocking-device",
  ]));
});

it("keeps instructions short and shortcuts internal", () => {
  for (const task of managerHelpTasks) {
    expect(task.steps.length).toBeGreaterThan(0);
    expect(task.steps.length).toBeLessThanOrEqual(4);
    expect(task.href.startsWith("/")).toBe(true);
  }
});

it("searches titles, groups and steps", () => {
  expect(filterManagerHelpTasks("forgot clock out").map((task) => task.id))
    .toContain("add-missing-clock-event");
});
```

- [ ] **Step 2: Run the Help test and verify failure**

Run: `npm test -- tests/help.test.ts`

Expected: FAIL because the Help task module does not exist.

- [ ] **Step 3: Create typed Help content**

Use this exact shape:

```ts
export type ManagerHelpTask = {
  id: string;
  group: "Daily work" | "Staff records" | "Clocking in" | "Leave" | "Pay hours" | "Settings";
  title: string;
  summary: string;
  steps: readonly string[];
  href: string;
  shortcutLabel: string;
  keywords: readonly string[];
};
```

The missed-event shortcut must be `/attendance?view=add-event`. The add-staff shortcut must be `/staff?action=add`. Other shortcuts should open the relevant selected view, not a generic page top.

- [ ] **Step 4: Build the Help page**

Create a client screen with:

- search input labelled `Search help`
- `Common tasks` first when the query is empty
- grouped compact rows
- numbered steps
- one clearly labelled shortcut link per task
- empty state `No help tasks match that search.`

Do not render private staff or pay data.

- [ ] **Step 5: Add contextual Help link**

`ManagerHelpLink` should resolve `taskId` with `` `/help#${taskId}` `` and render a secondary text link with a `CircleHelp` icon.

- [ ] **Step 6: Protect the route**

`src/app/help/page.tsx` must call:

```ts
await requireAccount(["manager"]);
return <AppShell><ManagerHelpScreen tasks={managerHelpTasks} /></AppShell>;
```

- [ ] **Step 7: Run focused tests**

Run: `npm test -- tests/help.test.ts tests/navigation.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/lib/help src/components/help src/app/help tests/help.test.ts
git commit -m "Add searchable manager help"
```

### Task 3: Attendance Hierarchy and Task Views

**Files:**
- Create: `src/lib/attendance/manager-view.ts`
- Create: `src/components/attendance/attendance-page-nav.tsx`
- Modify: `src/app/attendance/page.tsx`
- Modify: `src/components/attendance/attendance-review.tsx`
- Modify: `src/components/attendance/production-attendance.tsx`
- Modify: `tests/attendance-review.test.ts`

**Interfaces:**
- Produces: `AttendanceManagerView = "needs-attention" | "today" | "hours" | "add-event" | "history"`
- Produces: `parseAttendanceManagerView(value?: string): AttendanceManagerView`
- Produces: focused exports `AttendanceToday`, `AttendanceHoursSummary`, `AttendanceCorrectionForm`, `AttendanceHistory`
- Consumes: existing `AttendanceReviewDay`, `ManagerKioskRow`, `ManagerClockEvent` and `ManagerHoursPreview`

- [ ] **Step 1: Write failing view and hierarchy tests**

```ts
import { parseAttendanceManagerView } from "@/lib/attendance/manager-view";

expect(parseAttendanceManagerView()).toBe("needs-attention");
expect(parseAttendanceManagerView("add-event")).toBe("add-event");
expect(parseAttendanceManagerView("unknown")).toBe("needs-attention");

const page = source("src/app/attendance/page.tsx");
expect(page).toContain("Add a missing clock-in or clock-out");
expect(page.indexOf("Add a missing clock-in or clock-out"))
  .toBeLessThan(page.indexOf("<AttendanceReview"));
expect(page).toContain("<AttendancePageNav");
```

Keep the existing tests that prove manager corrections are separate and original events are not updated.

- [ ] **Step 2: Run the test and verify failure**

Run: `npm test -- tests/attendance-review.test.ts`

Expected: FAIL because the view parser and new hierarchy do not exist.

- [ ] **Step 3: Add the query-driven view parser**

Use a Set guard and preserve relevant date parameters when building submenu links:

```ts
const attendanceViews = new Set<AttendanceManagerView>([
  "needs-attention", "today", "hours", "add-event", "history",
]);

export function parseAttendanceManagerView(value?: string) {
  return attendanceViews.has(value as AttendanceManagerView)
    ? value as AttendanceManagerView
    : "needs-attention";
}
```

- [ ] **Step 4: Put the primary command first**

At the top of Attendance render:

```tsx
<Link href="/attendance?view=add-event" className={primaryActionClass}>
  <ClockPlus aria-hidden className="h-5 w-5" />
  Add a missing clock-in or clock-out
</Link>
```

On mobile this button is full width. Add `ManagerHelpLink taskId="add-missing-clock-event"`.

- [ ] **Step 5: Add the Attendance submenu**

Use these view labels:

- Needs attention
- Today
- Hours summary
- Clocking history

Do not place the add-event command among the view tabs. When `view=add-event`, keep the last selected view unset and show the correction form directly below the header.

- [ ] **Step 6: Split the lower Attendance component**

Export focused components without changing server actions:

```tsx
export function AttendanceToday({ staff }: { staff: ManagerKioskRow[] }) {}
export function AttendanceHoursSummary({ hoursPreview }: { hoursPreview: ManagerHoursPreview }) {}
export function AttendanceCorrectionForm({ staff }: { staff: ManagerKioskRow[] }) {}
export function AttendanceHistory({ staff, events }: { staff: ManagerKioskRow[]; events: ManagerClockEvent[] }) {}
```

Only render the selected component. This removes the very long stacked page.

- [ ] **Step 7: Simplify review decisions**

Replace four permanently visible forms with a compact per-row decision select and one conditional reason field. Preserve the exact action statuses:

```ts
type ReviewDecision = "approved" | "corrected" | "ignored" | "needs_staff_clarification";
```

Use these labels:

- Approve recorded times
- Enter corrected times
- Accept exception with reason
- Mark for follow-up

Do not allow the UI change to update `clock_events`.

- [ ] **Step 8: Run focused tests**

Run: `npm test -- tests/attendance-review.test.ts tests/kiosk.test.ts`

Expected: PASS.

- [ ] **Step 9: Commit**

```powershell
git add src/lib/attendance/manager-view.ts src/components/attendance src/app/attendance/page.tsx tests/attendance-review.test.ts
git commit -m "Reorganise manager attendance workflows"
```

### Task 4: Staff Records Directory

**Files:**
- Create: `src/components/staff/add-staff-form.tsx`
- Create: `src/components/payroll/pay-arrangements-screen.tsx`
- Modify: `src/app/staff/page.tsx`
- Modify: `src/app/compliance/page.tsx`
- Modify: `src/app/payroll/arrangements/page.tsx`
- Modify: `src/components/staff/production-staff-screen.tsx`
- Modify: `src/components/compliance/production-compliance-screen.tsx`
- Modify: `tests/navigation.test.ts`
- Modify: `tests/compliance-repository.test.ts`

**Interfaces:**
- Produces: `AddStaffForm`
- Produces: compact `ProductionStaffScreen`
- Produces: `PayArrangementsScreen` containing the existing manager-only pay controls
- Consumes: `createStaffProfileAction` and `ProductionStaffRow[]`

- [ ] **Step 1: Write failing staff-directory tests**

Assert that:

```ts
const staffPage = source("src/app/staff/page.tsx");
const directory = source("src/components/staff/production-staff-screen.tsx");

expect(staffPage).toContain("Staff records");
expect(staffPage).toContain("<AddStaffForm");
expect(directory).toContain("Needs setup");
expect(directory).toContain("Open record");
expect(directory).not.toContain("hourlyRate");
expect(directory).not.toContain("annualSalary");
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/navigation.test.ts tests/compliance-repository.test.ts`

Expected: FAIL because the current directory includes pay editing and the add form is elsewhere.

- [ ] **Step 3: Extract the add-staff form**

Move the existing production fields into `AddStaffForm`:

- Full legal name
- Name shown on Staff Clock
- Role
- Qualification
- Start date
- Active

The form should render only when `/staff?action=add`; otherwise show a primary `Add staff member` link in the first viewport.

- [ ] **Step 4: Separate all-staff pay management**

Move the current pay cards and effective-dated editor from `src/components/staff/production-staff-screen.tsx` into `src/components/payroll/pay-arrangements-screen.tsx`. Update `/payroll/arrangements` to use `PayArrangementsScreen`.

This preserves the existing manager pay workflow while allowing the Staff records directory to exclude pay values.

- [ ] **Step 5: Make the directory compact and searchable**

Support query text and filters:

```ts
type StaffDirectoryFilter = "active" | "needs-setup" | "inactive";
```

Each row shows name, role, active state, clocking-in state and the highest-priority setup warning. It contains only `Open record`. Do not show rates or salary values.

- [ ] **Step 6: Retire the duplicate compliance entry point**

Keep `/compliance` working for bookmarks, but redirect managers to `/staff?filter=needs-checks`. Remove its add-staff form and primary-menu role.

- [ ] **Step 7: Run focused tests**

Run: `npm test -- tests/navigation.test.ts tests/compliance-repository.test.ts tests/payroll-production.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/components/staff/add-staff-form.tsx src/components/staff/production-staff-screen.tsx src/components/payroll/pay-arrangements-screen.tsx src/app/staff/page.tsx src/app/compliance/page.tsx src/app/payroll/arrangements/page.tsx src/components/compliance/production-compliance-screen.tsx tests/navigation.test.ts tests/compliance-repository.test.ts
git commit -m "Create a unified staff records directory"
```

### Task 5: One Employee Record With Task Sections

**Files:**
- Create: `src/lib/staff/record-sections.ts`
- Create: `src/components/staff/staff-record-nav.tsx`
- Create: `src/components/staff/staff-record-clocking.tsx`
- Create: `src/components/staff/staff-record-login.tsx`
- Create: `src/components/staff/staff-record-pay.tsx`
- Modify: `src/app/compliance/staff/[staffId]/page.tsx`
- Modify: `src/components/compliance/production-compliance-detail.tsx`
- Modify: `src/components/accounts/production-accounts.tsx`
- Modify: `src/components/kiosk/staff-kiosk-management.tsx`
- Modify: `src/components/payroll/pay-arrangements-screen.tsx`
- Test: `tests/compliance.test.ts`
- Test: `tests/kiosk.test.ts`
- Test: `tests/payroll-production.test.ts`

**Interfaces:**
- Produces: `StaffRecordSection = "overview" | "employment" | "clocking-in" | "staff-login" | "training-checks" | "pay-details"`
- Produces: `StaffRecordClocking`, `StaffRecordLogin`, `StaffRecordPay`
- Consumes: one `ManagerKioskRow`, one `StaffComplianceRecord["account"]`, one `ProductionStaffRow` and the existing server-administration availability flag

- [ ] **Step 1: Write failing section and privacy tests**

```ts
expect(parseStaffRecordSection("clocking-in")).toBe("clocking-in");
expect(parseStaffRecordSection("bad")).toBe("overview");

const detail = source("src/components/compliance/production-compliance-detail.tsx");
expect(detail).toContain("Name shown on Staff Clock");
expect(detail).not.toContain("Canonical staff ID");
expect(detail).toContain("<StaffRecordNav");

const clocking = source("src/components/staff/staff-record-clocking.tsx");
expect(clocking).not.toMatch(/hourlyRate|annualSalary|monthlySalary/);
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/compliance.test.ts tests/kiosk.test.ts tests/payroll-production.test.ts`

Expected: FAIL because the section parser and focused panels do not exist.

- [ ] **Step 3: Add query-driven record sections**

The employee route accepts `section` and defaults to Overview. Use the shared submenu with:

- Overview
- Employment
- Clocking in
- Staff login
- Training & checks
- Pay details

Only render the selected section to remove the 6,800 px stacked record.

- [ ] **Step 4: Build Overview and Employment**

Overview displays the setup checklist without private pay values:

- employment details complete
- can use Staff Clock
- PIN ready
- staff login enabled or not required
- required training and checks
- pay details present

Employment contains the existing profile form. Rename `Preferred name` to `Name shown on Staff Clock` and remove the canonical UUID from visible copy.

- [ ] **Step 5: Reuse clocking-in controls for one person**

Extract the existing per-person kiosk forms into `StaffRecordClocking`. Keep the current temporary PIN validation and forced PIN replacement. Include a `Refresh Staff Clock` manager command that only revalidates data.

- [ ] **Step 6: Reuse login controls for one person**

Extract the account card forms into `StaffRecordLogin`. Continue to use the current manager-only account actions and audit entries. Replace visible `Auth user UUID` language with an Advanced details disclosure; do not change the stored identifiers.

- [ ] **Step 7: Reuse pay controls for one person**

Extract current effective-dated history and forms from `PayArrangementsScreen` into `StaffRecordPay`. Keep all values manager-only and preserve historic arrangements. Rename the section `Pay details`.

- [ ] **Step 8: Group training and checks**

Render Qualifications, Training and certificates, DBS and suitability, Central-record checklist, References and Import warnings inside `training-checks`. Add a secondary local Jump to list within that section because it remains a long specialist area.

- [ ] **Step 9: Run focused tests**

Run: `npm test -- tests/compliance.test.ts tests/compliance-repository.test.ts tests/kiosk.test.ts tests/payroll-production.test.ts tests/navigation.test.ts`

Expected: PASS.

- [ ] **Step 10: Commit**

```powershell
git add src/lib/staff/record-sections.ts src/components/staff/staff-record-nav.tsx src/components/staff/staff-record-clocking.tsx src/components/staff/staff-record-login.tsx src/components/staff/staff-record-pay.tsx src/app/compliance/staff/[staffId]/page.tsx src/components/compliance/production-compliance-detail.tsx src/components/accounts/production-accounts.tsx src/components/kiosk/staff-kiosk-management.tsx src/components/payroll/pay-arrangements-screen.tsx tests/compliance.test.ts tests/kiosk.test.ts tests/payroll-production.test.ts
git commit -m "Unify employee management in staff records"
```

### Task 6: Clocking-in Devices and Staff Clock Refresh

**Files:**
- Modify: `src/app/settings/kiosk/page.tsx`
- Modify: `src/components/kiosk/device-management.tsx`
- Modify: `src/lib/kiosk/actions.ts`
- Modify: `src/lib/compliance/actions.ts`
- Modify: `tests/kiosk.test.ts`
- Modify: `tests/compliance-repository.test.ts`

**Interfaces:**
- Produces: `refreshStaffClockAction(): Promise<KioskActionResult>`
- Consumes: Next.js `revalidatePath`

- [ ] **Step 1: Write failing refresh and wording tests**

```ts
const settings = source("src/app/settings/kiosk/page.tsx");
expect(settings).toContain("Clocking-in devices");
expect(settings).not.toContain("<StaffKioskManagement");

const complianceActions = source("src/lib/compliance/actions.ts");
for (const path of ["/staff", "/clock", "/attendance", "/settings/kiosk"]) {
  expect(complianceActions).toContain(`revalidatePath("${path}")`);
}
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/kiosk.test.ts tests/compliance-repository.test.ts`

Expected: FAIL because the device page still contains all staff PIN controls and name updates do not refresh every consumer.

- [ ] **Step 3: Make Settings device-only**

Keep:

- Open Staff Clock
- Register this browser
- Registered devices
- Revoke device
- Refresh Staff Clock

Remove the unbounded staff PIN list because those controls now live on employee records.

- [ ] **Step 4: Add refresh action**

Implement:

```ts
export async function refreshStaffClockAction(): Promise<KioskActionResult> {
  await requireAccount(["manager"]);
  revalidatePath("/clock");
  revalidatePath("/settings/kiosk");
  revalidatePath("/attendance");
  revalidatePath("/staff");
  return { ok: true, code: "refreshed", message: "Staff Clock information refreshed." };
}
```

This action must not update or delete any database record.

- [ ] **Step 5: Expand profile-save revalidation**

After a successful name/profile save, revalidate:

- `/staff`
- `/compliance`
- `/compliance/staff/<staffId>`
- `/clock`
- `/attendance`
- `/settings/kiosk`

- [ ] **Step 6: Run focused tests**

Run: `npm test -- tests/kiosk.test.ts tests/compliance-repository.test.ts`

Expected: PASS.

- [ ] **Step 7: Commit**

```powershell
git add src/app/settings/kiosk/page.tsx src/components/kiosk/device-management.tsx src/lib/kiosk/actions.ts src/lib/compliance/actions.ts tests/kiosk.test.ts tests/compliance-repository.test.ts
git commit -m "Simplify clocking device setup and refresh"
```

### Task 7: Home, Rota, Pay and Settings Hierarchy

**Files:**
- Modify: `src/components/dashboard/production-dashboard.tsx`
- Modify: `src/components/rota/production-rota.tsx`
- Modify: `src/app/payroll/page.tsx`
- Modify: `src/app/payroll/review/page.tsx`
- Modify: `src/app/payroll/arrangements/page.tsx`
- Modify: `src/components/settings/production-settings.tsx`
- Modify: `tests/dashboard-production.test.ts`
- Modify: `tests/rota-grid-interface.test.ts`
- Modify: `tests/payroll-production.test.ts`
- Modify: `tests/navigation.test.ts`

**Interfaces:**
- Consumes: `ManagerPageNav` and `ManagerHelpLink`
- Preserves: existing rota actions, workbook exports and pay-warning logic

- [ ] **Step 1: Write failing copy and hierarchy tests**

Assert:

```ts
expect(source("src/components/dashboard/production-dashboard.tsx")).toContain(">Home<");
expect(source("src/app/payroll/page.tsx")).toContain("Export pay hours");
expect(source("src/app/payroll/review/page.tsx")).toContain("Import pay details");
expect(source("src/app/payroll/arrangements/page.tsx")).toContain("Pay details");
expect(source("src/components/settings/production-settings.tsx")).toContain("Nursery settings");
```

Also assert these manager files no longer contain `Production data | Supabase`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- tests/dashboard-production.test.ts tests/rota-grid-interface.test.ts tests/payroll-production.test.ts tests/navigation.test.ts`

Expected: FAIL on the old labels and technical production copy.

- [ ] **Step 3: Reorder Home by urgency**

Render:

1. Needs attention
2. Today
3. Quick actions
4. Records and checks summary

Use action-led text such as `Review 3 missing clock-outs`. Make zero-value items visually quiet and remove repeated Live pills.

- [ ] **Step 4: Add Rota local navigation**

Use submenu destinations:

- Weekly rota
- Copy tools
- Templates
- Download

Keep Publish rota visible as the primary command. Keep Clear day, Return to draft and Archive week under More actions.

- [ ] **Step 5: Separate pay language**

Use:

- `Export pay hours` for `/payroll`
- `Import pay details` for `/payroll/review`
- `Pay details` for `/payroll/arrangements`

Add a page submenu on the pay-hours screens so these destinations remain discoverable without returning them to the main navigation. Keep Export pay hours selected by default, and treat Import pay details as an advanced manager destination.

Keep the existing warning that this is not completed payroll and do not remove unresolved-attendance confirmation.

- [ ] **Step 6: Clean manager technical copy**

Remove `Production data`, `Supabase`, `canonical`, `Auth` and `UUID` from ordinary page headings and instructions. Retain technical error details only where a manager needs to report a configuration fault.

- [ ] **Step 7: Run focused tests**

Run: `npm test -- tests/dashboard-production.test.ts tests/rota-grid-interface.test.ts tests/payroll-production.test.ts tests/navigation.test.ts`

Expected: PASS.

- [ ] **Step 8: Commit**

```powershell
git add src/components/dashboard/production-dashboard.tsx src/components/rota/production-rota.tsx src/app/payroll/page.tsx src/app/payroll/review/page.tsx src/app/payroll/arrangements/page.tsx src/components/settings/production-settings.tsx tests/dashboard-production.test.ts tests/rota-grid-interface.test.ts tests/payroll-production.test.ts tests/navigation.test.ts
git commit -m "Clarify remaining manager workflows"
```

### Task 8: Full Verification and Rendered UX Audit

**Files:**
- Modify only files required to fix failures found during verification.

**Interfaces:**
- Verifies all interfaces produced by Tasks 1 through 7.

- [ ] **Step 1: Run formatting-independent checks**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 2: Start the local app**

Run: `npm run dev -- --hostname 127.0.0.1 --port 3000`

Expected: Next.js reports the local URL and no startup error.

- [ ] **Step 3: Verify the manager navigation**

Using the signed-in manager browser session, check:

- Home, Rota, Clock-ins & hours, Leave requests and Staff records are visible.
- Export pay hours has one clear destination.
- Help is visible.
- Compliance, Accounts, Pay arrangements and Payroll review are absent from primary navigation.
- Mobile navigation opens, traps focus, closes with Escape and scrolls independently.

- [ ] **Step 4: Verify Attendance at 1440 by 900**

Check:

- Add a missing clock-in or clock-out is visible without scrolling.
- The submenu switches views.
- Only the selected view is rendered.
- Adding a correction uses the existing manager action and leaves original events visible.
- No relevant console errors or framework overlay appear.

- [ ] **Step 5: Verify Attendance at 390 by 844**

Check:

- primary action is full width in the first viewport
- Jump to control exposes all views
- no horizontal overflow or overlapping text
- the previous 23,000 px stacked layout is gone

- [ ] **Step 6: Verify staff records**

Check:

- Add staff member is visible in the first viewport.
- Search and Active, Needs setup and Inactive filters work.
- Open record reaches the selected employee.
- Name shown on Staff Clock is unambiguous.
- Clocking-in, login, training/checks and pay sections are reachable from the submenu.
- No pay value appears in the staff directory or Staff Clock.

- [ ] **Step 7: Verify Help shortcuts**

Exercise:

- search for `forgot clock out`
- open Add a missing clock-in or clock-out
- confirm Attendance opens with the correction form selected
- open Add staff member
- confirm Staff records opens with the form selected

- [ ] **Step 8: Verify Staff Clock refresh**

Change a non-sensitive test employee display name, save it, refresh Staff Clock and verify the new display name appears. Confirm no clock events or historic pay arrangements changed.

- [ ] **Step 9: Capture desktop and mobile evidence**

Capture first-viewport screenshots for:

- Home desktop
- Attendance desktop
- Attendance mobile
- Staff records desktop
- Employee record mobile
- Help mobile

Review for clipping, overlap, hidden primary actions, excessive empty space and inaccessible touch targets.

- [ ] **Step 10: Run final checks after QA fixes**

Run:

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Expected: all commands exit successfully.

- [ ] **Step 11: Commit verification fixes**

Run `git status --short`, stage only UX-redesign files changed while fixing verification failures, then commit:

```powershell
git commit -m "Verify manager UX redesign"
```

Do not stage the pre-existing README or Supabase migration changes.
