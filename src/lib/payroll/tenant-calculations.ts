import { pairAttendanceByOperationalDay } from "@/lib/attendance/pairing";
import { attendanceOperationalDate } from "@/lib/attendance/state-machine";
import type { AttendanceExceptionType } from "@/lib/attendance/types";
import {
  arrangementAt,
  arrangementsForPeriod,
  calculatePayrollPreparationArithmetic,
} from "@/lib/payroll/calculations";
import { fingerprintPayrollInput } from "@/lib/payroll/fingerprint";
import { countReadinessIssues, readinessSeverity } from "@/lib/payroll/readiness";
import type {
  CommercialEffectiveClockEvent,
  CommercialPayArrangement,
  CommercialPayrollPreparationRow,
  CommercialPayrollSnapshot,
  CommercialPayrollSnapshotInput,
  CommercialPayrollStaffSummary,
  CommercialStaffSiteAssignment,
  PayrollReadinessCode,
  PayrollReadinessIssue,
} from "@/lib/payroll/tenant-types";

type AttendancePartition = {
  organisationId: string;
  siteId: string | null;
  staffId: string;
  operationalDate: string;
  recordedDateMatches: boolean;
  malformedAcrossSites: boolean;
  events: CommercialEffectiveClockEvent[];
};

function assertCommercialOwnership(input: CommercialPayrollSnapshotInput): void {
  const eventOwnership = new Set(input.effectiveEvents.map((event) => event.organisationId === null ? "unowned" : "owned"));
  if (eventOwnership.has("owned") && eventOwnership.has("unowned")) {
    throw new Error("Commercial payroll input contains mixed owned and unowned attendance events.");
  }

  const ownedRows = [
    ...input.staff.map((staff) => ({ organisationId: staff.organisationId, kind: "staff" })),
    ...input.effectiveEvents.map((event) => ({ organisationId: event.organisationId, kind: "attendance event" })),
    ...input.payArrangements.map((arrangement) => ({ organisationId: arrangement.organisationId, kind: "pay arrangement" })),
    ...(input.attendanceReviews ?? []).map((review) => ({ organisationId: review.organisationId, kind: "attendance review" })),
    ...(input.unresolvedExceptions ?? []).map((issue) => ({ organisationId: issue.organisationId, kind: "attendance exception" })),
    ...(input.pendingRequests ?? []).map((request) => ({ organisationId: request.organisationId, kind: "attendance request" })),
  ];
  const invalid = ownedRows.find((row) => row.organisationId !== input.organisationId);
  if (invalid) {
    throw new Error(`Commercial payroll ${invalid.kind} organisation ownership does not match the snapshot.`);
  }
}

function staffDayKey(event: CommercialEffectiveClockEvent): string {
  return JSON.stringify([
    event.organisationId,
    event.staffId,
    attendanceOperationalDate(event.eventTimestamp),
  ]);
}

function toAttendanceEvent(event: CommercialEffectiveClockEvent) {
  return {
    organisationId: event.organisationId ?? undefined,
    siteId: event.siteId ?? undefined,
    eventId: event.eventId,
    eventOrderKey: event.eventOrderKey,
    originalEventId: event.originalEventId,
    correctionId: event.correctionId,
    staffId: event.staffId,
    eventType: event.eventType,
    eventTimestamp: event.eventTimestamp,
    source: event.source,
  };
}

function malformedStaffDays(events: CommercialEffectiveClockEvent[]): Set<string> {
  const days = new Map<string, CommercialEffectiveClockEvent[]>();
  for (const event of events) {
    const key = staffDayKey(event);
    const day = days.get(key) ?? [];
    day.push(event);
    days.set(key, day);
  }

  return new Set([...days.entries()]
    .filter(([, day]) => {
      const pairing = pairAttendanceByOperationalDay(day.map(toAttendanceEvent))[0];
      const siteByEventId = new Map(day.map((event) => [event.eventId, event.siteId]));
      const malformedSequence = pairing?.anomalies.some(
        (anomaly) => anomaly === "consecutive_clock_in" || anomaly === "overlapping_attendance",
      );
      const crossSitePair = pairing?.pairs.some(
        (pair) => siteByEventId.get(pair.clockInId) !== siteByEventId.get(pair.clockOutId),
      );
      return malformedSequence || crossSitePair;
    })
    .map(([key]) => key));
}

