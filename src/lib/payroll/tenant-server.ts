import { requireAttendanceDateRange } from "@/lib/attendance/date-range";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { requirePermission } from "@/lib/commercial-identity/guards";
import { requireActiveMembership } from "@/lib/commercial-identity/server";
import { resolvePayrollActor, type PayrollActor } from "@/lib/payroll/actor";
import {
  loadJanLegacyPayrollWorkspace,
  requireJanLegacyPayrollManager,
  type JanLegacyPayrollManager,
} from "@/lib/payroll/compatibility";
import { buildCommercialPayrollSnapshot } from "@/lib/payroll/tenant-calculations";
import type {
  CommercialAttendanceException,
  CommercialAttendanceRequest,
  CommercialAttendanceReview,
  CommercialEffectiveClockEvent,
  CommercialPayArrangement,
  CommercialPayrollSnapshot,
  CommercialPayrollStaff,
  CommercialStaffSiteAssignment,
} from "@/lib/payroll/tenant-types";
import type { PayrollRotaShift } from "@/lib/payroll/types";
import type { CommercialMembershipContext } from "@/types/tenancy";
import type {
  CommercialApprovedPayrollExport,
  CommercialApprovedPayrollExportRow,
} from "@/lib/exports/payroll-excel";
import type { CommercialPayrollReportingState } from "@/lib/payroll/reporting";

export type PayrollPeriodRange = {
  periodStart: string;
  periodEnd: string;
};

export function createPayrollOperationId(): string {
  return crypto.randomUUID();
}

export type CommercialPayrollLoadScope = PayrollPeriodRange & {
  organisationId: string;
  siteId: string | null;
};

export interface CommercialPayrollRepository {
  loadStaff(scope: CommercialPayrollLoadScope): Promise<CommercialPayrollStaff[]>;
  loadAssignments?(scope: CommercialPayrollLoadScope): Promise<CommercialStaffSiteAssignment[]>;
  loadPayArrangements(scope: CommercialPayrollLoadScope): Promise<CommercialPayArrangement[]>;
  loadEffectiveEvents(scope: CommercialPayrollLoadScope): Promise<CommercialEffectiveClockEvent[]>;
  loadAttendanceReviews(scope: CommercialPayrollLoadScope): Promise<CommercialAttendanceReview[]>;
  loadAttendanceExceptions(scope: CommercialPayrollLoadScope): Promise<CommercialAttendanceException[]>;
  loadAttendanceRequests(scope: CommercialPayrollLoadScope): Promise<CommercialAttendanceRequest[]>;
  loadRotaShifts(scope: CommercialPayrollLoadScope): Promise<PayrollRotaShift[]>;
}

export type CommercialPayrollWorkspace = {
  snapshot: CommercialPayrollSnapshot;
  rotaShifts: PayrollRotaShift[];
  staff: CommercialPayrollStaff[];
  payArrangements: CommercialPayArrangement[];
};

function ensureSelectedSite(context: CommercialMembershipContext): void {
  if (!context.selectedSiteId) return;
  if (!context.permittedSiteIds.includes(context.selectedSiteId)
    || !context.sitePermissions[context.selectedSiteId]) {
    throw new CommercialIdentityError("site_unavailable");
  }
}

export function validateCommercialPayrollExportSiteScope(
  approvedRunSiteFilterId: string | null,
  requestedSiteId: string | null,
): string | null {
  if (approvedRunSiteFilterId !== requestedSiteId) {
    throw new Error("The approved payroll run site filter does not match the authorised export site.");
  }
  return approvedRunSiteFilterId;
}

