"use server";

import { revalidatePath } from "next/cache";
import { requireAttendanceDateRange } from "@/lib/attendance/date-range";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { resolveMembershipContext } from "@/lib/commercial-identity/context";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { requireAal2, requirePermission } from "@/lib/commercial-identity/guards";
import { readCommercialPreference } from "@/lib/commercial-identity/session";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import type { CommercialPayrollSnapshot } from "@/lib/payroll/tenant-types";
import type {
  CommercialIdentitySnapshot,
  CommercialMembershipContext,
  OrganisationPermission,
} from "@/types/tenancy";

export type CommercialPayrollCommandResult = {
  ok: boolean;
  code: string;
  [key: string]: unknown;
};

export type CommercialPayrollActionState = {
  ok: boolean;
  code: string;
  message: string;
};

export type CommercialPayrollAdjustmentTarget =
  | { kind: "attendance"; staffId: string; siteId: string; operationalDate: string }
  | { kind: "organisation_summary"; staffId: string }
  | { kind: "site_summary"; staffId: string; siteId: string };

export type CommercialPayrollCommandScope = {
  organisationId: string;
  membershipId: string;
  siteId: string | null;
};

function validateSelectedSite(context: CommercialMembershipContext): void {
  if (!context.selectedSiteId) return;
  if (!context.permittedSiteIds.includes(context.selectedSiteId)
    || !context.sitePermissions[context.selectedSiteId]) {
    throw new CommercialIdentityError("site_unavailable");
  }
}

export async function executeCommercialPayrollMutation<Result>(input: {
  identity: CommercialIdentitySnapshot;
  context: CommercialMembershipContext;
  permission: OrganisationPermission;
  command: (scope: CommercialPayrollCommandScope) => Promise<Result>;
}): Promise<Result> {
  requireAal2(input.identity);
  requirePermission(input.context, input.permission);
  validateSelectedSite(input.context);
  return input.command({
    organisationId: input.context.organisationId,
    membershipId: input.context.membershipId,
    siteId: input.context.selectedSiteId,
  });
}

type PayrollRpc = (
  name: string,
  parameters: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message?: string } | null }>;

type CommercialPayrollMutationDependencies = {
  loadAuthorisation: () => Promise<{
    identity: CommercialIdentitySnapshot;
    context: CommercialMembershipContext;
  }>;
  rpc: PayrollRpc;
  revalidate: () => void;
};

async function defaultRpc(
  name: string,
  parameters: Record<string, unknown>,
): Promise<{ data: unknown; error: { message?: string } | null }> {
  const supabase = await createSupabaseServerClient();
  return supabase.rpc(name, parameters);
}

const commercialPayrollMutationDependencies: CommercialPayrollMutationDependencies = {
  loadAuthorisation: async () => {
    const identity = await requireCommercialIdentity();
    const preference = await readCommercialPreference();
    const context = resolveMembershipContext(identity, {
      requestedMembershipId: preference?.membershipId,
      requestedSiteId: preference?.siteId,
      expectedAuthorisationRevision: preference?.authorisationRevision,
      selectionMode: "sensitive",
    });
    return { identity, context };
  },
  rpc: defaultRpc,
  revalidate: () => {
    revalidatePath("/payroll");
    revalidatePath("/payroll/arrangements");
    revalidatePath("/payroll/review");
  },
};

function validUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function validRevision(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function validFingerprint(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function requireValidUuid(value: string, label: string): void {
  if (!validUuid(value)) throw new Error(`${label} is invalid.`);
}

async function runCommand(
  permission: OrganisationPermission,
  invoke: (
    scope: CommercialPayrollCommandScope,
    rpc: PayrollRpc,
  ) => Promise<{ data: unknown; error: { message?: string } | null }>,
  dependencies: CommercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  const { identity, context } = await dependencies.loadAuthorisation();
  return executeCommercialPayrollMutation({
    identity,
    context,
    permission,
    command: async (scope) => {
      const result = await invoke(scope, dependencies.rpc);
      if (result.error) {
        return { ok: false, code: "command_unavailable" };
      }
      const data = result.data;
      const commandResult = (
        typeof data === "object" && data !== null ? data : null
      ) as CommercialPayrollCommandResult | null;
      if (!commandResult || typeof commandResult.ok !== "boolean"
        || typeof commandResult.code !== "string") {
        return { ok: false, code: "invalid_command_response" };
      }
      if (commandResult.ok) dependencies.revalidate();
      return commandResult;
    },
  });
}

export async function createCommercialPayrollPeriod(
  input: {
    periodStart: string;
    periodEnd: string;
    operationId: string;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  const range = requireAttendanceDateRange(input.periodStart, input.periodEnd);
  requireValidUuid(input.operationId, "Payroll operation");
  return runCommand("payroll.prepare", (scope, rpc) => rpc(
    "create_commercial_payroll_period",
    {
      target_organisation_id: scope.organisationId,
      target_period_start: range.from,
      target_period_end: range.to,
      target_operation_id: input.operationId,
    },
  ), dependencies);
}

export async function persistCommercialPayrollPreparation(
  input: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    snapshot: CommercialPayrollSnapshot;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  if (!validRevision(input.expectedRevision)
    || !validFingerprint(input.snapshot.inputFingerprint)
    || !validFingerprint(input.snapshot.attendanceFingerprint)
    || !validFingerprint(input.snapshot.payArrangementFingerprint)) {
    throw new Error("Payroll preparation context is invalid.");
  }
  return runCommand("payroll.prepare", (scope, rpc) => {
    if (input.snapshot.organisationId !== scope.organisationId) {
      throw new CommercialIdentityError("membership_unavailable");
    }
    return rpc("persist_commercial_payroll_preparation", {
      target_period_id: input.periodId,
      target_site_filter_id: scope.siteId,
      expected_revision: input.expectedRevision,
      target_operation_id: input.operationId,
      target_input_fingerprint: input.snapshot.inputFingerprint,
      target_attendance_fingerprint: input.snapshot.attendanceFingerprint,
      target_pay_arrangement_fingerprint: input.snapshot.payArrangementFingerprint,
      preparation_rows: input.snapshot.rows,
      preparation_readiness: input.snapshot.readiness,
    });
  }, dependencies);
}

export async function acknowledgeCommercialPayrollWarnings(
  input: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    warningCodes: string[];
    note: string;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  const note = input.note.trim();
  if (!validRevision(input.expectedRevision) || note.length < 5 || note.length > 2_000
    || input.warningCodes.length === 0
    || input.warningCodes.some((code) => !/^[a-z_]+$/.test(code))) {
    throw new Error("Payroll warning acknowledgement is invalid.");
  }
  return runCommand("payroll.prepare", (_scope, rpc) => rpc(
    "acknowledge_commercial_payroll_warnings",
    {
      target_period_id: input.periodId,
      expected_revision: input.expectedRevision,
      target_operation_id: input.operationId,
      acknowledged_warning_codes: [...new Set(input.warningCodes)].sort(),
      acknowledgement_note: note,
    },
  ), dependencies);
}

export async function approveCommercialPayrollPreparation(
  input: { periodId: string; expectedRevision: number; operationId: string },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  if (!validRevision(input.expectedRevision)) throw new Error("Payroll revision is invalid.");
  return runCommand("payroll.prepare", (_scope, rpc) => rpc(
    "approve_commercial_payroll_preparation_v2",
    {
      target_period_id: input.periodId,
      expected_revision: input.expectedRevision,
      target_operation_id: input.operationId,
    },
  ), dependencies);
}

export async function reopenCommercialPayrollPreparation(
  input: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    reason: string;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  const reason = input.reason.trim();
  if (!validRevision(input.expectedRevision) || reason.length < 5 || reason.length > 2_000) {
    throw new Error("Payroll reopen reason is invalid.");
  }
  return runCommand("payroll.prepare", (_scope, rpc) => rpc(
    "reopen_commercial_payroll_preparation",
    {
      target_period_id: input.periodId,
      expected_revision: input.expectedRevision,
      target_operation_id: input.operationId,
      reopen_reason: reason,
    },
  ), dependencies);
}

export async function createCommercialPayrollAdjustment(
  input: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    target: CommercialPayrollAdjustmentTarget;
    adjustmentMinutes: number;
    reason: string;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  const staffId = input.target.staffId.trim();
  const reason = input.reason.trim();
  const siteId = "siteId" in input.target ? input.target.siteId : null;
  const operationalDate = input.target.kind === "attendance"
    ? input.target.operationalDate
    : null;
  if (!validRevision(input.expectedRevision) || !staffId
    || (input.target.kind !== "organisation_summary" && !siteId)
    || (input.target.kind === "attendance"
      && !/^\d{4}-\d{2}-\d{2}$/.test(input.target.operationalDate))
    || !Number.isInteger(input.adjustmentMinutes) || input.adjustmentMinutes === 0
    || reason.length < 5 || reason.length > 2_000) {
    throw new Error("Payroll adjustment is invalid.");
  }
  return runCommand("payroll.prepare", (_scope, rpc) => rpc(
    "create_commercial_payroll_adjustment_v2",
    {
      target_period_id: input.periodId,
      expected_revision: input.expectedRevision,
      operation_id: input.operationId,
      target_staff_id: staffId,
      target_kind: input.target.kind,
      target_site_id: siteId,
      target_operational_date: operationalDate,
      adjustment_minutes: input.adjustmentMinutes,
      reason,
    },
  ), dependencies);
}

export async function replaceCommercialPayrollAdjustment(
  input: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    adjustmentId: string;
    adjustmentMinutes: number;
    reason: string;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  requireValidUuid(input.adjustmentId, "Payroll adjustment");
  const reason = input.reason.trim();
  if (!validRevision(input.expectedRevision)
    || !Number.isInteger(input.adjustmentMinutes) || input.adjustmentMinutes === 0
    || reason.length < 5 || reason.length > 2_000) {
    throw new Error("Payroll adjustment replacement is invalid.");
  }
  return runCommand("payroll.prepare", (_scope, rpc) => rpc(
    "replace_commercial_payroll_adjustment_v2",
    {
      target_period_id: input.periodId,
      expected_revision: input.expectedRevision,
      operation_id: input.operationId,
      target_adjustment_id: input.adjustmentId,
      adjustment_minutes: input.adjustmentMinutes,
      reason,
    },
  ), dependencies);
}

export async function transitionCommercialPayrollAdjustment(
  input: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    adjustmentId: string;
    transition: "void" | "reverse";
    reason: string;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  requireValidUuid(input.periodId, "Payroll period");
  requireValidUuid(input.operationId, "Payroll operation");
  requireValidUuid(input.adjustmentId, "Payroll adjustment");
  const reason = input.reason.trim();
  if (!validRevision(input.expectedRevision)
    || !["void", "reverse"].includes(input.transition)
    || reason.length < 5 || reason.length > 2_000) {
    throw new Error("Payroll adjustment transition is invalid.");
  }
  return runCommand("payroll.prepare", (_scope, rpc) => rpc(
    "transition_commercial_payroll_adjustment_v2",
    {
      target_period_id: input.periodId,
      expected_revision: input.expectedRevision,
      operation_id: input.operationId,
      target_adjustment_id: input.adjustmentId,
      transition: input.transition,
      reason,
    },
  ), dependencies);
}

export async function recordCommercialPayrollExport(
  input: {
    periodId: string;
    approvalId: string;
    expectedRevision: number;
    operationId: string;
    format: "xlsx" | "csv";
    fileName: string;
    contentSha256: string;
    rowCount: number;
    rowFingerprint: string;
    payableMinutes: number;
    adjustmentMinutes: number;
  },
  dependencies: CommercialPayrollMutationDependencies = commercialPayrollMutationDependencies,
): Promise<CommercialPayrollCommandResult> {
  for (const [value, label] of [
    [input.periodId, "Payroll period"],
    [input.approvalId, "Payroll approval"],
    [input.operationId, "Payroll operation"],
  ] as const) requireValidUuid(value, label);
  const fileName = input.fileName.trim();
  if (!validRevision(input.expectedRevision) || !validFingerprint(input.contentSha256)
    || !validFingerprint(input.rowFingerprint)
    || !["xlsx", "csv"].includes(input.format)
    || !fileName || fileName.length > 255 || /[\\/\u0000-\u001f]/.test(fileName)
    || !Number.isInteger(input.rowCount) || input.rowCount < 0
    || !Number.isInteger(input.payableMinutes)
    || !Number.isInteger(input.adjustmentMinutes)) {
    throw new Error("Payroll export context is invalid.");
  }
  return runCommand("payroll.export", (_scope, rpc) => rpc(
    "record_commercial_payroll_export_v2",
    {
      target_period_id: input.periodId,
      target_approval_id: input.approvalId,
      expected_revision: input.expectedRevision,
      target_operation_id: input.operationId,
      target_export_format: input.format,
      target_file_name: fileName,
      target_file_sha256: input.contentSha256,
      target_row_count: input.rowCount,
      target_row_fingerprint: input.rowFingerprint,
      target_payable_minutes: input.payableMinutes,
      target_adjustment_minutes: input.adjustmentMinutes,
    },
  ), dependencies);
}

const failureMessages: Record<string, string> = {
  active_adjustments_present: "Resolve active adjustments before preparing the period again.",
  adjustment_voided: "The adjustment was voided without deleting its history.",
  approval_required: "Approve the current preparation before exporting it.",
  blockers_present: "Resolve payroll blockers before approval.",
  command_unavailable: "The payroll change could not be saved.",
  evidence_changed: "Attendance or pay details changed. Reload and prepare the period again.",
  export_evidence_mismatch: "The approved payroll evidence no longer matches this export.",
  forbidden: "This payroll action is not available.",
  invalid_command_response: "The payroll change returned an invalid response.",
  invalid_request: "The payroll request is incomplete.",
  mfa_required: "Additional authentication is required.",
  operation_conflict: "This payroll operation was already used for different changes.",
  invalid_site_scope: "This adjustment is not available for the selected site.",
  invalid_target: "Choose a valid attendance or summary target for this adjustment.",
  negative_target_total: "This adjustment would make payable time negative.",
  period_closed: "This payroll period is closed.",
  preparation_required: "Prepare the payroll period before continuing.",
  stale_approval_evidence: "The approved payroll evidence changed. Recalculate and approve it again.",
  stale_adjustment_fingerprint: "Payroll adjustments changed. Recalculate the preparation.",
  stale_attendance_fingerprint: "Attendance changed. Recalculate the preparation.",
  stale_pay_arrangement_fingerprint: "Pay details changed. Recalculate the preparation.",
  stale_readiness: "Payroll readiness changed. Recalculate the preparation.",
  stale_row_fingerprint: "Stored payroll rows changed. Recalculate the preparation.",
  stale_site_scope_fingerprint: "Staff site scope changed. Recalculate the preparation.",
  stale_revision: "Payroll changed after this page loaded. Reload and review it again.",
  run_stale: "Payroll inputs changed. Recalculate the preparation before making another adjustment.",
  aal2_required: "Additional authentication is required.",
  permission_denied: "This payroll action is not available.",
  warnings_unacknowledged: "Acknowledge the current warnings before approval.",
};

function actionState(result: CommercialPayrollCommandResult): CommercialPayrollActionState {
  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      message: failureMessages[result.code] ?? "The payroll change could not be saved.",
    };
  }
  return { ok: true, code: result.code, message: "Payroll preparation was updated." };
}

function actionFailure(error: unknown): CommercialPayrollActionState {
  if (error instanceof CommercialIdentityError) {
    return { ok: false, code: error.code, message: error.message };
  }
  return { ok: false, code: "invalid_request", message: "Check the payroll details and try again." };
}

export async function createBoundCommercialPayrollPeriodAction(
  context: { periodStart: string; periodEnd: string; operationId: string },
  _state: CommercialPayrollActionState,
): Promise<CommercialPayrollActionState> {
  void _state;
  try {
    return actionState(await createCommercialPayrollPeriod(context));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function persistBoundCommercialPayrollPreparationAction(
  context: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    snapshot: CommercialPayrollSnapshot;
  },
  _state: CommercialPayrollActionState,
): Promise<CommercialPayrollActionState> {
  void _state;
  try {
    return actionState(await persistCommercialPayrollPreparation(context));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function acknowledgeBoundCommercialPayrollWarningsAction(
  context: { periodId: string; expectedRevision: number; operationId: string },
  _state: CommercialPayrollActionState,
  formData: FormData,
): Promise<CommercialPayrollActionState> {
  try {
    return actionState(await acknowledgeCommercialPayrollWarnings({
      ...context,
      warningCodes: formData.getAll("warningCode").map(String),
      note: String(formData.get("note") ?? ""),
    }));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function approveBoundCommercialPayrollPreparationAction(
  context: { periodId: string; expectedRevision: number; operationId: string },
  _state: CommercialPayrollActionState,
): Promise<CommercialPayrollActionState> {
  void _state;
  try {
    return actionState(await approveCommercialPayrollPreparation(context));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function reopenBoundCommercialPayrollPreparationAction(
  context: { periodId: string; expectedRevision: number; operationId: string },
  _state: CommercialPayrollActionState,
  formData: FormData,
): Promise<CommercialPayrollActionState> {
  try {
    return actionState(await reopenCommercialPayrollPreparation({
      ...context,
      reason: String(formData.get("reason") ?? ""),
    }));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function createBoundCommercialPayrollAdjustmentAction(
  context: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    target?: CommercialPayrollAdjustmentTarget;
    staffId?: string;
  },
  _state: CommercialPayrollActionState,
  formData: FormData,
): Promise<CommercialPayrollActionState> {
  try {
    const targetKind = String(formData.get("targetKind") ?? "");
    const staffId = String(formData.get("targetStaffId") ?? context.staffId ?? "").trim();
    const siteId = String(formData.get("targetSiteId") ?? "").trim();
    const operationalDate = String(formData.get("targetOperationalDate") ?? "").trim();
    const target = context.target ?? (
      targetKind === "attendance" ? {
        kind: "attendance" as const, staffId, siteId, operationalDate,
      } : targetKind === "site_summary" ? {
        kind: "site_summary" as const, staffId, siteId,
      } : targetKind === "organisation_summary" ? {
        kind: "organisation_summary" as const, staffId,
      } : null
    );
    if (!target) throw new Error("Payroll adjustment target is invalid.");
    return actionState(await createCommercialPayrollAdjustment({
      ...context,
      target,
      adjustmentMinutes: Number(formData.get("adjustmentMinutes")),
      reason: String(formData.get("reason") ?? ""),
    }));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resolveBoundCommercialPayrollAdjustmentAction(
  context: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    adjustmentId: string;
    resolution: string;
  },
  _state: CommercialPayrollActionState,
  formData: FormData,
): Promise<CommercialPayrollActionState> {
  try {
    if (context.resolution !== "void" && context.resolution !== "reverse") {
      return actionState({ ok: false, code: "invalid_target" });
    }
    return actionState(await transitionCommercialPayrollAdjustment({
      periodId: context.periodId,
      expectedRevision: context.expectedRevision,
      operationId: context.operationId,
      adjustmentId: context.adjustmentId,
      transition: context.resolution,
      reason: String(formData.get("reason") ?? ""),
    }));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function replaceBoundCommercialPayrollAdjustmentAction(
  context: {
    periodId: string;
    expectedRevision: number;
    operationId: string;
    adjustmentId: string;
  },
  _state: CommercialPayrollActionState,
  formData: FormData,
): Promise<CommercialPayrollActionState> {
  void _state;
  try {
    return actionState(await replaceCommercialPayrollAdjustment({
      ...context,
      adjustmentMinutes: Number(formData.get("adjustmentMinutes")),
      reason: String(formData.get("reason") ?? ""),
    }));
  } catch (error) {
    return actionFailure(error);
  }
}

export async function recordBoundCommercialPayrollExportAction(
  context: Parameters<typeof recordCommercialPayrollExport>[0],
  _state: CommercialPayrollActionState,
): Promise<CommercialPayrollActionState> {
  void _state;
  try {
    return actionState(await recordCommercialPayrollExport(context));
  } catch (error) {
    return actionFailure(error);
  }
}
