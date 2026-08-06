import { describe, expect, it } from "vitest";
import {
  createWorkAreaDescriptor,
  readAvailableWorkAreas,
  readWorkArea,
  workAreaPayload,
} from "@/lib/platform/work-areas";

describe("work-area compatibility", () => {
  it("uses neutral records with industry-specific presentation labels", () => {
    expect(createWorkAreaDescriptor("area-1", "org-1", "site-1", "Blue", "nursery")).toEqual({
      id: "area-1",
      organisationId: "org-1",
      siteId: "site-1",
      name: "Blue",
      singularLabel: "Room",
      pluralLabel: "Rooms",
    });
    expect(createWorkAreaDescriptor("area-2", "org-2", "site-2", "Science", "tuition_centre").singularLabel).toBe("Classroom");
  });

  it("prefers canonical database values and falls back to legacy room values", () => {
    expect(readWorkArea({ work_area: "Department", room_or_area: "Legacy room" })).toBe("Department");
    expect(readWorkArea({ room_or_area: "Legacy room" })).toBe("Legacy room");
    expect(readAvailableWorkAreas({ available_work_areas: ["Unit"], available_rooms: ["Old room"] })).toEqual(["Unit"]);
    expect(readAvailableWorkAreas({ available_rooms: ["Old room"] })).toEqual(["Old room"]);
  });

  it("writes canonical and legacy fields during the compatibility window", () => {
    expect(workAreaPayload(" Classroom 1 ")).toEqual({
      work_area: "Classroom 1",
      room_or_area: "Classroom 1",
    });
    expect(workAreaPayload(" ")).toEqual({ work_area: null, room_or_area: null });
  });
});
