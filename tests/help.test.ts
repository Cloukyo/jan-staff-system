import { describe, expect, it } from "vitest";
import {
  filterManagerHelpTasks,
  managerHelpTasks,
} from "@/lib/help/manager-help";

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

  it("opens primary tasks in their selected workflows", () => {
    expect(
      managerHelpTasks.find((task) => task.id === "add-missing-clock-event")
        ?.href,
    ).toBe("/attendance?view=add-event");
    expect(
      managerHelpTasks.find((task) => task.id === "add-staff-member")?.href,
    ).toBe("/staff?action=add");
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
