import { describe, expect, it, vi } from "vitest";
import { buildCustomerExport, type CustomerExportDependencies } from "@/lib/exports/customer-export";

const fixture = {
  exportVersion: "commercial_customer_export_v1",
  organisationId: "10000000-0000-4000-8000-000000000001",
  presentationTimezone: "Europe/London",
  omissions: ["compliance document file bytes are not included in the supervised pilot export"],
  categories: {
    organisation: [{ id: "10000000-0000-4000-8000-000000000001", displayName: "Northstar Fictional Services" }],
    sites: [{ id: "11000000-0000-4000-8000-000000000001", name: "Northstar Central" }],
    staff: [{ id: "fictional-staff-1", displayName: "Taylor Example" }],
    staffSiteAssignments: [], qualifications: [], credentials: [], complianceRequirements: [], complianceDocuments: [],
    clockEvents: [{ id: "event-1", eventType: "clock_in" }],
    attendanceCorrections: [{ id: "correction-1", originalEventId: "event-1" }],
    attendanceExceptions: [], rotaWeeks: [], rotaShifts: [], rotaTemplates: [], leaveRequests: [],
    payrollPeriods: [], payrollRows: [], payrollAdjustments: [], payrollApprovals: [], payrollExportAudits: [], payArrangements: [],
    organisationSettings: [], siteSettings: [], memberships: [], roles: [], siteAccess: [], invitations: [],
  },
};

function deps(payload: unknown = fixture): CustomerExportDependencies {
  return {
    prepare: vi.fn().mockResolvedValue(payload),
    recordAudit: vi.fn().mockResolvedValue({ outcome: "recorded" }),
    now: () => new Date("2026-08-18T12:34:56.000Z"),
  };
}

describe("owner customer export", () => {
  it("builds a canonically digestible versioned bundle and immutable audit input", async () => {
    const dependencies = deps();
    const result = await buildCustomerExport(dependencies);
    const parsed = JSON.parse(result.canonicalBody) as { manifest: { digest: string; counts: Record<string, number> } };

    expect(result.filename).toBe("workforce-platform-export-2026-08-18.json");
    expect(parsed.manifest.counts).toMatchObject({ organisation: 1, sites: 1, staff: 1, clockEvents: 1, attendanceCorrections: 1 });
    expect(parsed.manifest.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(dependencies.recordAudit).toHaveBeenCalledWith(expect.objectContaining({
      schemaVersion: "commercial_customer_export_v1",
      digest: parsed.manifest.digest,
      filename: result.filename,
    }));
  });

  it("fails closed if a database projection contains a forbidden secret field", async () => {
    const unsafe = structuredClone(fixture) as typeof fixture & { categories: typeof fixture.categories & { devices: unknown[] } };
    unsafe.categories.devices = [{ id: "device-1", tokenHash: "forbidden" }];
    await expect(buildCustomerExport(deps(unsafe))).rejects.toThrow("forbidden field");
  });

  it("excludes the digest field from the bytes being hashed", async () => {
    const result = await buildCustomerExport(deps());
    const parsed = JSON.parse(result.canonicalBody) as { manifest: { digest: string }; data: unknown };
    const changed = structuredClone(fixture);
    changed.categories.organisation[0].displayName = "Different Fictional Name";
    const other = JSON.parse((await buildCustomerExport(deps(changed))).canonicalBody) as { manifest: { digest: string } };
    expect(other.manifest.digest).not.toBe(parsed.manifest.digest);
  });

  it("uses the Europe/London calendar date in the download name", async () => {
    const dependencies = deps();
    dependencies.now = () => new Date("2026-08-18T23:30:00.000Z");
    await expect(buildCustomerExport(dependencies)).resolves.toMatchObject({
      filename: "workforce-platform-export-2026-08-19.json",
    });
  });
});
