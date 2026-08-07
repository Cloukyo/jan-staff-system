import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommercialPayrollReportingState } from "@/lib/payroll/reporting";
import type { CommercialPayrollSnapshot } from "@/lib/payroll/tenant-types";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));

import { CommercialPayrollReportingScreen } from "@/components/payroll/production-payroll-screen";

const snapshot: CommercialPayrollSnapshot = {
  organisationId: "10000000-0000-4000-8000-000000000000",
  periodStart: "2026-08-01",
  periodEnd: "2026-08-31",
  inputFingerprint: "a".repeat(64),
  attendanceFingerprint: "b".repeat(64),
  payArrangementFingerprint: "c".repeat(64),
  rows: [],
  staff: [],
  readiness: { issues: [], counts: { blocker: 0, warning: 0, informational: 0 } },
};

function reporting(overrides: Partial<CommercialPayrollReportingState> = {}): CommercialPayrollReportingState {
  return {
    selectedSiteId: null,
    selectedSiteDisplayName: null,
    period: { id: "20000000-0000-4000-8000-000000000000", status: "open", revision: 2 },
    run: {
      id: "30000000-0000-4000-8000-000000000000",
      status: "ready",
      revision: 2,
      blockerCount: 0,
      warningCount: 1,
      informationalCount: 0,
      siteFilterId: null,
      siteFilterDisplayName: null,
    },
    approval: null,
    lastExport: null,
    isFresh: true,
    staleCode: null,
    rows: [{
      organisationId: snapshot.organisationId,
      runId: "30000000-0000-4000-8000-000000000000",
      staffId: "staff-a",
      sourceKind: "staff_summary",
      fullName: "Alex Example",
      employmentRole: "Practitioner",
      siteId: null,
      siteDisplayName: null,
      operationalDate: "2026-08-31",
      payType: "salaried",
      rawMinutes: 0,
      adjustmentMinutes: 0,
      payableMinutes: 0,
      ordinaryMinutes: 0,
      overtimeMinutes: 0,
      estimatedGrossValue: null,
      currencyCode: "GBP",
      warnings: ["unreviewed_day"],
    }],
    adjustmentTargets: [{
      key: "organisation-summary:staff-a",
      label: "Alex Example, organisation summary",
      target: {
        kind: "organisation_summary",
        staffId: "staff-a",
        siteId: null,
        operationalDate: null,
      },
    }],
    ...overrides,
  };
}

const operationIds = {
  create: "40000000-0000-4000-8000-000000000001",
  prepare: "40000000-0000-4000-8000-000000000002",
  approve: "40000000-0000-4000-8000-000000000003",
  acknowledge: "40000000-0000-4000-8000-000000000004",
  adjustment: "40000000-0000-4000-8000-000000000005",
  reopen: "40000000-0000-4000-8000-000000000006",
  resolveAdjustment: "40000000-0000-4000-8000-000000000007",
};

function renderScreen(input: {
  state?: CommercialPayrollReportingState;
  canPrepare: boolean;
  canExport: boolean;
}) {
  return renderToStaticMarkup(<CommercialPayrollReportingScreen
    organisationDisplayName="Fictional Nursery Group"
    siteId={input.state?.selectedSiteId ?? null}
    snapshot={snapshot}
    reporting={input.state ?? reporting()}
    canPrepare={input.canPrepare}
    canExport={input.canExport}
    operationIds={operationIds}
  />);
}

