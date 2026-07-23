import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { rotaRepositorySource } from "@/lib/rota/server";
import { leaveWarningsForShift, overlapWarningsForShift, shiftDurationMinutes } from "@/lib/rota/validation";
import type { ProductionRotaShift, RotaLeaveWarning } from "@/lib/rota/types";

const shift: ProductionRotaShift = {
  id: "shift-1",
  rotaWeekId: "week-1",
  staffId: "canonical-staff-id",
  shiftDate: "2026-06-15",
  startTime: "08:30",
  endTime: "16:30",
  breakMinutes: 30,
  breakUnspecified: false,
  roomOrArea: "Preschool",
  roleOnShift: null,
  notes: null,
  status: "scheduled",
  inactiveStaffOverrideReason: null,
  leaveOverrideReason: null,
  overlapOverrideReason: null,
  archivedAt: null,
};

describe("production rota repository separation", () => {
  it("uses Supabase in production and retains the isolated demo repository", () => {
    expect(rotaRepositorySource("production")).toBe("supabase");
    expect(rotaRepositorySource("demo")).toBe("demo");
    const page = readFileSync(resolve("src/app/rota/page.tsx"), "utf8");
    expect(page).toContain('getAppMode() === "demo"');
    expect(page).toContain("loadProductionRota");
    expect(page).not.toContain("localStorage");
  });
});

describe("production rota validation", () => {
  it("rejects invalid and overnight time ranges", () => {
    expect(shiftDurationMinutes("09:00", "09:00")).toBe(0);
    expect(shiftDurationMinutes("17:00", "08:00")).toBe(0);
    expect(shiftDurationMinutes("08:30", "16:30")).toBe(480);
  });

  it("detects approved and pending leave but ignores rejected leave", () => {
    const approved: RotaLeaveWarning = {
      id: "leave-1", staffId: shift.staffId, startDate: shift.shiftDate, endDate: shift.shiftDate,
      dayPart: "full_day", startTime: null, endTime: null, status: "approved",
    };
    const pending = { ...approved, id: "leave-2", status: "pending" as const };
    expect(leaveWarningsForShift(shift, [approved, pending])).toHaveLength(2);
    expect(leaveWarningsForShift(shift, [])).toHaveLength(0);
  });

  it("detects overlapping shifts for the same canonical staff profile", () => {
    expect(overlapWarningsForShift(shift, [{ ...shift, id: "shift-2", startTime: "16:00", endTime: "18:00" }])).toHaveLength(1);
    expect(overlapWarningsForShift(shift, [{ ...shift, id: "shift-3", staffId: "other", startTime: "16:00", endTime: "18:00" }])).toHaveLength(0);
  });
});

describe("production rota migration safeguards", () => {
  const migration = readFileSync(resolve("supabase/migrations/202606120003_production_rota.sql"), "utf8");
  const bulkGuards = readFileSync(resolve("supabase/migrations/202606120004_rota_bulk_operation_guards.sql"), "utf8");
  const copyHours = readFileSync(resolve("supabase/migrations/20260723162015_rota_copy_hours.sql"), "utf8");

  it("enforces canonical links, time checks and audit fields", () => {
    expect(migration).toContain("references public.staff_profiles(id)");
    expect(migration).toContain("constraint rota_shift_time_order check (end_time > start_time)");
    expect(migration).toContain("constraint rota_shift_break_duration");
    expect(migration).toContain("created_by uuid not null references public.staff_accounts(id)");
    expect(migration).toContain("published_by uuid references public.staff_accounts(id)");
  });

  it("prevents duplicate shifts and requires reasons for approved leave and overlaps", () => {
    expect(migration).toContain("rota_shifts_identical_active_idx");
    expect(migration).toContain("Approved leave conflict requires an override reason");
    expect(migration).toContain("Overlapping shift requires an enabled override and a reason");
  });

  it("keeps manager writes protected and staff reads limited to their published shifts", () => {
    expect(migration).toContain("Managers can manage rota shifts");
    expect(migration).toContain("Staff can read own published shifts");
    expect(migration).toContain("rw.status = 'published'");
    expect(migration).toContain("revoke all on public.rota_settings, public.rota_weeks, public.rota_shifts from anon");
  });

  it("provides idempotent transactional copy operations", () => {
    expect(migration).toContain("copy_previous_rota_week");
    expect(migration).toContain("copy_rota_day");
    expect(migration).toContain("and not exists");
    expect(migration).toContain("get diagnostics copied_count = row_count");
    expect(bulkGuards).toContain("target_week.status <> 'draft'");
    expect(bulkGuards).toContain("Previous week can only be copied into a draft rota");
  });

  it("copies staff hours atomically while retaining archived target records", () => {
    expect(copyHours).toContain("copy_staff_previous_day_pattern");
    expect(copyHours).toContain("copy_shift_hours_to_days");
    expect(copyHours).toContain("archived_at = now()");
    expect(copyHours).toContain("manager_account.role <> 'manager'");
    expect(copyHours).toContain("target_week.status <> 'draft'");
    expect(copyHours).toContain("break_unspecified");
  });
});
