import { describe, expect, it } from "vitest";
import { rotaWeekScopeLabel, staffMayBeginWorkOn } from "@/lib/rota/presentation";
import type { ProductionRotaStaff } from "@/lib/rota/types";

describe("rota UX presentation", () => {
  it("uses the authoritative date-specific readiness projection", () => {
    const staff = { id: "staff-1", fullName: "Fictional Manager", displayName: "Manager", employmentRole: "Manager", active: true, operationalReadiness: { "2026-09-14": false, "2026-09-15": true } } satisfies ProductionRotaStaff;
    expect(staffMayBeginWorkOn(staff, "2026-09-14")).toBe(false);
    expect(staffMayBeginWorkOn(staff, "2026-09-15")).toBe(true);
    expect(staffMayBeginWorkOn(staff, "2026-09-16")).toBeNull();
  });

  it("states the exact site and date scope for consequential week actions", () => {
    expect(rotaWeekScopeLabel("Fictional Nursery", "14/09/2026", "20/09/2026")).toBe("Fictional Nursery, 14/09/2026 to 20/09/2026");
  });
});
