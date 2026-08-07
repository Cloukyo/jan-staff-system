import { describe, expect, it } from "vitest";
import { fingerprintPayrollInput } from "@/lib/payroll/fingerprint";
import { readinessSeverity } from "@/lib/payroll/readiness";
import { buildCommercialPayrollSnapshot } from "@/lib/payroll/tenant-calculations";
import * as tenantCalculations from "@/lib/payroll/tenant-calculations";
import type {
  CommercialEffectiveClockEvent,
  CommercialPayrollSnapshotInput,
} from "@/lib/payroll/tenant-types";

const ORGANISATION_A = "10000000-0000-4000-8000-000000000000";
const ORGANISATION_B = "20000000-0000-4000-8000-000000000000";
const SITE_A1 = "11000000-0000-4000-8000-000000000000";
const SITE_A2 = "12000000-0000-4000-8000-000000000000";
const SITE_B1 = "21000000-0000-4000-8000-000000000000";

type ScopeClassifier = (
  staffId: string,
  period: { periodStart: string; periodEnd: string },
  assignments: Array<{
    staffId: string;
    siteId: string;
    effectiveFrom: string;
    effectiveTo: string | null;
  }>,
  selectedSiteId: string | null,
) => "organisation_only" | "selected_site" | "omitted";

function event(
  id: string,
  staffId: "A1" | "A2" | "B1",
  eventType: "clock_in" | "clock_out",
  eventTimestamp: string,
  options: Partial<CommercialEffectiveClockEvent> = {},
): CommercialEffectiveClockEvent {
  return {
    organisationId: ORGANISATION_A,
    siteId: staffId === "A2" ? SITE_A2 : SITE_A1,
    eventId: id,
    eventOrderKey: `${id}:original`,
    originalEventId: null,
    correctionId: null,
    staffId,
    eventType,
    eventTimestamp,
    recordedDate: eventTimestamp.slice(0, 10),
    source: "kiosk",
    ...options,
  };
}

