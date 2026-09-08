import ExcelJS from "exceljs";
import { isoDateInLondon } from "@/lib/dates/format";

export type ComplianceEvidenceRow = {
  staffName: string; engagementType: string; role: string; proposedStartDate: string | null;
  dbsRequirement: string; dbsCheckLevel: string; dbsStatus: string; dbsReference: string;
  dbsCertificateReceivedDate: string | null; dbsVerifiedAt: string | null; dbsVerifiedBy: string;
  receiptTiming?: string;
  suitabilityStatus: string; suitabilityDecidedAt: string | null; restrictions: string; outstandingActions: string;
};

export function complianceEvidenceFilename(now = new Date()): string {
  return `staff-checks-evidence-${isoDateInLondon(now)}.xlsx`;
}

export async function buildComplianceEvidenceWorkbook(input: { organisationName: string; generatedAt: Date; rows: ComplianceEvidenceRow[] }): Promise<Uint8Array> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Staff operations platform";
  workbook.created = input.generatedAt;
  const readMe = workbook.addWorksheet("Read me");
  readMe.getCell("A1").value = "Staff checks management evidence summary";
  readMe.getCell("A2").value = "This workbook summarises records held by the organisation. Managers remain responsible for deciding role eligibility and suitability.";
  readMe.getCell("A4").value = "Organisation";
  readMe.getCell("B4").value = input.organisationName;
  readMe.getCell("A5").value = "Generated";
  readMe.getCell("B5").value = input.generatedAt.toISOString();
  readMe.columns = [{ width: 24 }, { width: 100 }];
  readMe.getRow(1).font = { bold: true, size: 16 };

  const sheet = workbook.addWorksheet("Staff checks");
  sheet.columns = [
    { header: "Staff", key: "staffName", width: 28 }, { header: "Engagement", key: "engagementType", width: 16 },
    { header: "Role", key: "role", width: 24 }, { header: "Proposed/start date", key: "proposedStartDate", width: 18 },
    { header: "DBS requirement", key: "dbsRequirement", width: 20 }, { header: "DBS check level", key: "dbsCheckLevel", width: 34 },
    { header: "DBS status", key: "dbsStatus", width: 20 }, { header: "DBS reference", key: "dbsReference", width: 18 },
    { header: "Recorded receipt date", key: "dbsCertificateReceivedDate", width: 20 }, { header: "Verified at", key: "dbsVerifiedAt", width: 24 },
    { header: "Verified by", key: "dbsVerifiedBy", width: 24 }, { header: "Suitability", key: "suitabilityStatus", width: 24 },
    { header: "Suitability decided", key: "suitabilityDecidedAt", width: 24 }, { header: "Restrictions", key: "restrictions", width: 34 },
    { header: "Outstanding actions", key: "outstandingActions", width: 42 },
    { header: "Receipt timing evidence", key: "receiptTiming", width: 55 },
  ];
  sheet.addRows(input.rows);
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = { from: "A1", to: "P1" };
  sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.getRow(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF5B21B6" } };
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
