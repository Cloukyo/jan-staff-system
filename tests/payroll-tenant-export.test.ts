import ExcelJS from "exceljs";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  COMMERCIAL_PAYROLL_EXPORT_MAX_ROWS,
  createCommercialPayrollWorkbook,
  prepareCommercialPayrollExport,
  type CommercialApprovedPayrollExport,
} from "@/lib/exports/payroll-excel";
import { getCommercialExportIdentity } from "@/lib/exports/identity";
import { createPayrollExportDetail } from "@/lib/exports/payroll-detail";
import {
  summariseCommercialPayrollReporting,
  type CommercialPayrollReportingState,
} from "@/lib/payroll/reporting";
import { validateCommercialPayrollExportSiteScope } from "@/lib/payroll/tenant-server";
import type { CommercialMembershipContext } from "@/types/tenancy";

const ORGANISATION_ID = "10000000-0000-4000-8000-000000000000";
const SITE_ID = "11000000-0000-4000-8000-000000000000";
const PERIOD_ID = "12000000-0000-4000-8000-000000000000";
const RUN_ID = "13000000-0000-4000-8000-000000000000";
const APPROVAL_ID = "14000000-0000-4000-8000-000000000000";

function context(
  permissions: CommercialMembershipContext["permissions"] = [
    "payroll.read",
    "payroll.export",
  ],
): CommercialMembershipContext {
  return {
    membershipId: "15000000-0000-4000-8000-000000000000",
    organisationId: ORGANISATION_ID,
    organisationDisplayName: "Fictional Care Group",
    organisationStatus: "active",
    organisationArchived: false,
    status: "active",
    active: true,
    staffId: "manager-a",
    authorisationRevision: 2,
    roles: [],
    siteAccess: [SITE_ID],
    permissions,
    sitePermissions: { [SITE_ID]: permissions },
    selectedSiteId: SITE_ID,
    permittedSiteIds: [SITE_ID],
  };
}

function approvedExport(
  overrides: Partial<CommercialApprovedPayrollExport> = {},
): CommercialApprovedPayrollExport {
  return {
    organisationId: ORGANISATION_ID,
    organisationDisplayName: "Fictional Care Group",
    siteId: SITE_ID,
    siteDisplayName: "Central Site",
    periodId: PERIOD_ID,
    periodStart: "2026-07-01",
    periodEnd: "2026-07-31",
    runId: RUN_ID,
    approvalId: APPROVAL_ID,
    revision: 4,
    approvalStatus: "approved",
    rowFingerprint: "d".repeat(64),
    payableMinutesTotal: 480,
    adjustmentMinutesTotal: 30,
    adjustmentSnapshots: [{
      adjustmentId: "18000000-0000-4000-8000-000000000001",
      lineageRootId: "18000000-0000-4000-8000-000000000001",
      staffId: "staff-a",
      targetKind: "attendance",
      siteId: SITE_ID,
      operationalDate: "2026-07-02",
      adjustmentMinutes: 30,
      reason: "Confirmed paid handover time",
      createdAt: "2026-07-03T10:00:00Z",
    }],
    readiness: {
      blocker: 0,
      warning: 1,
      informational: 2,
    },
    rows: [{
      organisationId: ORGANISATION_ID,
      runId: RUN_ID,
      staffId: "staff-a",
      fullName: "=2+3",
      employmentRole: "+Practitioner",
      siteId: SITE_ID,
      siteDisplayName: "Central Site",
      operationalDate: "2026-07-02",
      payType: "hourly",
      rawMinutes: 450,
      adjustmentMinutes: 30,
      payableMinutes: 480,
      ordinaryMinutes: 420,
      overtimeMinutes: 60,
      estimatedGrossValue: 120,
      currencyCode: "GBP",
      warnings: ["manager_correction"],
    }],
    ...overrides,
  };
}