function inputWith(
  effectiveEvents: CommercialEffectiveClockEvent[],
  overrides: Partial<CommercialPayrollSnapshotInput> = {},
): CommercialPayrollSnapshotInput {
  const attendanceReviews = effectiveEvents.map((item) => ({
    organisationId: item.organisationId,
    staffId: item.staffId,
    operationalDate: item.recordedDate,
    status: "approved" as const,
  }));

  return {
    organisationId: ORGANISATION_A,
    periodStart: "2026-08-03",
    periodEnd: "2026-08-09",
    staff: [
      { organisationId: ORGANISATION_A, id: "A1", fullName: "Fictional A1", employmentRole: "Practitioner", currentSiteId: SITE_A2 },
      { organisationId: ORGANISATION_A, id: "A2", fullName: "Fictional A2", employmentRole: "Room lead", currentSiteId: SITE_A2 },
    ],
    effectiveEvents,
    payArrangements: [
      {
        id: "pay-a1",
        organisationId: ORGANISATION_A,
        staffId: "A1",
        payType: "hourly",
        hourlyRate: 12,
        annualSalary: null,
        monthlySalary: null,
        contractedWeeklyHours: 35,
        hoursBasis: "contracted",
        standardDailyHours: 7,
        overtimeMultiplier: 1.5,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        isActive: true,
        managerNotes: null,
        createdByName: "Fictional manager",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
      {
        id: "pay-a2",
        organisationId: ORGANISATION_A,
        staffId: "A2",
        payType: "salaried",
        hourlyRate: null,
        annualSalary: 36_500,
        monthlySalary: null,
        contractedWeeklyHours: null,
        hoursBasis: "salaried_untracked",
        standardDailyHours: null,
        overtimeMultiplier: 1,
        effectiveFrom: "2026-01-01",
        effectiveTo: null,
        isActive: true,
        managerNotes: null,
        createdByName: "Fictional manager",
        createdAt: "2026-01-01T00:00:00Z",
        updatedAt: "2026-01-01T00:00:00Z",
      },
    ],
    attendanceReviews,
    unresolvedExceptions: [],
    pendingRequests: [],
    staleInput: false,
    ...overrides,
  };
}

describe("commercial payroll input fingerprints", () => {
  it("canonicalises object fields and array order before hashing", () => {
    const first = {
      periodEnd: "2026-08-07",
      events: [
        { staffId: "B1", eventId: "2" },
        { staffId: "A1", eventId: "1" },
      ],
      organisationId: "org-a",
      periodStart: "2026-08-01",
    };
    const reordered = {
      organisationId: "org-a",
      periodStart: "2026-08-01",
      events: [
        { eventId: "1", staffId: "A1" },
        { eventId: "2", staffId: "B1" },
      ],
      periodEnd: "2026-08-07",
    };

    expect(fingerprintPayrollInput(first)).toBe(
      "f43d0bf959b355e794a84e4cad261913593ad3c4b1da67642fc32a756f51e41f",
    );
    expect(fingerprintPayrollInput(reordered)).toBe(fingerprintPayrollInput(first));
  });
});

describe("commercial effective attendance adapter", () => {
  it("classifies the complete zero-attendance assignment matrix from effective intervals", () => {
    const classify = (tenantCalculations as unknown as {
      classifyZeroAttendanceScope?: ScopeClassifier;
    }).classifyZeroAttendanceScope;
    expect(classify).toBeTypeOf("function");
    if (!classify) return;
    const period = { periodStart: "2026-08-03", periodEnd: "2026-08-09" };
    const assignment = (
      siteId: string,
      effectiveFrom: string,
      effectiveTo: string | null,
    ) => ({ staffId: "A1", siteId, effectiveFrom, effectiveTo });

    const cases: Array<[string, ReturnType<ScopeClassifier>, Parameters<ScopeClassifier>[2]]> = [
      ["only selected site", "selected_site", [assignment(SITE_A1, "2026-01-01", null)]],
      ["simultaneous sites", "omitted", [
        assignment(SITE_A1, "2026-01-01", null),
        assignment(SITE_A2, "2026-01-01", null),
      ]],
      ["transfer within period", "omitted", [
        assignment(SITE_A1, "2026-01-01", "2026-08-05"),
        assignment(SITE_A2, "2026-08-06", null),
      ]],
      ["historic assignment", "omitted", [assignment(SITE_A1, "2026-01-01", "2026-08-02")]],
      ["future assignment", "omitted", [assignment(SITE_A1, "2026-08-10", null)]],
      ["current-primary mismatch is ignored", "selected_site", [
        assignment(SITE_A1, "2026-01-01", "2026-08-09"),
        assignment(SITE_A2, "2026-08-10", null),
      ]],
      ["no assignment", "omitted", []],
    ];
    for (const [label, expected, assignments] of cases) {
      expect(classify("A1", period, assignments, SITE_A1), label).toBe(expected);
    }
    expect(classify("A1", period, cases[1][2], null)).toBe("organisation_only");
  });

  it("emits one selected-site zero summary but no summary for actual attendance", () => {
    const assignments = [{
      organisationId: ORGANISATION_A,
      staffId: "A1",
      siteId: SITE_A1,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      isPrimary: false,
    }, {
      organisationId: ORGANISATION_A,
      staffId: "A2",
      siteId: SITE_A1,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      isPrimary: false,
    }];
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      event("a1-in", "A1", "clock_in", "2026-08-03T08:00:00+01:00"),
      event("a1-out", "A1", "clock_out", "2026-08-03T16:00:00+01:00"),
    ], { assignments, selectedSiteId: SITE_A1 } as never));

    expect(snapshot.rows.filter((row) => row.staffId === "A1")).toHaveLength(1);
    expect(snapshot.rows.filter((row) => row.staffId === "A2")).toEqual([
      expect.objectContaining({
        sourceKind: "staff_summary",
        siteId: SITE_A1,
        adjustmentMinutes: 0,
      }),
    ]);
  });

  it("groups A1 and A2 by staff, London operational day and occurrence site", () => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      event("a1-in", "A1", "clock_in", "2026-08-03T08:00:00+01:00"),
      event("a1-out", "A1", "clock_out", "2026-08-03T16:00:00+01:00"),
      event("a2-in", "A2", "clock_in", "2026-08-03T09:00:00+01:00"),
      event("a2-out", "A2", "clock_out", "2026-08-03T15:00:00+01:00"),
    ]));

    expect(snapshot.rows.map((row) => ({
      staffId: row.staffId,
      siteId: row.siteId,
      operationalDate: row.operationalDate,
      payableMinutes: row.payableMinutes,
    }))).toEqual([
      { staffId: "A1", siteId: SITE_A1, operationalDate: "2026-08-03", payableMinutes: 480 },
      { staffId: "A2", siteId: SITE_A2, operationalDate: "2026-08-03", payableMinutes: 360 },
    ]);
  });

  it("uses the authoritative correction once without reconstructing superseded lineage", () => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      event("current-correction", "A1", "clock_in", "2026-08-04T09:00:00+01:00", {
        eventOrderKey: "superseded-original:original",
        originalEventId: "superseded-original",
        correctionId: "current-correction",
        source: "manager_correction",
      }),
      event("a1-out", "A1", "clock_out", "2026-08-04T17:00:00+01:00"),
    ]));

    const attendanceRows = snapshot.rows.filter((row) => row.sourceKind === "attendance");
    expect(attendanceRows).toHaveLength(1);
    expect(attendanceRows[0].payableMinutes).toBe(480);
    expect(snapshot.readiness.issues).toContainEqual(expect.objectContaining({
      code: "manager_correction",
      severity: "informational",
    }));
  });

  it.each([
    {
      name: "a malformed sequence",
      events: [
        event("in-1", "A1", "clock_in", "2026-08-05T08:00:00+01:00"),
        event("in-2", "A1", "clock_in", "2026-08-05T09:00:00+01:00"),
        event("out", "A1", "clock_out", "2026-08-05T17:00:00+01:00"),
      ],
    },
    {
      name: "a cross-day sequence",
      events: [
        event("in", "A1", "clock_in", "2026-08-05T23:30:00+01:00"),
        event("out", "A1", "clock_out", "2026-08-06T00:30:00+01:00"),
      ],
    },
    {
      name: "a cross-site sequence",
      events: [
        event("in", "A1", "clock_in", "2026-08-05T08:00:00+01:00"),
        event("out", "A1", "clock_out", "2026-08-05T17:00:00+01:00", { siteId: SITE_A2 }),
      ],
    },
  ])("invents zero minutes from $name", ({ events }) => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith(events));

    expect(snapshot.rows.reduce((sum, row) => sum + row.payableMinutes, 0)).toBe(0);
    expect(snapshot.readiness.counts.blocker).toBeGreaterThan(0);
  });

  it("rejects a cross-organisation sequence instead of pairing it", () => {
    const crossOrganisationOut = event("b1-out", "B1", "clock_out", "2026-08-05T17:00:00+01:00", {
      organisationId: ORGANISATION_B,
      siteId: SITE_B1,
    });

    expect(() => buildCommercialPayrollSnapshot(inputWith([
      event("a1-in", "A1", "clock_in", "2026-08-05T08:00:00+01:00"),
      crossOrganisationOut,
    ]))).toThrow(/organisation ownership/i);
  });

  it("rejects mixed owned and unowned events", () => {
    const unowned = event("legacy-out", "A1", "clock_out", "2026-08-05T17:00:00+01:00", {
      organisationId: null,
      siteId: null,
    });

    expect(() => buildCommercialPayrollSnapshot(inputWith([
      event("a1-in", "A1", "clock_in", "2026-08-05T08:00:00+01:00"),
      unowned,
    ]))).toThrow(/mixed owned and unowned/i);
  });

  it("rejects a foreign-organisation staff summary even with no attendance", () => {
    const foreignStaff = {
      organisationId: ORGANISATION_B,
      id: "B1",
      fullName: "Fictional B1",
      employmentRole: "Practitioner",
      currentSiteId: SITE_B1,
    };

    expect(() => buildCommercialPayrollSnapshot(inputWith([], {
      staff: [foreignStaff],
    }))).toThrow(/staff organisation ownership/i);
  });

  it("keeps A1's historic occurrence site after a current-site transfer", () => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      event("a1-in", "A1", "clock_in", "2026-08-03T08:00:00+01:00", { siteId: SITE_A1 }),
      event("a1-out", "A1", "clock_out", "2026-08-03T16:00:00+01:00", { siteId: SITE_A1 }),
    ]));

    expect(snapshot.rows[0].siteId).toBe(SITE_A1);
    expect(snapshot.staff.find((item) => item.staffId === "A1")?.currentSiteId).toBe(SITE_A2);
  });

  it("invents zero minutes from interleaved events at two sites", () => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      event("a1-in", "A1", "clock_in", "2026-08-05T08:00:00+01:00", { siteId: SITE_A1 }),
      event("a2-in", "A1", "clock_in", "2026-08-05T09:00:00+01:00", { siteId: SITE_A2 }),
      event("a1-out", "A1", "clock_out", "2026-08-05T17:00:00+01:00", { siteId: SITE_A1 }),
      event("a2-out", "A1", "clock_out", "2026-08-05T18:00:00+01:00", { siteId: SITE_A2 }),
    ]));

    expect(snapshot.rows.reduce((sum, row) => sum + row.payableMinutes, 0)).toBe(0);
    expect(snapshot.readiness.issues).toContainEqual(expect.objectContaining({
      code: "malformed_sequence",
      severity: "blocker",
    }));
  });

  it("invents zero minutes when alternating global pairs cross occurrence sites", () => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      event("first-in", "A1", "clock_in", "2026-08-05T08:00:00+01:00", { siteId: SITE_A1 }),
      event("first-out", "A1", "clock_out", "2026-08-05T09:00:00+01:00", { siteId: SITE_A2 }),
      event("second-in", "A1", "clock_in", "2026-08-05T10:00:00+01:00", { siteId: SITE_A2 }),
      event("second-out", "A1", "clock_out", "2026-08-05T17:00:00+01:00", { siteId: SITE_A1 }),
    ]));

    expect(snapshot.rows.reduce((sum, row) => sum + row.payableMinutes, 0)).toBe(0);
  });
});