export async function loadCommercialPayrollWorkspace(
  context: CommercialMembershipContext,
  range: PayrollPeriodRange,
  repository: CommercialPayrollRepository = commercialPayrollRepository,
): Promise<CommercialPayrollWorkspace> {
  requirePermission(context, "payroll.read");
  ensureSelectedSite(context);
  const validatedRange = requireAttendanceDateRange(range.periodStart, range.periodEnd);
  const scope: CommercialPayrollLoadScope = {
    organisationId: context.organisationId,
    siteId: context.selectedSiteId,
    periodStart: validatedRange.from,
    periodEnd: validatedRange.to,
  };
  const [
    staff,
    assignments,
    payArrangements,
    effectiveEvents,
    attendanceReviews,
    unresolvedExceptions,
    pendingRequests,
    rotaShifts,
  ] = await Promise.all([
    repository.loadStaff(scope),
    repository.loadAssignments?.(scope) ?? Promise.resolve([]),
    repository.loadPayArrangements(scope),
    repository.loadEffectiveEvents(scope),
    repository.loadAttendanceReviews(scope),
    repository.loadAttendanceExceptions(scope),
    repository.loadAttendanceRequests(scope),
    repository.loadRotaShifts(scope),
  ]);
  const scopedStaffIds = new Set(staff.map((person) => person.id));
  const scopedPayArrangements = payArrangements.filter((arrangement) => (
    scopedStaffIds.has(arrangement.staffId)
  ));
  const scopedRotaShifts = rotaShifts.filter((shift) => scopedStaffIds.has(shift.staffId));

  return {
    snapshot: buildCommercialPayrollSnapshot({
      organisationId: scope.organisationId,
      periodStart: scope.periodStart,
      periodEnd: scope.periodEnd,
      staff,
      assignments,
      selectedSiteId: scope.siteId,
      payArrangements: scopedPayArrangements,
      effectiveEvents,
      attendanceReviews,
      unresolvedExceptions,
      pendingRequests,
    }),
    rotaShifts: scopedRotaShifts,
    staff,
    payArrangements: scopedPayArrangements,
  };
}

type PayrollWorkspaceDependencies = {
  resolveActor: () => Promise<PayrollActor<CommercialMembershipContext, JanLegacyPayrollManager>>;
  loadCommercial: (
    context: CommercialMembershipContext,
    range: PayrollPeriodRange,
  ) => Promise<CommercialPayrollWorkspace>;
  loadJanLegacy: (range: PayrollPeriodRange) => ReturnType<typeof loadJanLegacyPayrollWorkspace>;
};

const payrollWorkspaceDependencies: PayrollWorkspaceDependencies = {
  resolveActor: () => resolvePayrollActor({
    loadCommercial: async () => requirePermission(
      await requireActiveMembership({ selectionMode: "sensitive" }),
      "payroll.read",
    ),
    loadJanLegacy: requireJanLegacyPayrollManager,
  }),
  loadCommercial: (context, range) => loadCommercialPayrollWorkspace(context, range),
  loadJanLegacy: ({ periodStart, periodEnd }) => (
    loadJanLegacyPayrollWorkspace(periodStart, periodEnd)
  ),
};

export async function loadPayrollWorkspace(
  range: PayrollPeriodRange,
  dependencies: PayrollWorkspaceDependencies = payrollWorkspaceDependencies,
) {
  const actor = await dependencies.resolveActor();
  if (actor.kind === "commercial") {
    return {
      kind: "commercial" as const,
      context: actor.context,
      workspace: await dependencies.loadCommercial(actor.context, range),
    };
  }
  return {
    kind: "jan_legacy" as const,
    account: actor.account,
    workspace: await dependencies.loadJanLegacy(range),
  };
}