describe("commercial payroll export identity and workbook", () => {
  it("uses neutral commercial identity with organisation and optional site labels", () => {
    expect(getCommercialExportIdentity({
      organisationDisplayName: "Fictional Care Group",
      siteDisplayName: "Central Site",
    })).toEqual({
      productName: "Workforce Operations Platform",
      organisationDisplayName: "Fictional Care Group",
      siteDisplayName: "Central Site",
      fileSlug: "fictional-care-group-central-site",
    });
  });

  it("writes revision-labelled reporting totals without branded or formula-active cells", async () => {
    const buffer = await createCommercialPayrollWorkbook(approvedExport());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.creator).toBe("Workforce Operations Platform");
    expect(workbook.subject).toContain("Fictional Care Group");
    expect(workbook.subject).toContain("Central Site");
    const allText = workbook.worksheets.flatMap((sheet) =>
      sheet.getSheetValues().flatMap((row) => Array.isArray(row) ? row : []).map(String),
    ).join(" ");
    expect(allText.toLowerCase()).not.toContain("jan pre-school");
    expect(allText.toLowerCase()).not.toContain("nursery");
    expect(allText).toContain("Revision 4");
    expect(allText).toContain("Organisation total");
    expect(allText).toContain("Site-attributed minutes");
    expect(allText).toContain("Adjustment total");
    expect(allText).toContain("Approved");
    expect(workbook.getWorksheet("Staff totals")?.getCell("A2").value).toBe("'=2+3");
    expect(workbook.getWorksheet("Staff totals")?.getCell("B2").value).toBe("'+Practitioner");
    expect(allText).not.toContain("Hourly rate");
    expect(allText).not.toContain("Annual salary");
  });

  it("exports zero-attendance staff without inventing a site or attendance date", async () => {
    const buffer = await createCommercialPayrollWorkbook(approvedExport({
      siteId: null,
      siteDisplayName: null,
      payableMinutesTotal: 0,
      adjustmentMinutesTotal: 0,
      adjustmentSnapshots: [],
      rows: [{
        ...approvedExport().rows[0],
        sourceKind: "staff_summary",
        staffId: "staff-salary",
        fullName: "Salaried Example",
        siteId: null,
        siteDisplayName: null,
        payType: "salaried",
        rawMinutes: 0,
        adjustmentMinutes: 0,
        payableMinutes: 0,
        ordinaryMinutes: 0,
        overtimeMinutes: 0,
        estimatedGrossValue: null,
      }],
    }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    expect(workbook.getWorksheet("Staff totals")?.getCell("A2").value).toBe("Salaried Example");
    expect(workbook.getWorksheet("Approved detail")?.getCell("C2").value).toBe("No attendance");
    expect(workbook.getWorksheet("Approved detail")?.getCell("D2").value).toBeNull();
    const summaryText = workbook.getWorksheet("Summary")!.getSheetValues().flat().map(String).join(" ");
    expect(summaryText).toContain("Pay category: salaried");
    expect(summaryText).not.toContain("Unattributed");
  });

  it("adds current planned rota hours for a new starter without changing payable totals", async () => {
    const plannedDetail = createPayrollExportDetail({
      staff: [{
        id: "staff-new",
        fullName: "New Starter",
        displayName: "New",
        employmentRole: "Practitioner",
        mainQualificationLevel: null,
        active: true,
        loginStatus: "No login",
        kioskStatus: "Enabled",
        isManager: false,
        payArrangements: [],
      }],
      shifts: [{
        id: "planned-new",
        staffId: "staff-new",
        shiftDate: "2026-07-25",
        startTime: "09:00",
        endTime: "17:00",
        breakMinutes: 30,
        status: "scheduled",
        archivedAt: null,
      }],
      attendance: { effectiveEvents: [], audit: { originalEvents: [], correctionRecords: [] } },
      reviews: [],
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
    });
    const buffer = await createCommercialPayrollWorkbook(approvedExport({
      payableMinutesTotal: 0,
      adjustmentMinutesTotal: 0,
      adjustmentSnapshots: [],
      rows: [],
    }), plannedDetail);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);

    const planned = workbook.getWorksheet("Planned hours");
    expect(planned?.getCell("A2").value).toBe("New Starter");
    expect(planned?.getCell("E2").value).toBe(7.5);
    const summary = workbook.getWorksheet("Summary")!;
    const organisationTotal = summary.getRows(1, summary.rowCount)
      ?.find((row) => row.getCell("A").value === "Organisation total");
    expect(organisationTotal?.getCell("B").value).toBe("0 minutes");
  });

  it("rejects a workbook that exceeds the explicit row limit", async () => {
    const row = approvedExport().rows[0];
    await expect(createCommercialPayrollWorkbook(approvedExport({
      rows: Array.from({ length: COMMERCIAL_PAYROLL_EXPORT_MAX_ROWS + 1 }, (_, index) => ({
        ...row,
        staffId: `staff-${index}`,
      })),
    }))).rejects.toThrow("commercial payroll export row limit");
  });

  it("keeps formula-safe text within Excel's cell character limit", async () => {
    const buffer = await createCommercialPayrollWorkbook(approvedExport({
      rows: [{ ...approvedExport().rows[0], fullName: `=${"x".repeat(32_766)}` }],
    }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const value = String(workbook.getWorksheet("Staff totals")?.getCell("A2").value);
    expect(value.startsWith("'=")).toBe(true);
    expect(value).toHaveLength(32_767);
  });

  it("bounds final composed summary labels and workbook metadata", async () => {
    const longName = `=${"x".repeat(40_000)}`;
    const buffer = await createCommercialPayrollWorkbook(approvedExport({
      organisationDisplayName: longName,
      siteDisplayName: longName,
      rows: [{
        ...approvedExport().rows[0],
        siteDisplayName: longName,
      }],
    }));
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const summary = workbook.getWorksheet("Summary")!;
    summary.eachRow((row) => row.eachCell((cell) => {
      if (typeof cell.value === "string") expect(cell.value.length).toBeLessThanOrEqual(32_767);
    }));
    expect(workbook.subject?.length).toBeLessThanOrEqual(32_767);
    expect(workbook.title?.length).toBeLessThanOrEqual(32_767);
    expect(workbook.company?.length).toBeLessThanOrEqual(32_767);
  });
});

describe("revision-bound commercial payroll export", () => {
  it("requires the requested export site to match the approved run site filter", () => {
    expect(validateCommercialPayrollExportSiteScope(null, null)).toBeNull();
    expect(validateCommercialPayrollExportSiteScope(SITE_ID, SITE_ID)).toBe(SITE_ID);
    expect(() => validateCommercialPayrollExportSiteScope(SITE_ID, null))
      .toThrow("approved payroll run site filter");
    expect(() => validateCommercialPayrollExportSiteScope(null, SITE_ID))
      .toThrow("approved payroll run site filter");
  });

  it("requires payroll export permission inside the audit RPC", () => {
    const migration = readFileSync(resolve(
      "supabase/migrations/20260806224830_payroll_reporting_tenancy.sql",
    ), "utf8");
    const exportFunction = migration.slice(
      migration.indexOf("create or replace function public.record_commercial_payroll_export"),
      migration.indexOf("revoke all on function private.prevent_payroll_record_reparenting"),
    );
    expect(exportFunction).toContain("authorised_payroll_period(target_period_id, 'payroll.export')");
    expect(exportFunction).not.toContain("authorised_payroll_period(target_period_id, 'payroll.prepare')");
  });

  it("denies callers without payroll read and export before loading sensitive rows", async () => {
    const loadApprovedRevision = vi.fn();
    await expect(prepareCommercialPayrollExport({
      context: context(["site.read"]),
      periodId: PERIOD_ID,
      approvalId: APPROVAL_ID,
      expectedRevision: 4,
      requestedSiteId: SITE_ID,
    }, {
      loadApprovedRevision,
      recordExport: vi.fn(),
      createOperationId: () => "16000000-0000-4000-8000-000000000000",
    })).rejects.toMatchObject({ code: "permission_denied" });
    expect(loadApprovedRevision).not.toHaveBeenCalled();
  });

  it("rejects a browser-supplied site outside the server-selected scope", async () => {
    const loadApprovedRevision = vi.fn();
    await expect(prepareCommercialPayrollExport({
      context: context(),
      periodId: PERIOD_ID,
      approvalId: APPROVAL_ID,
      expectedRevision: 4,
      requestedSiteId: "19000000-0000-4000-8000-000000000000",
    }, {
      loadApprovedRevision,
      recordExport: vi.fn(),
      createOperationId: () => "16000000-0000-4000-8000-000000000000",
    })).rejects.toMatchObject({ code: "site_unavailable" });
    expect(loadApprovedRevision).not.toHaveBeenCalled();
  });

  it("exports only the approved exact revision and records its digest receipt", async () => {
    const stored = approvedExport();
    const loadApprovedRevision = vi.fn().mockResolvedValue(stored);
    const recordExport = vi.fn().mockResolvedValue({
      ok: true,
      code: "export_recorded",
      exportAuditId: "17000000-0000-4000-8000-000000000000",
    });

    const result = await prepareCommercialPayrollExport({
      context: context(),
      periodId: PERIOD_ID,
      approvalId: APPROVAL_ID,
      expectedRevision: 4,
      requestedSiteId: SITE_ID,
    }, {
      loadApprovedRevision,
      recordExport,
      createOperationId: () => "16000000-0000-4000-8000-000000000000",
    });

    expect(loadApprovedRevision).toHaveBeenCalledWith({
      organisationId: ORGANISATION_ID,
      periodId: PERIOD_ID,
      approvalId: APPROVAL_ID,
      expectedRevision: 4,
      siteId: SITE_ID,
    });
    expect(result.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(result.fileName).toBe("fictional-care-group-central-site-payroll-2026-07-01-to-2026-07-31-r4.xlsx");
    expect(result.receipt).toMatchObject({ code: "export_recorded" });
    expect(recordExport).toHaveBeenCalledWith({
      periodId: PERIOD_ID,
      approvalId: APPROVAL_ID,
      expectedRevision: 4,
      operationId: "16000000-0000-4000-8000-000000000000",
      format: "xlsx",
      fileName: result.fileName,
      contentSha256: result.digest,
      rowCount: 1,
      rowFingerprint: "d".repeat(64),
      payableMinutes: 480,
      adjustmentMinutes: 30,
    });
  });

  it("denies export before workbook creation when approved row or adjustment totals do not reconcile", async () => {
    const recordExport = vi.fn();
    for (const stored of [
      approvedExport({ payableMinutesTotal: 479 }),
      approvedExport({ adjustmentMinutesTotal: 29 }),
      approvedExport({
        adjustmentSnapshots: [
          approvedExport().adjustmentSnapshots[0],
          approvedExport().adjustmentSnapshots[0],
        ],
      }),
    ]) {
      await expect(prepareCommercialPayrollExport({
        context: context(),
        periodId: PERIOD_ID,
        approvalId: APPROVAL_ID,
        expectedRevision: 4,
        requestedSiteId: SITE_ID,
      }, {
        loadApprovedRevision: async () => stored,
        recordExport,
        createOperationId: () => "16000000-0000-4000-8000-000000000000",
      })).rejects.toThrow("approved payroll evidence");
    }
    expect(recordExport).not.toHaveBeenCalled();
  });

  it("fails closed when a repository returns a different tenant or revision", async () => {
    for (const stored of [
      approvedExport({ organisationId: "20000000-0000-4000-8000-000000000000" }),
      approvedExport({ revision: 3 }),
      approvedExport({ approvalStatus: "reopened" }),
    ]) {
      await expect(prepareCommercialPayrollExport({
        context: context(),
        periodId: PERIOD_ID,
        approvalId: APPROVAL_ID,
        expectedRevision: 4,
        requestedSiteId: SITE_ID,
      }, {
        loadApprovedRevision: async () => stored,
        recordExport: vi.fn(),
        createOperationId: () => "16000000-0000-4000-8000-000000000000",
      })).rejects.toThrow("approved payroll revision");
    }
  });
});

function reportingState(
  overrides: Partial<CommercialPayrollReportingState> = {},
): CommercialPayrollReportingState {
  const base = approvedExport();
  return {
    selectedSiteId: null,
    selectedSiteDisplayName: null,
    period: { id: PERIOD_ID, status: "closed", revision: 4 },
    run: {
      id: RUN_ID,
      status: "approved",
      revision: 4,
      blockerCount: 0,
      warningCount: 1,
      informationalCount: 2,
      siteFilterId: null,
      siteFilterDisplayName: null,
    },
    approval: { id: APPROVAL_ID, status: "approved" },
    lastExport: null,
    isFresh: true,
    staleCode: null,
    adjustmentTargets: [],
    rows: [
      { ...base.rows[0], fullName: "Alex One", payableMinutes: 480 },
      {
        ...base.rows[0],
        staffId: "staff-b",
        fullName: "Blair Two",
        siteId: "12000000-0000-4000-8000-000000000001",
        siteDisplayName: "West Site",
        payType: "salaried",
        rawMinutes: 120,
        adjustmentMinutes: 0,
        payableMinutes: 120,
        ordinaryMinutes: 120,
        overtimeMinutes: 0,
        estimatedGrossValue: null,
      },
    ],
    ...overrides,
  };
}

describe("commercial payroll reporting behaviour", () => {
  it("summarises the stored revision with organisation and site-attributed totals", () => {
    const summary = summariseCommercialPayrollReporting(reportingState());

    expect(summary.sourceLabel).toBe("Stored revision 4");
    expect(summary.totalLabel).toBe("Organisation total");
    expect(summary.totalMinutes).toBe(600);
    expect(summary.adjustmentMinutes).toBe(30);
    expect(summary.staffRows.map((row) => [row.fullName, row.payableMinutes])).toEqual([
      ["Alex One", 480],
      ["Blair Two", 120],
    ]);
    expect(summary.siteTotals).toEqual([
      { siteId: SITE_ID, siteDisplayName: "Central Site", payableMinutes: 480 },
      {
        siteId: "12000000-0000-4000-8000-000000000001",
        siteDisplayName: "West Site",
        payableMinutes: 120,
      },
    ]);
  });

  it("labels selected-site stored rows as attributed site totals, not organisation totals", () => {
    const state = reportingState({
      selectedSiteId: SITE_ID,
      selectedSiteDisplayName: "Central Site",
      rows: [approvedExport().rows[0]],
    });
    const summary = summariseCommercialPayrollReporting(state);

    expect(summary.totalLabel).toBe("Central Site attributed total");
    expect(summary.totalMinutes).toBe(480);
  });
});

describe("commercial payroll reporting UI boundary", () => {
  it("routes payroll pages through actor-aware services and permission-gated controls", () => {
    const payrollPage = readFileSync(resolve("src/app/payroll/page.tsx"), "utf8");
    const reviewPage = readFileSync(resolve("src/app/payroll/review/page.tsx"), "utf8");
    const arrangementsPage = readFileSync(resolve("src/app/payroll/arrangements/page.tsx"), "utf8");
    const reportingScreen = readFileSync(resolve("src/components/payroll/production-payroll-screen.tsx"), "utf8");
    const reviewScreen = readFileSync(resolve("src/components/payroll/payroll-review-screen.tsx"), "utf8");
    const arrangementsScreen = readFileSync(resolve("src/components/payroll/pay-arrangements-screen.tsx"), "utf8");
    const exportRoute = readFileSync(resolve("src/app/payroll/export/route.ts"), "utf8");

    expect(payrollPage).toContain("loadPayrollWorkspace");
    expect(payrollPage).toContain("loadCommercialPayrollReportingState");
    expect(reviewPage).not.toContain('requireAccount(["manager"])');
    expect(arrangementsPage).toContain("loadPayrollWorkspace");
    expect(arrangementsPage).toContain("loadCommercialPayArrangementHistory");
    expect(reportingScreen).toContain("canPrepare");
    expect(reportingScreen).toContain("canExport");
    expect(reviewScreen).toContain("canPrepare");
    expect(arrangementsScreen).toContain("CommercialPayArrangementsScreen");
    expect(exportRoute).toContain("prepareCommercialPayrollExport");
    expect(exportRoute).toContain("loadApprovedCommercialPayrollExport");
    expect(exportRoute).toContain("recordCommercialPayrollExport");
  });
});