describe("commercial payroll arithmetic and readiness", () => {
  it("keeps preview adjustments at zero and summary targets stable across pay-arrangement replacement", () => {
    const base = inputWith([]);
    const first = buildCommercialPayrollSnapshot(base);
    const replacement = {
      ...base.payArrangements[1],
      id: "pay-a2-replacement",
      annualSalary: 37_500,
    };
    const second = buildCommercialPayrollSnapshot(inputWith([], {
      payArrangements: [base.payArrangements[0], replacement],
    }));

    expect(first.rows.every((row) => row.adjustmentMinutes === 0)).toBe(true);
    expect(second.rows.every((row) => row.adjustmentMinutes === 0)).toBe(true);
    expect(first.rows.find((row) => row.staffId === "A2")?.sourceKey)
      .toBe(`staff-summary:${ORGANISATION_A}:A2`);
    expect(second.rows.find((row) => row.staffId === "A2")?.sourceKey)
      .toBe(`staff-summary:${ORGANISATION_A}:A2`);
  });

  it("keeps salaried pay information when attendance minutes are zero", () => {
    const snapshot = buildCommercialPayrollSnapshot(inputWith([]));

    expect(snapshot.rows).toContainEqual(expect.objectContaining({
      staffId: "A2",
      siteId: null,
      sourceKind: "staff_summary",
      sourceKey: `staff-summary:${ORGANISATION_A}:A2`,
      payType: "salaried",
      payableMinutes: 0,
    }));
    expect(snapshot.staff.find((item) => item.staffId === "A2")).toEqual(expect.objectContaining({
      payableMinutes: 0,
      salaryBasis: 700,
      estimatedGrossValue: null,
    }));
    expect(snapshot.readiness.issues).not.toContainEqual(expect.objectContaining({
      staffId: "A2",
      code: "site_attribution",
    }));
  });

  it("blocks a zero-attendance staff member with no applicable pay arrangement", () => {
    const base = inputWith([]);
    const snapshot = buildCommercialPayrollSnapshot(inputWith([], {
      payArrangements: base.payArrangements.filter((arrangement) => arrangement.staffId !== "A1"),
    }));

    expect(snapshot.readiness.issues).toContainEqual(expect.objectContaining({
      code: "missing_pay_arrangement",
      severity: "blocker",
      staffId: "A1",
      siteId: null,
      operationalDate: null,
    }));
    expect(snapshot.readiness.counts.blocker).toBe(1);
  });

  it("retains hourly ordinary and overtime arithmetic and salaried information", () => {
    const hourlyEvents = [3, 4, 5, 6, 7].flatMap((day) => [
      event(`a1-${day}-in`, "A1", "clock_in", `2026-08-0${day}T08:00:00+01:00`),
      event(`a1-${day}-out`, "A1", "clock_out", `2026-08-0${day}T16:00:00+01:00`),
    ]);
    const snapshot = buildCommercialPayrollSnapshot(inputWith([
      ...hourlyEvents,
      event("a2-in", "A2", "clock_in", "2026-08-03T09:00:00+01:00"),
      event("a2-out", "A2", "clock_out", "2026-08-03T15:00:00+01:00"),
    ]));

    expect(snapshot.staff.find((item) => item.staffId === "A1")).toEqual(expect.objectContaining({
      payableMinutes: 2_400,
      ordinaryMinutes: 2_100,
      overtimeMinutes: 300,
      estimatedGrossValue: 510,
    }));
    expect(snapshot.staff.find((item) => item.staffId === "A2")).toEqual(expect.objectContaining({
      payType: "salaried",
      salaryBasis: 700,
      estimatedGrossValue: null,
    }));
  });

  it("uses one legacy-compatible weekly overtime threshold across historic rate changes", () => {
    const base = inputWith([]);
    const older = {
      ...base.payArrangements[0],
      id: "pay-a1-old",
      hourlyRate: 10,
      effectiveTo: "2026-08-05",
    };
    const newer = {
      ...base.payArrangements[0],
      id: "pay-a1-new",
      hourlyRate: 20,
      effectiveFrom: "2026-08-06",
    };
    const events = [3, 4, 5, 6, 7].flatMap((day) => [
      event(`a1-${day}-in`, "A1", "clock_in", `2026-08-0${day}T08:00:00+01:00`),
      event(`a1-${day}-out`, "A1", "clock_out", `2026-08-0${day}T16:00:00+01:00`),
    ]);
    const snapshot = buildCommercialPayrollSnapshot(inputWith(events, {
      payArrangements: [older, newer, base.payArrangements[1]],
    }));

    expect(snapshot.staff.find((item) => item.staffId === "A1")).toEqual(expect.objectContaining({
      ordinaryMinutes: 2_100,
      overtimeMinutes: 300,
      estimatedGrossValue: 610,
    }));
    expect(snapshot.rows.filter((row) => row.staffId === "A1").map((row) => row.hourlyRate))
      .toEqual([10, 10, 10, 20, 20]);
  });

  it("applies overtime within effective pay-type and contracted-hours regimes", () => {
    const base = inputWith([]);
    const hourly = {
      ...base.payArrangements[0],
      id: "pay-a1-hourly",
      hourlyRate: 14,
      effectiveTo: "2026-08-05",
    };
    const salaried = {
      ...base.payArrangements[1],
      id: "pay-a1-salaried",
      staffId: "A1",
      effectiveFrom: "2026-08-06",
    };
    const events = [3, 4, 5, 6].flatMap((day) => [
      event(`a1-${day}-in`, "A1", "clock_in", `2026-08-0${day}T08:00:00+01:00`),
      event(`a1-${day}-out`, "A1", "clock_out", `2026-08-0${day}T16:00:00+01:00`),
    ]);
    const snapshot = buildCommercialPayrollSnapshot(inputWith(events, {
      payArrangements: [hourly, salaried, base.payArrangements[1]],
    }));

    expect(snapshot.staff.find((item) => item.staffId === "A1")).toEqual(expect.objectContaining({
      ordinaryMinutes: 1_380,
      overtimeMinutes: 540,
      estimatedGrossValue: 399,
      salaryBasis: 400,
    }));
  });

  it("calculates effective salary periods independently of attendance", () => {
    const base = inputWith([]);
    const midPeriodSalary = {
      ...base.payArrangements[1],
      effectiveFrom: "2026-08-06",
    };
    const snapshot = buildCommercialPayrollSnapshot(inputWith([], {
      payArrangements: [base.payArrangements[0], midPeriodSalary],
    }));

    expect(snapshot.staff.find((item) => item.staffId === "A2")?.salaryBasis).toBe(400);
  });

  it("does not let out-of-period exceptions or requests block the snapshot", () => {
    const events = [
      event("a1-in", "A1", "clock_in", "2026-08-05T08:00:00+01:00"),
      event("a1-out", "A1", "clock_out", "2026-08-05T16:00:00+01:00"),
    ];
    const snapshot = buildCommercialPayrollSnapshot(inputWith(events, {
      unresolvedExceptions: [{
        organisationId: ORGANISATION_A,
        siteId: SITE_A1,
        id: "future-exception",
        staffId: "A1",
        operationalDate: "2026-08-10",
        status: "open",
      }],
      pendingRequests: [{
        organisationId: ORGANISATION_A,
        siteId: SITE_A1,
        id: "historic-request",
        staffId: "A1",
        operationalDate: "2026-08-02",
        status: "pending",
      }],
    }));

    expect(snapshot.readiness.counts.blocker).toBe(0);
  });

  it("centralises every readiness category and severity", () => {
    expect({
      missingClockIn: readinessSeverity("missing_clock_in"),
      missingClockOut: readinessSeverity("missing_clock_out"),
      malformed: readinessSeverity("malformed_sequence"),
      unresolved: readinessSeverity("unresolved_exception"),
      unreviewed: readinessSeverity("unreviewed_day"),
      pending: readinessSeverity("pending_request"),
      longShift: readinessSeverity("long_shift"),
      site: readinessSeverity("site_attribution"),
      stale: readinessSeverity("stale_input"),
      missingPay: readinessSeverity("missing_pay_arrangement"),
    }).toEqual({
      missingClockIn: "blocker",
      missingClockOut: "blocker",
      malformed: "blocker",
      unresolved: "blocker",
      unreviewed: "warning",
      pending: "blocker",
      longShift: "warning",
      site: "blocker",
      stale: "blocker",
      missingPay: "blocker",
    });
  });
});