function partitionEvents(events: CommercialEffectiveClockEvent[]): AttendancePartition[] {
  const partitions = new Map<string, AttendancePartition>();
  const malformedDays = malformedStaffDays(events);

  for (const event of events) {
    const organisationId = event.organisationId as string;
    const operationalDate = attendanceOperationalDate(event.eventTimestamp);
    const key = JSON.stringify([organisationId, event.staffId, operationalDate, event.siteId]);
    const partition = partitions.get(key) ?? {
      organisationId,
      siteId: event.siteId,
      staffId: event.staffId,
      operationalDate,
      recordedDateMatches: true,
      malformedAcrossSites: malformedDays.has(staffDayKey(event)),
      events: [],
    };
    partition.recordedDateMatches = partition.recordedDateMatches && event.recordedDate === operationalDate;
    partition.events.push(event);
    partitions.set(key, partition);
  }

  return [...partitions.values()].sort((left, right) => (
    left.staffId.localeCompare(right.staffId)
    || left.operationalDate.localeCompare(right.operationalDate)
    || (left.siteId ?? "").localeCompare(right.siteId ?? "")
  ));
}

function anomalyCode(anomaly: AttendanceExceptionType): PayrollReadinessCode {
  switch (anomaly) {
    case "unmatched_clock_out":
    case "missing_clock_in":
      return "missing_clock_in";
    case "missing_clock_out":
      return "missing_clock_out";
    case "unusually_long_shift":
      return "long_shift";
    case "consecutive_clock_in":
    case "overlapping_attendance":
    case "offline_sync_conflict":
    case "device_clock_drift":
    case "offline_time_uncertain":
      return "malformed_sequence";
  }
}

function makeIssue(
  input: CommercialPayrollSnapshotInput,
  code: PayrollReadinessCode,
  details: {
    staffId?: string | null;
    siteId?: string | null;
    operationalDate?: string | null;
    sourceId?: string | null;
  } = {},
): PayrollReadinessIssue {
  return {
    code,
    severity: readinessSeverity(code),
    organisationId: input.organisationId,
    staffId: details.staffId ?? null,
    siteId: details.siteId ?? null,
    operationalDate: details.operationalDate ?? null,
    sourceId: details.sourceId ?? null,
  };
}

function uniqueIssues(issues: PayrollReadinessIssue[]): PayrollReadinessIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = JSON.stringify(issue);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

type ArithmeticRegime = {
  arrangementIds: string[];
  arrangement: CommercialPayArrangement;
  periodStart: string;
  periodEnd: string;
};

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + 1);
  return value.toISOString().slice(0, 10);
}

function arithmeticSignature(arrangement: CommercialPayArrangement): string {
  return JSON.stringify([
    arrangement.payType,
    arrangement.contractedWeeklyHours,
    arrangement.hoursBasis,
  ]);
}

function arithmeticRegimes(
  arrangements: CommercialPayArrangement[],
  periodStart: string,
  periodEnd: string,
): ArithmeticRegime[] {
  const regimes: ArithmeticRegime[] = [];
  const periodArrangements = arrangementsForPeriod(
    arrangements,
    periodStart,
    periodEnd,
  ) as CommercialPayArrangement[];
  for (const arrangement of periodArrangements) {
    const arrangementStart = arrangement.effectiveFrom > periodStart
      ? arrangement.effectiveFrom
      : periodStart;
    const arrangementEnd = arrangement.effectiveTo && arrangement.effectiveTo < periodEnd
      ? arrangement.effectiveTo
      : periodEnd;
    const previous = regimes.at(-1);
    if (previous
      && arithmeticSignature(previous.arrangement) === arithmeticSignature(arrangement)
      && nextDate(previous.periodEnd) === arrangementStart) {
      previous.arrangementIds.push(arrangement.id);
      previous.arrangement = arrangement;
      previous.periodEnd = arrangementEnd;
      continue;
    }
    regimes.push({
      arrangementIds: [arrangement.id],
      arrangement,
      periodStart: arrangementStart,
      periodEnd: arrangementEnd,
    });
  }
  return regimes;
}

