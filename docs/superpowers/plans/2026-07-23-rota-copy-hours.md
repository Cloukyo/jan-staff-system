# Rota Copy Hours Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add safe manager controls for copying a staff member's previous-day pattern or copying one shift's hours to later days in the same draft rota week.

**Architecture:** Add pure date and shift-selection helpers for predictable client behaviour, two atomic manager-only PostgreSQL functions for archive-and-create operations, server actions that call those functions, and accessible controls inside the existing shift editor drawer. Existing rota rows are archived, never deleted.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase PostgreSQL, Vitest, date-fns, Tailwind CSS.

## Global Constraints

- Use UK date, time and currency formats and the Europe/London timezone.
- Copy only start time, finish time, and break state.
- Preserve history by archiving replaced shifts.
- Only managers may copy shifts, and only within a draft rota week.
- Do not expose pay information.
- Keep touch targets large and accessible.
- Do not use em dashes in user-facing application copy.
- Run lint, type checking, tests, and the production build.

---

### Task 1: Copy-selection helpers

**Files:**
- Modify: `src/lib/rota/grid.ts`
- Test: `tests/rota-grid-interface.test.ts`

**Interfaces:**
- Produces: `laterWeekDates(weekStart: string, sourceDate: string): string[]`
- Produces: `previousDayShifts(staffId: string, targetDate: string, shifts: ProductionRotaShift[]): ProductionRotaShift[]`

- [ ] **Step 1: Write failing helper tests**

```ts
expect(laterWeekDates("2026-06-15", "2026-06-17")).toEqual([
  "2026-06-18", "2026-06-19", "2026-06-20", "2026-06-21",
]);
expect(previousDayShifts("staff-1", "2026-06-16", [shift])).toEqual([shift]);
expect(previousDayShifts("staff-1", "2026-06-15", [shift])).toEqual([]);
```

- [ ] **Step 2: Run `npm test -- tests/rota-grid-interface.test.ts` and verify failure because the helpers are not exported**

- [ ] **Step 3: Implement helpers with `parseISO`, `addDays`, and active-shift filtering**

```ts
export function laterWeekDates(weekStart: string, sourceDate: string): string[] {
  const end = addDays(parseISO(weekStart), 6);
  const dates: string[] = [];
  for (let date = addDays(parseISO(sourceDate), 1); date <= end; date = addDays(date, 1)) {
    dates.push(format(date, "yyyy-MM-dd"));
  }
  return dates;
}
```

- [ ] **Step 4: Re-run the focused test and verify it passes**

### Task 2: Atomic database copy operations

**Files:**
- Create: `supabase/migrations/202607230001_rota_copy_hours.sql`
- Test: `tests/rota-production.test.ts`

**Interfaces:**
- Produces RPC: `copy_staff_previous_day_pattern(target_week_id uuid, target_staff_id uuid, target_shift_date date) -> jsonb`
- Produces RPC: `copy_shift_hours_to_days(source_shift_id uuid, target_shift_dates date[]) -> jsonb`

- [ ] **Step 1: Add failing migration contract assertions**

```ts
expect(migration).toContain("copy_staff_previous_day_pattern");
expect(migration).toContain("copy_shift_hours_to_days");
expect(migration).toContain("archived_at = timezone('utc', now())");
expect(migration).toContain("manager_account.role <> 'manager'");
expect(migration).toContain("week.status <> 'draft'");
```

- [ ] **Step 2: Run `npm test -- tests/rota-production.test.ts` and verify the new migration file is missing**

- [ ] **Step 3: Implement both security-definer functions**

The functions must validate manager access and draft-week membership, archive active target-day rows, copy only `start_time`, `end_time`, `break_minutes`, and `break_unspecified`, set new rows to `scheduled`, and return `mode`, `days_updated`, and `shifts_created`. The previous-day function returns `mode = 'not_working'` when no source rows exist and otherwise recreates every source shift so split shifts remain intact.

- [ ] **Step 4: Grant only authenticated execution and run the focused test**

### Task 3: Server action adapters

**Files:**
- Modify: `src/lib/rota/actions.ts`
- Test: `tests/rota-grid-interface.test.ts`

**Interfaces:**
- Produces: `copyPreviousDayPatternAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState>`
- Produces: `copyShiftHoursToDaysAction(_state: RotaActionState, formData: FormData): Promise<RotaActionState>`

- [ ] **Step 1: Add failing source-contract tests for action names, RPC names, target-date parsing, and success messages**

```ts
expect(rotaActions).toContain("export async function copyPreviousDayPatternAction");
expect(rotaActions).toContain('.rpc("copy_staff_previous_day_pattern"');
expect(rotaActions).toContain("changed to not working");
expect(rotaActions).toContain("export async function copyShiftHoursToDaysAction");
expect(rotaActions).toContain('.rpc("copy_shift_hours_to_days"');
```

- [ ] **Step 2: Run the focused test and verify failure because the actions do not exist**

- [ ] **Step 3: Implement both actions using `requireAccount(["manager"])`, validated form fields, RPC calls, existing friendly database errors, `/rota` revalidation, and concise result messages**

- [ ] **Step 4: Run the focused test and verify it passes**

### Task 4: Shift editor copy controls

**Files:**
- Modify: `src/components/rota/production-rota-grid.tsx`
- Test: `tests/rota-grid-interface.test.ts`

**Interfaces:**
- Consumes: `laterWeekDates`, `previousDayShifts`, `copyPreviousDayPatternAction`, and `copyShiftHoursToDaysAction`

- [ ] **Step 1: Add failing interface assertions**

```ts
expect(rotaGrid).toContain("Copy previous day");
expect(rotaGrid).toContain("Copy to other days");
expect(rotaGrid).toContain("Copy hours");
expect(rotaGrid).toContain('name="targetDates"');
expect(rotaGrid).toContain("This will replace existing shifts");
expect(rotaGrid).toContain("min-h-11");
```

- [ ] **Step 2: Run the focused test and verify failure because the controls are absent**

- [ ] **Step 3: Add a Copy hours section**

Use `RotaActionForm` for the previous-day action with a confirmation that explicitly says an empty previous day will make the target day not working. Disable it on Monday. For an existing shift, render later-day checkboxes with `name="targetDates"` and a replacement confirmation. Use `format(parseISO(date), "EEEE d MMMM")` for UK-facing dates and close the drawer on success.

- [ ] **Step 4: Run the focused test, then `npm test`, and verify all tests pass**

### Task 5: Full verification

**Files:**
- Modify only files needed to fix issues caused by Tasks 1 through 4.

- [ ] **Step 1: Run `npm run lint` and fix feature-related failures**
- [ ] **Step 2: Run `npm run typecheck` and fix feature-related failures**
- [ ] **Step 3: Run `npm test` and fix feature-related failures**
- [ ] **Step 4: Run `npm run build` and fix feature-related failures**
- [ ] **Step 5: Review `git diff --check` and confirm unrelated working-tree changes remain untouched**
