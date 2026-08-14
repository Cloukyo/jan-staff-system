// @vitest-environment node

import { describe, expect, it, vi } from "vitest";
import { executeCommercialRotaCommand, loadCommercialPlannedShifts } from "@/lib/rota/tenant-service";
import type { CommercialMembershipContext } from "@/types/tenancy";

const context = {
  organisationId: "10000000-0000-0000-0000-000000000001",
  selectedSiteId: "11000000-0000-0000-0000-000000000001",
  permittedSiteIds: ["11000000-0000-0000-0000-000000000001"],
} as CommercialMembershipContext;

describe("commercial rota service", () => {
  it("passes only server-resolved ownership to the command RPC", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { outcome: "success", code: "week_created", weekId: "40000000-0000-4000-8000-000000000001", revision: 1 }, error: null });
    await executeCommercialRotaCommand(context, "create_week", { weekStart: "2026-08-17", organisationId: "ignored" }, { idempotencyKey: "50000000-0000-0000-0000-000000000001" }, { client: { rpc } });
    expect(rpc).toHaveBeenCalledWith("execute_commercial_rota_command", expect.objectContaining({
      target_organisation_id: context.organisationId,
      target_site_id: context.selectedSiteId,
      command_name: "create_week",
    }));
  });

  it("fails closed without a permitted selected site", async () => {
    await expect(executeCommercialRotaCommand({ ...context, selectedSiteId: null }, "create_week", {}, { idempotencyKey: "50000000-0000-0000-0000-000000000002" }, { client: { rpc: vi.fn() } })).rejects.toThrow(/permitted site/i);
  });

  it("loads planned shifts through the guarded tenant RPC", async () => {
    const rows = [{ organisation_id: context.organisationId, site_id: context.selectedSiteId, shift_id: "40000000-0000-0000-0000-000000000001", rota_week_id: "40000000-0000-0000-0000-000000000002", staff_id: "staff-a", shift_date: "2026-08-17", start_time: "09:00", end_time: "17:00", break_minutes: 30, work_area_id: null, role_on_shift: null }];
    const rpc = vi.fn().mockResolvedValue({ data: rows, error: null });
    await expect(loadCommercialPlannedShifts(context, { from: "2026-08-17", to: "2026-08-23" }, { client: { rpc } })).resolves.toEqual(rows);
    expect(rpc).toHaveBeenCalledWith("get_commercial_planned_shifts", expect.objectContaining({ target_site_id: context.selectedSiteId }));
  });
});
