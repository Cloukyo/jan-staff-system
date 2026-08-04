# Kiosk Maintenance Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the kiosk online while offline clocking is disabled and make the PIN-verification RPC compatible with both the pre-state-machine and current application response contracts.

**Architecture:** Add an explicit build-time gate which defaults the offline client runtime to disabled, so a dormant feature performs no health polling or provisioning. Replace the PIN response mapper with one dual-shape mapper, then change the database RPC to return a table row containing both legacy fields and the authoritative attendance state so old and new application builds can coexist.

**Tech Stack:** Next.js 16, React 19, TypeScript, Vitest, Supabase PostgreSQL/PostgREST, Vercel.

## Global Constraints

- Use UK date and time formats and the Europe/London timezone.
- Preserve every original `clock_events` row and keep manager corrections separate.
- Do not enable offline clocking globally or on any device.
- Do not expose salary, pay-rate, PIN or service-role information.
- Apply the application compatibility change before the RPC migration.
- Do not deploy unless there are zero open shifts and no recent kiosk activity.

---

### Task 1: Dual-shape PIN response compatibility

**Files:**
- Modify: `tests/kiosk-state-machine.test.ts`
- Modify: `src/lib/kiosk/rpc-mapping.ts`
- Modify: `src/lib/kiosk/actions.ts`

**Interfaces:**
- Consumes: JSON object responses from `verify_device_kiosk_pin` and legacy PostgREST arrays.
- Produces: `mapKioskVerificationResponse(value: KioskActionRpcResponse | LegacyKioskRpcResponse[] | null | undefined): KioskActionResult`.

- [ ] **Step 1: Write the failing mapper tests**

```ts
expect(mapKioskVerificationResponse({
  ok: true,
  code: "verified",
  state: "clocked_out",
  attendanceState: latest,
})).toEqual(expect.objectContaining({ ok: true, attendanceState: latest }));

expect(mapKioskVerificationResponse([{
  ok: true,
  code: "verified",
  current_status: "clocked_out",
  attendance_state: latest,
  work_week_start_date: "2026-08-03",
  work_week_end_date: "2026-08-09",
  completed_minutes: 480,
  open_shift_in_progress: false,
}])).toEqual(expect.objectContaining({
  ok: true,
  attendanceState: latest,
  weeklyHours: expect.objectContaining({ completedMinutes: 480 }),
}));
```

- [ ] **Step 2: Run the focused test and verify it fails because the mapper does not exist**

Run: `npm test -- tests/kiosk-state-machine.test.ts`

Expected: FAIL because `mapKioskVerificationResponse` is not exported.

- [ ] **Step 3: Implement the minimal dual-shape mapper and use it for PIN verification**

```ts
export function mapKioskVerificationResponse(value: KioskVerificationRpcValue) {
  const row = Array.isArray(value) ? value[0] : value;
  if (!row) return mapKioskActionResponse(null);
  return mapKioskActionResponse({
    ...row,
    state: row.state ?? row.current_status,
    attendanceState: row.attendanceState ?? row.attendance_state,
    weeklyHours: row.weeklyHours ?? legacyWeeklyHours(row),
  });
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npm test -- tests/kiosk-state-machine.test.ts`

Expected: PASS.

### Task 2: Dormant offline-runtime gate

**Files:**
- Create: `src/lib/kiosk/offline/feature.ts`
- Create: `tests/offline-kiosk-feature.test.ts`
- Modify: `tests/offline-kiosk-ui.test.ts`
- Modify: `src/components/kiosk/use-offline-kiosk.ts`

**Interfaces:**
- Consumes: optional `NEXT_PUBLIC_OFFLINE_KIOSK_RUNTIME_ENABLED` build-time value.
- Produces: `offlineKioskRuntimeEnabled(value?: string): boolean` and `OFFLINE_KIOSK_RUNTIME_ENABLED`.

- [ ] **Step 1: Write failing tests for default-disabled and explicit-only enablement**

```ts
expect(offlineKioskRuntimeEnabled()).toBe(false);
expect(offlineKioskRuntimeEnabled("false")).toBe(false);
expect(offlineKioskRuntimeEnabled("TRUE")).toBe(false);
expect(offlineKioskRuntimeEnabled("true")).toBe(true);
```

Also assert that `use-offline-kiosk.ts` imports the gate and returns before installing launch, online, visibility, background and periodic maintenance when the gate is false.

- [ ] **Step 2: Run focused tests and verify they fail for the missing gate**

Run: `npm test -- tests/offline-kiosk-feature.test.ts tests/offline-kiosk-ui.test.ts`

Expected: FAIL because the feature module and disabled guard do not exist.

