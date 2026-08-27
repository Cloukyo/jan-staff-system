import { describe, expect, it } from "vitest";
import {
  browserIdentifiers,
  migrateStoredValue,
} from "@/lib/platform/browser-identifiers";
import { createMemoryStorage } from "@/lib/repositories/local-persistence";

describe("browser identifier compatibility", () => {
  it("uses neutral canonical identifiers and retains every Jan identifier as a legacy input", () => {
    expect(browserIdentifiers.demoStorage.current).toBe("workforce-platform-demo-state-v1");
    expect(browserIdentifiers.demoStorage.legacy).toContain("jan-staff-demo-state-v5");
    expect(browserIdentifiers.complianceStorage.current).toBe("workforce-platform-compliance-demo-v1");
    expect(browserIdentifiers.deviceCookie.current).toBe("workforce_clocking_device");
    expect(browserIdentifiers.deviceCookie.legacy).toContain("jan_kiosk_device");
    expect(browserIdentifiers.offlineDatabase.current).toBe("workforce-platform-clock");
    expect(browserIdentifiers.offlineDatabase.legacy).toContain("jan-staff-clock");
    expect(browserIdentifiers.backgroundSync.current).toBe("workforce-platform-clock-sync");
    expect(browserIdentifiers.backgroundSync.legacy).toContain("jan-staff-clock-sync");
  });

  it("copies a legacy storage value to the neutral key without discarding the legacy evidence", () => {
    const storage = createMemoryStorage({ "jan-staff-demo-state-v5": "legacy-value" });
    expect(migrateStoredValue(storage, browserIdentifiers.demoStorage)).toBe("legacy-value");
    expect(storage.getItem("workforce-platform-demo-state-v1")).toBe("legacy-value");
    expect(storage.getItem("jan-staff-demo-state-v5")).toBe("legacy-value");
  });
});