export async function loadCommercialPayrollReportingState(
  context: CommercialMembershipContext,
  range: PayrollPeriodRange,
): Promise<CommercialPayrollReportingState> {
  requirePermission(context, "payroll.read");
  ensureSelectedSite(context);
  const validatedRange = requireAttendanceDateRange(range.periodStart, range.periodEnd);
  const supabase = await createSupabaseServerClient();
  const sitePromise = context.selectedSiteId
    ? supabase.from("organisation_sites").select("name")
      .eq("organisation_id", context.organisationId)
      .eq("id", context.selectedSiteId).maybeSingle()
    : Promise.resolve({ data: null, error: null });
  const [periodResult, siteResult] = await Promise.all([
    supabase.from("payroll_periods").select("id,status,revision")
      .eq("organisation_id", context.organisationId)
      .eq("period_start", validatedRange.from)
      .eq("period_end", validatedRange.to).maybeSingle(),
    sitePromise,
  ]);
  if (periodResult.error || siteResult.error) {
    throw new Error("Commercial payroll reporting state could not be loaded.");
  }
  const selectedSiteDisplayName = siteResult.data?.name ? String(siteResult.data.name) : null;
  if (!periodResult.data) {
    return {
      selectedSiteId: context.selectedSiteId,
      selectedSiteDisplayName,
      period: null,
      run: null,
      approval: null,
      lastExport: null,
      isFresh: true,
      staleCode: null,
      rows: [],
      adjustmentTargets: [],
    };
  }
  const period = periodResult.data;
  const runResult = await supabase.from("payroll_preparation_runs")
    .select("id,status,revision,blocker_count,warning_count,informational_count,site_filter_id,readiness,warning_acknowledgement_operation_id")
    .eq("organisation_id", context.organisationId).eq("period_id", period.id)
    .eq("revision", period.revision).maybeSingle();
  if (runResult.error) throw new Error("Commercial payroll run could not be loaded.");
  const mappedPeriod = {
    id: String(period.id),
    status: period.status as "open" | "closed",
    revision: Number(period.revision),
  };
  if (!runResult.data) {
    return {
      selectedSiteId: context.selectedSiteId,
      selectedSiteDisplayName,
      period: mappedPeriod,
      run: null,
      approval: null,
      lastExport: null,
      isFresh: true,
      staleCode: null,
      rows: [],
      adjustmentTargets: [],
    };
  }
  const run = runResult.data;
  const reportResult = await supabase.rpc("get_commercial_payroll_run_report", {
    target_run_id: String(run.id),
    requested_site_id: context.selectedSiteId,
  });
  const report = reportResult.data as (CommercialPayrollReportingState & {
    ok?: boolean;
    code?: string;
    organisationId?: string;
    periodId?: string;
  }) | null;
  if (reportResult.error || !report?.ok || report.code !== "report_loaded"
    || String(report.organisationId) !== context.organisationId
    || String(report.periodId) !== String(period.id)
    || report.run?.id !== String(run.id)
    || report.run.siteFilterId !== context.selectedSiteId
    || !Array.isArray(report.rows)
    || !Array.isArray(report.adjustments)
    || !Array.isArray(report.adjustmentTargets)) {
    throw new Error("Commercial payroll reporting state could not be loaded.");
  }
  return {
    selectedSiteId: context.selectedSiteId,
    selectedSiteDisplayName,
    period: mappedPeriod,
    run: report.run,
    approval: report.approval,
    lastExport: report.lastExport,
    isFresh: report.isFresh,
    staleCode: report.staleCode,
    rows: report.rows,
    adjustments: report.adjustments,
    adjustmentTargets: report.adjustmentTargets,
  };
}