- [ ] **Step 3: Implement the strict opt-in gate**

```ts
export function offlineKioskRuntimeEnabled(value?: string): boolean {
  return value === "true";
}

export const OFFLINE_KIOSK_RUNTIME_ENABLED = offlineKioskRuntimeEnabled(
  process.env.NEXT_PUBLIC_OFFLINE_KIOSK_RUNTIME_ENABLED,
);
```

Guard both `maintain` and its effect before any health request, provisioning request, event-listener registration or periodic timer. Preserve local queued evidence and keep `offlineUsable` false while disabled.

- [ ] **Step 4: Run focused tests and verify they pass**

Run: `npm test -- tests/offline-kiosk-feature.test.ts tests/offline-kiosk-ui.test.ts`

Expected: PASS.

### Task 3: Database rollback-compatible PIN contract

**Files:**
- Create: `supabase/migrations/<generated>_restore_kiosk_pin_rollback_compatibility.sql`
- Modify: `tests/kiosk.test.ts`
- Modify: `docs/attendance-state-machine-rollout.md`

**Interfaces:**
- Consumes: `verify_kiosk_pin(text,text)` and `get_attendance_state(text,timestamptz)`.
- Produces: `verify_device_kiosk_pin(text,text,text)` as a PostgREST row array with legacy status/hours fields plus `attendance_state jsonb`.

- [ ] **Step 1: Write the failing migration contract test**

```ts
expect(compatibilityMigration).toMatch(/returns table[\s\S]*current_status text/i);
expect(compatibilityMigration).toMatch(/returns table[\s\S]*attendance_state jsonb/i);
expect(compatibilityMigration).toContain("public.get_attendance_state");
expect(compatibilityMigration).toContain("to anon, authenticated");
```

- [ ] **Step 2: Run the focused test and verify it fails because the migration is absent**

Run: `npm test -- tests/kiosk.test.ts`

Expected: FAIL because the generated compatibility migration cannot be read.

- [ ] **Step 3: Generate and implement the migration**

Run: `supabase migration new restore_kiosk_pin_rollback_compatibility`

The migration must revoke, drop and recreate only `verify_device_kiosk_pin(text,text,text)`. It must not update or delete attendance tables, and it must revoke `PUBLIC` before granting execute only to `anon` and `authenticated`.

- [ ] **Step 4: Update the rollout document with the incident constraint**

Record that SHA `3090800c50f8ea1125ded10660af4b84db87aad5` and deployment `dpl_Do3ZUnFuCJ6CmKVQL3dGXcsAafhW` are unsafe rollback targets until this compatibility migration is installed. Require app-first, migration-second rollout order.

- [ ] **Step 5: Run the focused test and verify it passes**

Run: `npm test -- tests/kiosk.test.ts tests/kiosk-state-machine.test.ts`

Expected: PASS.

### Task 4: Verification and controlled rollout

**Files:**
- Verify only: all changed files.

**Interfaces:**
- Consumes: clean test/build output, preview database and preview deployment.
- Produces: one reviewed commit, a preview-tested deployment, and a production deployment whose previous release is itself database-compatible.

- [ ] **Step 1: Run the complete local verification suite**

Run: `npm run lint && npm run typecheck && npm test && npm run build`

Expected: all commands exit zero.

- [ ] **Step 2: Commit and push the branch**

```bash
git add docs src tests supabase/migrations
git commit -m "fix: make kiosk maintenance rollback safe"
git push -u origin codex/kiosk-maintenance-safety
```

- [ ] **Step 3: Apply the one new migration to preview and verify both RPC shapes**

Verify that the preview RPC returns an array with `attendance_state`, no clock-event count changes, no offline-enabled devices and no offline authorisations.

- [ ] **Step 4: Verify the preview application**

Confirm the preview build SHA, `/clock` response, zero recurring disabled-offline health requests, and clean runtime errors.

- [ ] **Step 5: Re-run production safety checks before any production write**

Confirm zero open shifts, no kiosk activity in the last ten minutes, current counts and hashes, backup status, and offline disabled globally and per device. Stop if any check fails.

- [ ] **Step 6: Merge and let the application deploy before applying the compatibility migration**

Verify the deployed SHA first. Apply exactly the single new compatibility migration, then verify both the current and legacy PIN response consumers against a safe non-payroll profile only. If no safe profile exists, do not perform a write smoke test.

- [ ] **Step 7: Run post-deploy diagnostics**

Confirm event and correction counts did not decrease, original event hashes are unchanged, no open shifts or duplicates appeared, no offline authorisation exists, and no disabled-offline health polling or new runtime error remains.
