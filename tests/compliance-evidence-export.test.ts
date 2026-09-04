import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildComplianceEvidenceWorkbook,
  complianceEvidenceFilename,
} from "@/lib/exports/compliance-evidence";

describe("inspection evidence export", () => {
  it("exports factual recruitment evidence without claiming legal certification", async () => {
    const bytes = await buildComplianceEvidenceWorkbook({
      organisationName: "Fictional Nursery Ltd",
      generatedAt: new Date("2026-09-04T10:30:00.000Z"),
      rows: [{
        staffName: "Alex Example",
        engagementType: "Volunteer",
        role: "Reading helper",
        proposedStartDate: "2026-09-10",
        dbsRequirement: "Required",
        dbsCheckLevel: "Enhanced with children's barred list",
        dbsStatus: "Verified",
        dbsReference: "001122334455",
        dbsCertificateReceivedDate: "2026-09-01",
        dbsVerifiedAt: "2026-09-02T09:00:00.000Z",
        dbsVerifiedBy: "Manager Example",
        suitabilityStatus: "Suitable",
        suitabilityDecidedAt: "2026-09-02T09:05:00.000Z",
        restrictions: "None",
        outstandingActions: "None",
      }],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(bytes) as never);
    expect(workbook.getWorksheet("Staff checks")).toBeDefined();
    expect(workbook.getWorksheet("Read me")?.getCell("A1").value).toContain("management evidence summary");
    expect(workbook.getWorksheet("Read me")?.getCell("A1").value).not.toMatch(/certif(?:y|ication)/i);
    expect(workbook.getWorksheet("Staff checks")?.getCell("H2").value).toBe("001122334455");
  });

  it("uses a clear UK calendar-date filename", () => {
    expect(complianceEvidenceFilename(new Date("2026-09-04T23:30:00.000Z")))
      .toBe("staff-checks-evidence-2026-09-05.xlsx");
  });
});