export async function loadApprovedCommercialPayrollExport(scope: {
  organisationId: string;
  periodId: string;
  approvalId: string;
  expectedRevision: number;
  siteId: string | null;
}): Promise<CommercialApprovedPayrollExport> {
  const supabase = await createSupabaseServerClient();
  const rpcResult = await supabase.rpc("get_commercial_approved_payroll_export", {
    target_approval_id: scope.approvalId,
    expected_revision: scope.expectedRevision,
  });
  const stored = rpcResult.data as Record<string, unknown> | null;
  if (rpcResult.error || !stored || stored.ok !== true
    || stored.code !== "approved_export_loaded"
    || String(stored.organisationId) !== scope.organisationId
    || String(stored.periodId) !== scope.periodId
    || String(stored.approvalId) !== scope.approvalId
    || Number(stored.revision) !== scope.expectedRevision
    || (stored.siteId === null ? null : String(stored.siteId)) !== scope.siteId
    || !Array.isArray(stored.rows)
    || !Array.isArray(stored.adjustmentSnapshots)) {
    throw new Error("The approved payroll revision could not be loaded.");
  }
  return {
    organisationId: scope.organisationId,
    organisationDisplayName: String(stored.organisationDisplayName),
    siteId: scope.siteId,
    siteDisplayName: stored.siteDisplayName ? String(stored.siteDisplayName) : null,
    periodId: scope.periodId,
    periodStart: String(stored.periodStart),
    periodEnd: String(stored.periodEnd),
    runId: String(stored.runId),
    approvalId: scope.approvalId,
    revision: scope.expectedRevision,
    approvalStatus: "approved",
    rowFingerprint: String(stored.rowFingerprint),
    payableMinutesTotal: Number(stored.payableMinutes),
    adjustmentMinutesTotal: Number(stored.adjustmentMinutes),
    readiness: stored.readiness as CommercialApprovedPayrollExport["readiness"],
    rows: stored.rows as CommercialApprovedPayrollExportRow[],
    adjustmentSnapshots: stored.adjustmentSnapshots as CommercialApprovedPayrollExport["adjustmentSnapshots"],
  };
}