function allocateRegimeArithmetic(
  rows: CommercialPayrollPreparationRow[],
  regimeArrangement: CommercialPayArrangement | null,
  arrangements: CommercialPayArrangement[],
  periodStart: string,
  periodEnd: string,
): number | null {
  const payableMinutes = rows.reduce((sum, row) => sum + row.payableMinutes, 0);
  const arithmetic = calculatePayrollPreparationArithmetic(
    regimeArrangement,
    payableMinutes,
    periodStart,
    periodEnd,
  );
  let remainingOrdinary = arithmetic.ordinaryMinutes;
  let remainingOvertime = arithmetic.overtimeMinutes;

  rows.forEach((row) => {
    row.ordinaryMinutes = Math.min(row.payableMinutes, remainingOrdinary);
    remainingOrdinary -= row.ordinaryMinutes;
    row.overtimeMinutes = Math.min(row.payableMinutes - row.ordinaryMinutes, remainingOvertime);
    remainingOvertime -= row.overtimeMinutes;
    row.salaryBasis = null;
  });

  let estimatedGrossValue = 0;
  let hasEstimatedGross = false;
  const arrangementGroups = new Map<string, CommercialPayrollPreparationRow[]>();
  for (const row of rows) {
    const key = row.payArrangementId ?? "missing";
    const group = arrangementGroups.get(key) ?? [];
    group.push(row);
    arrangementGroups.set(key, group);
  }
  for (const [arrangementId, group] of arrangementGroups) {
    const arrangement = arrangements.find((item) => item.id === arrangementId) ?? null;
    if (arrangement?.payType !== "hourly" || arrangement.hourlyRate === null) {
      group.forEach((row) => { row.estimatedGrossValue = null; });
      continue;
    }
    const groupGross = roundCurrency(group.reduce((total, row) => total
      + (row.ordinaryMinutes / 60) * arrangement.hourlyRate!
      + (row.overtimeMinutes / 60) * arrangement.hourlyRate! * arrangement.overtimeMultiplier, 0));
    let allocatedGross = 0;
    group.forEach((row, index) => {
      row.estimatedGrossValue = index === group.length - 1
        ? roundCurrency(groupGross - allocatedGross)
        : roundCurrency(
          (row.ordinaryMinutes / 60) * arrangement.hourlyRate!
          + (row.overtimeMinutes / 60) * arrangement.hourlyRate! * arrangement.overtimeMultiplier,
        );
      allocatedGross = roundCurrency(allocatedGross + row.estimatedGrossValue);
    });
    estimatedGrossValue = roundCurrency(estimatedGrossValue + groupGross);
    hasEstimatedGross = true;
  }
  return hasEstimatedGross ? estimatedGrossValue : null;
}

function effectiveSalaryBasis(
  arrangements: CommercialPayArrangement[],
  periodStart: string,
  periodEnd: string,
): number | null {
  const salaryArrangements = arrangementsForPeriod(arrangements, periodStart, periodEnd)
    .filter((arrangement) => arrangement.payType === "salaried");
  if (salaryArrangements.length === 0) return null;

  return salaryArrangements.reduce((total, arrangement) => {
    const segmentStart = arrangement.effectiveFrom > periodStart ? arrangement.effectiveFrom : periodStart;
    const segmentEnd = arrangement.effectiveTo && arrangement.effectiveTo < periodEnd
      ? arrangement.effectiveTo
      : periodEnd;
    const arithmetic = calculatePayrollPreparationArithmetic(arrangement, 0, segmentStart, segmentEnd);
    return roundCurrency(total + (arithmetic.salaryBasis ?? 0));
  }, 0);
}