describe("commercial payroll behavioural UI boundary", () => {
  it("keeps every mutation and export control out of the read-only view", () => {
    const html = renderScreen({ canPrepare: false, canExport: false });

    expect(html).not.toContain("Acknowledge warnings");
    expect(html).not.toContain("Add signed adjustment");
    expect(html).not.toContain("Approve exact revision");
    expect(html).not.toContain("Export approved revision");
  });

  it("shows warning acknowledgement and signed adjustment workflows to prepare actors", () => {
    const html = renderScreen({ canPrepare: true, canExport: false });

    expect(html).toContain("Acknowledge warnings");
    expect(html).toContain("Acknowledgement note");
    expect(html).toContain("Add signed adjustment");
    expect(html).toContain("Adjustment reason");
    expect(html).not.toContain("Approve exact revision");
    expect(html).not.toContain("Export approved revision");
  });

  it("offers exact-revision approval after the current warnings are acknowledged", () => {
    const html = renderScreen({
      state: reporting({ run: { ...reporting().run!, warningsAcknowledged: true } }),
      canPrepare: true,
      canExport: false,
    });

    expect(html).not.toContain("Acknowledge warnings");
    expect(html).toContain("Approve exact revision");
  });

  it("shows reasoned reopen and export only at their approved lifecycle boundary", () => {
    const approved = reporting({
      period: { id: "20000000-0000-4000-8000-000000000000", status: "closed", revision: 2 },
      run: { ...reporting().run!, status: "approved", warningCount: 0 },
      approval: { id: "50000000-0000-4000-8000-000000000000", status: "approved" },
    });
    const html = renderScreen({ state: approved, canPrepare: true, canExport: true });

    expect(html).toContain("Reopen approved revision");
    expect(html).toContain("Reopen reason");
    expect(html).toContain("Export approved revision");
  });

  it("labels selected-site and organisation-wide actors from the resolved reporting scope", () => {
    const organisationHtml = renderScreen({ canPrepare: false, canExport: false });
    const siteHtml = renderScreen({
      state: reporting({
        selectedSiteId: "11000000-0000-4000-8000-000000000000",
        selectedSiteDisplayName: "Central Site",
        run: { ...reporting().run!, siteFilterId: "11000000-0000-4000-8000-000000000000", siteFilterDisplayName: "Central Site" },
      }),
      canPrepare: false,
      canExport: false,
    });

    expect(organisationHtml).toContain("Stored run scope: all authorised sites");
    expect(siteHtml).toContain("Stored run site: Central Site");
  });

  it("makes a stale open preparation actionable and hides approval, export and adjustment mutation", () => {
    const html = renderScreen({
      state: reporting({
        isFresh: false,
        staleCode: "stale_adjustment_fingerprint",
        run: { ...reporting().run!, warningsAcknowledged: true },
        approval: { id: "50000000-0000-4000-8000-000000000000", status: "approved" },
      }),
      canPrepare: true,
      canExport: true,
    });

    expect(html).toContain("Payroll inputs changed after this revision was saved");
    expect(html).toContain("Recalculate preparation");
    expect(html).not.toContain("Approve exact revision");
    expect(html).not.toContain("Export approved revision");
    expect(html).not.toContain("Add signed adjustment");
  });

  it("submits only explicit stable targets and never presents a stored summary row as a command target", () => {
    const html = renderScreen({ canPrepare: true, canExport: false });

    expect(html).toContain("Alex Example, organisation summary");
    expect(html).toContain('name="targetKind" value="organisation_summary"');
    expect(html).not.toContain('name="targetKind" value="staff_summary"');
  });

  it("renders an explicit selected-site adjustment target for A+B zero-attendance staff", () => {
    const siteId = "11000000-0000-4000-8000-000000000000";
    const html = renderScreen({
      state: reporting({
        selectedSiteId: siteId,
        selectedSiteDisplayName: "Central Site",
        run: {
          ...reporting().run!,
          siteFilterId: siteId,
          siteFilterDisplayName: "Central Site",
        },
        adjustmentTargets: [{
          key: `site-summary:staff-ab:${siteId}`,
          label: "Morgan Multi-site, Central Site, site summary",
          target: {
            kind: "site_summary",
            staffId: "staff-ab",
            siteId,
            operationalDate: null,
          },
        }],
      }),
      canPrepare: true,
      canExport: false,
    });

    expect(html).toContain("Morgan Multi-site, Central Site, site summary");
    expect(html).toContain('name="targetKind" value="site_summary"');
    expect(html).toContain('name="targetStaffId" value="staff-ab"');
    expect(html).toContain(`name="targetSiteId" value="${siteId}"`);
  });

  it("offers replace, void and reverse controls with a unique operation id for every form", () => {
    const state = reporting({
      adjustments: [{
        id: "60000000-0000-4000-8000-000000000000",
        staffId: "staff-a",
        adjustmentMinutes: 15,
        reason: "Confirmed paid handover time",
      }],
    });
    const html = renderScreen({ state, canPrepare: true, canExport: false });
    const operationIdMatches = [...html.matchAll(/data-operation-id="([0-9a-f-]{36})"/g)]
      .map((match) => match[1]);

    expect(html).toContain("Replace adjustment");
    expect(html).toContain("Void adjustment");
    expect(html).toContain("Reverse adjustment");
    expect(html).not.toContain("Carry into next revision");
    expect(operationIdMatches.length).toBeGreaterThan(4);
    expect(new Set(operationIdMatches).size).toBe(operationIdMatches.length);
  });
});
