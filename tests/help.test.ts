import { describe, expect, it } from "vitest";
import {
  filterManagerHelpTasks,
  managerHelpTasks,
} from "@/lib/help/manager-help";
import { parseAttendanceManagerView } from "@/lib/attendance/manager-view";
import { parseStaffDirectoryFilter } from "@/lib/staff/directory";

describe("manager help", () => {
  it("covers the approved manager tasks", () => {
    expect(managerHelpTasks.map((task) => task.id)).toEqual(
      expect.arrayContaining([
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
      ]),
    );
  });

  it("keeps instructions short and shortcuts internal", () => {
    for (const task of managerHelpTasks) {
      expect(task.steps.length).toBeGreaterThan(0);
      expect(task.steps.length).toBeLessThanOrEqual(4);
      expect(task.href.startsWith("/")).toBe(true);
    }
  });

  it("opens every task at its working route contract", () => {
    expect(
      Object.fromEntries(managerHelpTasks.map((task) => [task.id, task.href])),
    ).toEqual({
      "add-missing-clock-event": "/attendance?view=add-event",
      "review-attendance": "/attendance?view=needs-attention",
      "edit-rota": "/rota",
      "add-staff-member": "/staff?action=add",
      "change-staff-clock-name": "/staff?filter=active",
      "enable-staff-clock": "/staff?filter=needs-setup",
      "manage-staff-login": "/staff?filter=active",
      "review-leave": "/leave/requests",
      "export-pay-hours": "/payroll",
      "manage-clocking-device": "/settings/kiosk",
    });
  });

  it("matches Help parameters to destination parsers and defaults", () => {
    const byId = new Map(
      managerHelpTasks.map((task) => [
        task.id,
        new URL(task.href, "https://jan.local"),
      ]),
    );

    expect(
      parseAttendanceManagerView(
        byId.get("add-missing-clock-event")?.searchParams.get("view")
          ?? undefined,
      ),
    ).toBe("add-event");
    expect(
      parseAttendanceManagerView(
        byId.get("review-attendance")?.searchParams.get("view") ?? undefined,
      ),
    ).toBe("needs-attention");
    expect(
      parseStaffDirectoryFilter(
        byId.get("manage-staff-login")?.searchParams.get("filter")
          ?? undefined,
      ),
    ).toBe("active");
    expect(
      parseStaffDirectoryFilter(
        byId.get("enable-staff-clock")?.searchParams.get("filter")
          ?? undefined,
      ),
    ).toBe("needs-setup");
    expect(byId.get("add-staff-member")?.searchParams.get("action")).toBe("add");
    for (const id of [
      "edit-rota",
      "review-leave",
      "export-pay-hours",
      "manage-clocking-device",
    ]) {
      expect(byId.get(id)?.search).toBe("");
    }
  });

  it("searches titles, groups and steps", () => {
    expect(
      filterManagerHelpTasks("forgot clock out").map((task) => task.id),
    ).toContain("add-missing-clock-event");
    expect(filterManagerHelpTasks("leave").map((task) => task.id)).toContain(
      "review-leave",
    );
    expect(
      filterManagerHelpTasks("register this browser").map((task) => task.id),
    ).toContain("manage-clocking-device");
  });

  it("treats blank search as all tasks", () => {
    expect(filterManagerHelpTasks("   ")).toEqual(managerHelpTasks);
  });
});