function buildStaffSummaries(
  input: CommercialPayrollSnapshotInput,
  rows: CommercialPayrollPreparationRow[],
): CommercialPayrollStaffSummary[] {
  return input.staff
    .map((staff) => {
      const staffRows = rows.filter((row) => row.staffId === staff.id);
      const staffArrangements = input.payArrangements.filter((item) => item.staffId === staff.id);
      const currentArrangement = arrangementAt(
        staffArrangements,
        input.periodEnd,
      ) as CommercialPayArrangement | null;
      const salaryBasis = effectiveSalaryBasis(staffArrangements, input.periodStart, input.periodEnd);
      if (staffRows.length === 0) {
        const arithmetic = calculatePayrollPreparationArithmetic(
          currentArrangement,
          0,
          input.periodStart,
          input.periodEnd,
        );
        return {
          staffId: staff.id,
          fullName: staff.fullName,
          employmentRole: staff.employmentRole,
          currentSiteId: staff.currentSiteId,
          payType: currentArrangement?.payType ?? null,
          payableMinutes: 0,
          ordinaryMinutes: arithmetic.ordinaryMinutes,
          overtimeMinutes: arithmetic.overtimeMinutes,
          estimatedGrossValue: arithmetic.estimatedGross,
          salaryBasis,
        };
      }
      const regimes = arithmeticRegimes(staffArrangements, input.periodStart, input.periodEnd);
      const regimeByArrangementId = new Map(regimes.flatMap((regime, index) => (
        regime.arrangementIds.map((arrangementId) => [arrangementId, index] as const)
      )));
      const rowsByRegime = new Map<number | "missing", CommercialPayrollPreparationRow[]>();
      for (const row of staffRows) {
        const regimeIndex = row.payArrangementId === null
          ? "missing"
          : regimeByArrangementId.get(row.payArrangementId) ?? "missing";
        const group = rowsByRegime.get(regimeIndex) ?? [];
        group.push(row);
        rowsByRegime.set(regimeIndex, group);
      }
      let estimatedGrossValue = 0;
      let hasEstimatedGross = false;
      for (const [regimeIndex, regimeRows] of rowsByRegime) {
        const regime = regimeIndex === "missing" ? null : regimes[regimeIndex];
        const regimeGross = allocateRegimeArithmetic(
          regimeRows,
          regime?.arrangement ?? null,
          staffArrangements,
          regime?.periodStart ?? input.periodStart,
          regime?.periodEnd ?? input.periodEnd,
        );
        if (regimeGross !== null) {
          estimatedGrossValue = roundCurrency(estimatedGrossValue + regimeGross);
          hasEstimatedGross = true;
        }
      }

      return {
        staffId: staff.id,
        fullName: staff.fullName,
        employmentRole: staff.employmentRole,
        currentSiteId: staff.currentSiteId,
        payType: currentArrangement?.payType ?? null,
        payableMinutes: staffRows.reduce((sum, row) => sum + row.payableMinutes, 0),
        ordinaryMinutes: staffRows.reduce((sum, row) => sum + row.ordinaryMinutes, 0),
        overtimeMinutes: staffRows.reduce((sum, row) => sum + row.overtimeMinutes, 0),
        estimatedGrossValue: hasEstimatedGross ? estimatedGrossValue : null,
        salaryBasis,
      };
    })
    .sort((left, right) => left.staffId.localeCompare(right.staffId));
}

export function classifyZeroAttendanceScope(
  staffId: string,
  period: { periodStart: string; periodEnd: string },
  assignments: Array<Pick<
    CommercialStaffSiteAssignment,
    "staffId" | "siteId" | "effectiveFrom" | "effectiveTo"
  >>,
  selectedSiteId: string | null,
): "organisation_only" | "selected_site" | "omitted" {
  if (selectedSiteId === null) return "organisation_only";
  const overlappingSiteIds = new Set(assignments
    .filter((assignment) => assignment.staffId === staffId
      && assignment.effectiveFrom <= period.periodEnd
      && (assignment.effectiveTo === null || assignment.effectiveTo >= period.periodStart))
    .map((assignment) => assignment.siteId));
  return overlappingSiteIds.size === 1 && overlappingSiteIds.has(selectedSiteId)
    ? "selected_site"
    : "omitted";
}