export async function loadCommercialPayArrangementHistory(
  context: CommercialMembershipContext,
): Promise<{
  staff: CommercialPayrollStaff[];
  payArrangements: CommercialPayArrangement[];
}> {
  requirePermission(context, "payroll.read");
  ensureSelectedSite(context);
  const supabase = await createSupabaseServerClient();
  const assignmentsPromise = context.selectedSiteId
    ? supabase.from("staff_site_assignments").select("staff_id")
      .eq("organisation_id", context.organisationId)
      .eq("site_id", context.selectedSiteId)
    : Promise.resolve({ data: [], error: null });
  let arrangementsQuery = supabase.from("staff_pay_arrangements")
    .select("id,organisation_id,site_id,staff_id,pay_type,hourly_rate,annual_salary,monthly_salary,contracted_weekly_hours,hours_basis,standard_daily_hours,overtime_multiplier,effective_from,effective_to,is_active,manager_notes,created_at,updated_at")
    .eq("organisation_id", context.organisationId).order("effective_from", { ascending: false });
  if (context.selectedSiteId) {
    arrangementsQuery = arrangementsQuery.or(`site_id.is.null,site_id.eq.${context.selectedSiteId}`);
  }
  const [profilesResult, assignmentsResult, arrangementsResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,organisation_id,full_name,employment_role")
      .eq("organisation_id", context.organisationId).order("full_name"),
    assignmentsPromise,
    arrangementsQuery,
  ]);
  if (profilesResult.error || assignmentsResult.error || arrangementsResult.error) {
    throw new Error("Commercial pay arrangement history could not be loaded.");
  }
  const allowedStaffIds = context.selectedSiteId
    ? new Set((assignmentsResult.data ?? []).map((row) => String(row.staff_id)))
    : null;
  const staff = ((profilesResult.data ?? []) as Record<string, unknown>[])
    .filter((row) => !allowedStaffIds || allowedStaffIds.has(String(row.id)))
    .map((row) => ({
      organisationId: String(row.organisation_id),
      id: String(row.id),
      fullName: String(row.full_name),
      employmentRole: String(row.employment_role),
      currentSiteId: context.selectedSiteId,
    }));
  const staffIds = new Set(staff.map((person) => person.id));
  const payArrangements = ((arrangementsResult.data ?? []) as Record<string, unknown>[])
    .filter((row) => staffIds.has(String(row.staff_id)))
    .map((row) => ({
      organisationId: String(row.organisation_id),
      id: String(row.id),
      staffId: String(row.staff_id),
      payType: String(row.pay_type) as CommercialPayArrangement["payType"],
      hourlyRate: nullableNumber(row.hourly_rate),
      annualSalary: nullableNumber(row.annual_salary),
      monthlySalary: nullableNumber(row.monthly_salary),
      contractedWeeklyHours: nullableNumber(row.contracted_weekly_hours),
      hoursBasis: String(row.hours_basis) as CommercialPayArrangement["hoursBasis"],
      standardDailyHours: nullableNumber(row.standard_daily_hours),
      overtimeMultiplier: Number(row.overtime_multiplier),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      isActive: Boolean(row.is_active),
      managerNotes: row.manager_notes ? String(row.manager_notes) : null,
      createdByName: null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  return { staff, payArrangements };
}

type SupabaseError = { message?: string } | null;

function rowsOrThrow<T>(
  result: { data: unknown; error: SupabaseError },
  message: string,
): T[] {
  if (result.error) throw new Error(message);
  return (result.data ?? []) as T[];
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

export const commercialPayrollRepository: CommercialPayrollRepository = {
  async loadAssignments(scope) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.from("staff_site_assignments")
      .select("organisation_id,staff_id,site_id,effective_from,effective_to,is_primary")
      .eq("organisation_id", scope.organisationId)
      .lte("effective_from", scope.periodEnd)
      .or(`effective_to.is.null,effective_to.gte.${scope.periodStart}`)
      .order("effective_from");
    return rowsOrThrow<Record<string, unknown>>(
      result,
      "Commercial payroll staff site assignments could not be loaded.",
    ).map((row) => ({
      organisationId: String(row.organisation_id),
      staffId: String(row.staff_id),
      siteId: String(row.site_id),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      isPrimary: Boolean(row.is_primary),
    }));
  },

  async loadStaff(scope) {
    const supabase = await createSupabaseServerClient();
    const [profilesResult, assignmentsResult] = await Promise.all([
      supabase.from("staff_profiles")
        .select("id,organisation_id,full_name,employment_role,active")
        .eq("organisation_id", scope.organisationId)
        .eq("active", true)
        .order("full_name"),
      supabase.from("staff_site_assignments")
        .select("staff_id,site_id,effective_from,effective_to,is_primary")
        .eq("organisation_id", scope.organisationId)
        .lte("effective_from", scope.periodEnd)
        .or(`effective_to.is.null,effective_to.gte.${scope.periodStart}`)
        .order("is_primary", { ascending: false }),
    ]);
    const profiles = rowsOrThrow<Record<string, unknown>>(
      profilesResult,
      "Commercial payroll staff could not be loaded.",
    );
    const assignments = rowsOrThrow<Record<string, unknown>>(
      assignmentsResult,
      "Commercial payroll staff site assignments could not be loaded.",
    );
    const assignmentsByStaff = new Map<string, Array<Record<string, unknown>>>();
    for (const assignment of assignments) {
      const staffId = String(assignment.staff_id);
      assignmentsByStaff.set(staffId, [
        ...(assignmentsByStaff.get(staffId) ?? []),
        assignment,
      ]);
    }
    const currentSiteByStaff = new Map<string, string>();
    const selectedSiteStaffIds = new Set<string>();
    for (const [staffId, staffAssignments] of assignmentsByStaff) {
      const overlapping = staffAssignments.filter((assignment) => (
        String(assignment.effective_from) <= scope.periodEnd
        && (!assignment.effective_to
          || String(assignment.effective_to) >= scope.periodStart)
      ));
      if (scope.siteId && overlapping.some((assignment) => (
        String(assignment.site_id) === scope.siteId
      ))) selectedSiteStaffIds.add(staffId);
      const current = overlapping
        .filter((assignment) => !assignment.effective_to
          || String(assignment.effective_to) >= scope.periodEnd)
        .sort((left, right) => {
          if (Boolean(left.is_primary) !== Boolean(right.is_primary)) {
            return left.is_primary ? -1 : 1;
          }
          return String(right.effective_from).localeCompare(String(left.effective_from));
        })[0];
      if (current) currentSiteByStaff.set(staffId, String(current.site_id));
    }
    return profiles
      .filter((profile) => Boolean(profile.active)
        && (!scope.siteId || selectedSiteStaffIds.has(String(profile.id))))
      .map((profile) => ({
        organisationId: String(profile.organisation_id),
        id: String(profile.id),
        fullName: String(profile.full_name),
        employmentRole: String(profile.employment_role),
        currentSiteId: currentSiteByStaff.get(String(profile.id)) ?? null,
      }));
  },

  async loadPayArrangements(scope) {
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("staff_pay_arrangements")
      .select("id,organisation_id,site_id,staff_id,pay_type,hourly_rate,annual_salary,monthly_salary,contracted_weekly_hours,hours_basis,standard_daily_hours,overtime_multiplier,effective_from,effective_to,is_active,manager_notes,created_at,updated_at")
      .eq("organisation_id", scope.organisationId)
      .lte("effective_from", scope.periodEnd)
      .or(`effective_to.is.null,effective_to.gte.${scope.periodStart}`)
      .order("effective_from");
    if (scope.siteId) query = query.or(`site_id.is.null,site_id.eq.${scope.siteId}`);
    const result = await query;
    return rowsOrThrow<Record<string, unknown>>(
      result,
      "Commercial payroll pay arrangements could not be loaded.",
    ).map((row) => ({
      organisationId: String(row.organisation_id),
      id: String(row.id),
      staffId: String(row.staff_id),
      payType: String(row.pay_type) as CommercialPayArrangement["payType"],
      hourlyRate: nullableNumber(row.hourly_rate),
      annualSalary: nullableNumber(row.annual_salary),
      monthlySalary: nullableNumber(row.monthly_salary),
      contractedWeeklyHours: nullableNumber(row.contracted_weekly_hours),
      hoursBasis: String(row.hours_basis) as CommercialPayArrangement["hoursBasis"],
      standardDailyHours: nullableNumber(row.standard_daily_hours),
      overtimeMultiplier: Number(row.overtime_multiplier),
      effectiveFrom: String(row.effective_from),
      effectiveTo: row.effective_to ? String(row.effective_to) : null,
      isActive: Boolean(row.is_active),
      managerNotes: row.manager_notes ? String(row.manager_notes) : null,
      createdByName: null,
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }));
  },

  async loadEffectiveEvents(scope) {
    const supabase = await createSupabaseServerClient();
    let siteIds = scope.siteId ? [scope.siteId] : [];
    if (!scope.siteId) {
      const siteResult = await supabase.from("organisation_sites")
        .select("id")
        .eq("organisation_id", scope.organisationId)
        .eq("active", true)
        .is("archived_at", null)
        .order("id");
      siteIds = rowsOrThrow<{ id: string }>(
        siteResult,
        "Commercial payroll sites could not be loaded.",
      ).map((site) => site.id);
    }
    const results = await Promise.all(siteIds.map((siteId) => supabase.rpc(
      "get_commercial_effective_clock_events",
      {
        target_organisation_id: scope.organisationId,
        target_site_id: siteId,
        range_start: scope.periodStart,
        range_end: scope.periodEnd,
        target_staff_id: null,
      },
    )));
    const rows = results.flatMap((result) => rowsOrThrow<Record<string, unknown>>(
      result,
      "Commercial payroll attendance could not be loaded.",
    ));
    return rows.map((row) => ({
      organisationId: String(row.organisation_id),
      siteId: row.site_id ? String(row.site_id) : null,
      eventId: String(row.event_id),
      eventOrderKey: String(row.event_order_key),
      originalEventId: row.original_event_id ? String(row.original_event_id) : null,
      correctionId: row.correction_id ? String(row.correction_id) : null,
      staffId: String(row.staff_id),
      eventType: String(row.event_type) as CommercialEffectiveClockEvent["eventType"],
      eventTimestamp: String(row.event_timestamp),
      recordedDate: String(row.recorded_date),
      source: String(row.source) as CommercialEffectiveClockEvent["source"],
    }));
  },

  async loadAttendanceReviews(scope) {
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("attendance_day_reviews")
      .select("organisation_id,site_id,staff_id,review_date,status")
      .eq("organisation_id", scope.organisationId)
      .gte("review_date", scope.periodStart)
      .lte("review_date", scope.periodEnd);
    if (scope.siteId) query = query.eq("site_id", scope.siteId);
    const result = await query;
    return rowsOrThrow<Record<string, unknown>>(
      result,
      "Commercial payroll attendance reviews could not be loaded.",
    ).map((row) => ({
      organisationId: String(row.organisation_id),
      staffId: String(row.staff_id),
      operationalDate: String(row.review_date),
      status: String(row.status) as CommercialAttendanceReview["status"],
    }));
  },

  async loadAttendanceExceptions(scope) {
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("attendance_exceptions")
      .select("organisation_id,site_id,id,staff_id,operational_date,status")
      .eq("organisation_id", scope.organisationId)
      .gte("operational_date", scope.periodStart)
      .lte("operational_date", scope.periodEnd)
      .in("status", ["open", "under_review"]);
    if (scope.siteId) query = query.eq("site_id", scope.siteId);
    const result = await query;
    return rowsOrThrow<Record<string, unknown>>(
      result,
      "Commercial payroll attendance exceptions could not be loaded.",
    ).map((row) => ({
      organisationId: String(row.organisation_id),
      siteId: row.site_id ? String(row.site_id) : null,
      id: String(row.id),
      staffId: String(row.staff_id),
      operationalDate: String(row.operational_date),
      status: String(row.status) as CommercialAttendanceException["status"],
    }));
  },

  async loadAttendanceRequests(scope) {
    const supabase = await createSupabaseServerClient();
    let query = supabase.from("attendance_correction_requests")
      .select("organisation_id,site_id,id,staff_id,attendance_date,status")
      .eq("organisation_id", scope.organisationId)
      .gte("attendance_date", scope.periodStart)
      .lte("attendance_date", scope.periodEnd)
      .eq("status", "pending");
    if (scope.siteId) query = query.eq("site_id", scope.siteId);
    const result = await query;
    return rowsOrThrow<Record<string, unknown>>(
      result,
      "Commercial payroll attendance requests could not be loaded.",
    ).map((row) => ({
      organisationId: String(row.organisation_id),
      siteId: row.site_id ? String(row.site_id) : null,
      id: String(row.id),
      staffId: String(row.staff_id),
      operationalDate: String(row.attendance_date),
      status: String(row.status) as CommercialAttendanceRequest["status"],
    }));
  },

  async loadRotaShifts(scope) {
    const supabase = await createSupabaseServerClient();
    const result = await supabase.rpc("get_commercial_planned_shifts", {
      target_organisation_id: scope.organisationId,
      target_site_id: scope.siteId,
      range_start: scope.periodStart,
      range_end: scope.periodEnd,
      target_staff_id: null,
    });
    const rows = rowsOrThrow<Record<string, unknown>>(result, "Production rota data could not be loaded.");
    return rows.map((row) => ({
      id: String(row.shift_id),
      staffId: String(row.staff_id),
      shiftDate: String(row.shift_date),
      startTime: String(row.start_time).slice(0, 5),
      endTime: String(row.end_time).slice(0, 5),
      breakMinutes: Number(row.break_minutes),
      status: "scheduled" as const,
      archivedAt: null,
    }));
  },
};