export function buildCommercialPayrollSnapshot(
  input: CommercialPayrollSnapshotInput,
): CommercialPayrollSnapshot {
  if (input.periodEnd < input.periodStart) {
    throw new RangeError("Commercial payroll period end must not be before its start.");
  }
  assertCommercialOwnership(input);

  const issues: PayrollReadinessIssue[] = [];
  const rows = partitionEvents(input.effectiveEvents)
    .filter((partition) => partition.operationalDate >= input.periodStart && partition.operationalDate <= input.periodEnd)
    .map<CommercialPayrollPreparationRow>((partition) => {
      const pairing = partition.recordedDateMatches
        && partition.siteId !== null
        && !partition.malformedAcrossSites
        ? pairAttendanceByOperationalDay(partition.events.map(toAttendanceEvent))[0]
        : null;

      if (!partition.recordedDateMatches || partition.malformedAcrossSites) {
        issues.push(makeIssue(input, "malformed_sequence", partition));
      }
      if (partition.siteId === null) {
        issues.push(makeIssue(input, "site_attribution", partition));
      }
      for (const anomaly of pairing?.anomalies ?? []) {
        issues.push(makeIssue(input, anomalyCode(anomaly), partition));
      }
      for (const correction of partition.events.filter((event) => event.correctionId !== null)) {
        issues.push(makeIssue(input, "manager_correction", {
          ...partition,
          sourceId: correction.correctionId,
        }));
      }

      const arrangements = input.payArrangements.filter((item) => item.staffId === partition.staffId);
      const arrangement = arrangementAt(arrangements, partition.operationalDate) as CommercialPayArrangement | null;
      if (!arrangement) {
        issues.push(makeIssue(input, "missing_pay_arrangement", partition));
      }

      return {
        organisationId: partition.organisationId,
        staffId: partition.staffId,
        sourceKind: "attendance",
        siteId: partition.siteId,
        payArrangementId: arrangement?.id ?? null,
        operationalDate: partition.operationalDate,
        sourceKey: `${partition.organisationId}:${partition.staffId}:${partition.operationalDate}:${partition.siteId ?? "unattributed"}`,
        payType: arrangement?.payType ?? null,
        rawMinutes: pairing?.completedMinutes ?? 0,
        adjustmentMinutes: 0,
        payableMinutes: pairing?.completedMinutes ?? 0,
        ordinaryMinutes: 0,
        overtimeMinutes: 0,
        hourlyRate: arrangement?.hourlyRate ?? null,
        annualSalary: arrangement?.annualSalary ?? null,
        monthlySalary: arrangement?.monthlySalary ?? null,
        overtimeMultiplier: arrangement?.overtimeMultiplier ?? null,
        estimatedGrossValue: null,
        salaryBasis: null,
        currencyCode: "GBP",
        warnings: [],
      };
    });

  for (const staffMember of input.staff) {
    if (rows.some((row) => row.staffId === staffMember.id)) continue;
    const zeroScope = classifyZeroAttendanceScope(
      staffMember.id,
      { periodStart: input.periodStart, periodEnd: input.periodEnd },
      input.assignments ?? [],
      input.selectedSiteId ?? null,
    );
    if (zeroScope === "omitted") continue;
    const applicableArrangements = arrangementsForPeriod(
      input.payArrangements.filter((arrangement) => arrangement.staffId === staffMember.id),
      input.periodStart,
      input.periodEnd,
    ) as CommercialPayArrangement[];
    const arrangement = applicableArrangements
      .sort((left, right) => right.effectiveFrom.localeCompare(left.effectiveFrom))[0] ?? null;
    {
      const operationalDate = arrangement && arrangement.effectiveFrom > input.periodStart
        ? arrangement.effectiveFrom
        : input.periodStart;
      const summarySiteId = zeroScope === "selected_site"
        ? input.selectedSiteId ?? null
        : null;
      rows.push({
        organisationId: input.organisationId,
        staffId: staffMember.id,
        sourceKind: "staff_summary",
        siteId: summarySiteId,
        payArrangementId: arrangement?.id ?? null,
        operationalDate,
        sourceKey: `staff-summary:${input.organisationId}:${staffMember.id}`
          + (summarySiteId ? `:site:${summarySiteId}` : ""),
        payType: arrangement?.payType ?? null,
        rawMinutes: 0,
        adjustmentMinutes: 0,
        payableMinutes: 0,
        ordinaryMinutes: 0,
        overtimeMinutes: 0,
        hourlyRate: arrangement?.hourlyRate ?? null,
        annualSalary: arrangement?.annualSalary ?? null,
        monthlySalary: arrangement?.monthlySalary ?? null,
        overtimeMultiplier: arrangement?.overtimeMultiplier ?? null,
        estimatedGrossValue: null,
        salaryBasis: null,
        currencyCode: "GBP",
        warnings: [],
      });
    }
  }
  rows.sort((left, right) => (
    left.staffId.localeCompare(right.staffId)
    || left.operationalDate.localeCompare(right.operationalDate)
    || left.sourceKey.localeCompare(right.sourceKey)
  ));

  for (const row of rows) {
    if (row.sourceKind === "staff_summary") continue;
    const reviewed = (input.attendanceReviews ?? []).some((review) => (
      review.staffId === row.staffId && review.operationalDate === row.operationalDate
    ));
    if (!reviewed) {
      issues.push(makeIssue(input, "unreviewed_day", row));
    }
  }
  for (const exception of input.unresolvedExceptions ?? []) {
    if ((exception.status === "open" || exception.status === "under_review")
      && exception.operationalDate >= input.periodStart
      && exception.operationalDate <= input.periodEnd) {
      issues.push(makeIssue(input, "unresolved_exception", {
        staffId: exception.staffId,
        siteId: exception.siteId,
        operationalDate: exception.operationalDate,
        sourceId: exception.id,
      }));
    }
  }
  for (const request of input.pendingRequests ?? []) {
    if (request.status === "pending"
      && request.operationalDate >= input.periodStart
      && request.operationalDate <= input.periodEnd) {
      issues.push(makeIssue(input, "pending_request", {
        staffId: request.staffId,
        siteId: request.siteId,
        operationalDate: request.operationalDate,
        sourceId: request.id,
      }));
    }
  }
  if (input.staleInput) {
    issues.push(makeIssue(input, "stale_input"));
  }
  for (const staffMember of input.staff) {
    const applicableArrangement = arrangementAt(
      input.payArrangements.filter((arrangement) => arrangement.staffId === staffMember.id),
      input.periodEnd,
    );
    if (!applicableArrangement) {
      issues.push(makeIssue(input, "missing_pay_arrangement", {
        staffId: staffMember.id,
      }));
    }
  }

  const staff = buildStaffSummaries(input, rows);
  const readinessIssues = uniqueIssues(issues);
  for (const row of rows) {
    row.warnings = readinessIssues
      .filter((issue) => issue.staffId === row.staffId
        && (row.sourceKind === "staff_summary" || issue.operationalDate === row.operationalDate)
        && (issue.siteId === null || issue.siteId === row.siteId))
      .map((issue) => issue.code)
      .filter((code, index, codes) => codes.indexOf(code) === index);
  }

  return {
    organisationId: input.organisationId,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    inputFingerprint: fingerprintPayrollInput(input),
    attendanceFingerprint: fingerprintPayrollInput(input.effectiveEvents),
    payArrangementFingerprint: fingerprintPayrollInput(input.payArrangements),
    rows,
    staff,
    readiness: {
      issues: readinessIssues,
      counts: countReadinessIssues(readinessIssues),
    },
  };
}
