import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { CommercialMembershipContext } from "@/types/tenancy";
import {
  commercialOperationResultSchema,
  type CommercialLeaveCommand,
  type CommercialOperationResult,
  type CommercialRotaCommand,
  type PlannedShiftRow,
} from "./tenant-types";

type RpcClient = {
  rpc: (name: string, parameters: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

export type CommercialRotaServiceDependencies = { client?: RpcClient };

async function clientFrom(dependencies: CommercialRotaServiceDependencies): Promise<RpcClient> {
  return dependencies.client ?? await createSupabaseServerClient();
}

function requireSelectedSite(context: CommercialMembershipContext): string {
  if (!context.selectedSiteId || !context.permittedSiteIds.includes(context.selectedSiteId)) {
    throw new Error("A permitted site must be selected.");
  }
  return context.selectedSiteId;
}

export async function executeCommercialRotaCommand(
  context: CommercialMembershipContext,
  command: CommercialRotaCommand,
  payload: Record<string, unknown>,
  options: { idempotencyKey: string; expectedRevision?: number | null },
  dependencies: CommercialRotaServiceDependencies = {},
): Promise<CommercialOperationResult> {
  const siteId = requireSelectedSite(context);
  const client = await clientFrom(dependencies);
  const { data, error } = await client.rpc("execute_commercial_rota_command", {
    target_organisation_id: context.organisationId,
    target_site_id: siteId,
    command_name: command,
    payload,
    idempotency_key: options.idempotencyKey,
    expected_revision: options.expectedRevision ?? null,
  });
  if (error) throw new Error("The rota change could not be completed.");
  return commercialOperationResultSchema.parse(data);
}

export async function executeCommercialLeaveCommand(
  context: CommercialMembershipContext,
  command: CommercialLeaveCommand,
  payload: Record<string, unknown>,
  options: { idempotencyKey: string; expectedRevision?: number | null },
  dependencies: CommercialRotaServiceDependencies = {},
): Promise<CommercialOperationResult> {
  const client = await clientFrom(dependencies);
  const { data, error } = await client.rpc("execute_commercial_leave_command", {
    target_organisation_id: context.organisationId,
    command_name: command,
    payload,
    idempotency_key: options.idempotencyKey,
    expected_revision: options.expectedRevision ?? null,
  });
  if (error) throw new Error("The leave change could not be completed.");
  return commercialOperationResultSchema.parse(data);
}

export async function loadCommercialRotaSnapshot(
  context: CommercialMembershipContext,
  weekStart: string,
  dependencies: CommercialRotaServiceDependencies = {},
): Promise<Record<string, unknown>> {
  const siteId = requireSelectedSite(context);
  const client = await clientFrom(dependencies);
  const { data, error } = await client.rpc("get_commercial_rota_snapshot", {
    target_organisation_id: context.organisationId,
    target_site_id: siteId,
    target_week_start: weekStart,
  });
  if (error || !data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("Production rota data could not be loaded.");
  }
  return data as Record<string, unknown>;
}

export async function loadCommercialLeaveSnapshot(
  context: CommercialMembershipContext,
  dependencies: CommercialRotaServiceDependencies = {},
): Promise<Record<string, unknown>> {
  const client = await clientFrom(dependencies);
  const { data, error } = await client.rpc("get_commercial_leave_snapshot", {
    target_organisation_id: context.organisationId,
  });
  if (error || !data || Array.isArray(data) || typeof data !== "object") {
    throw new Error("Leave requests could not be loaded.");
  }
  return data as Record<string, unknown>;
}

export async function loadCommercialPlannedShifts(
  context: Pick<CommercialMembershipContext, "organisationId" | "selectedSiteId" | "permittedSiteIds">,
  range: { from: string; to: string; staffId?: string | null },
  dependencies: CommercialRotaServiceDependencies = {},
): Promise<PlannedShiftRow[]> {
  const siteId = requireSelectedSite(context as CommercialMembershipContext);
  const client = await clientFrom(dependencies);
  const { data, error } = await client.rpc("get_commercial_planned_shifts", {
    target_organisation_id: context.organisationId,
    target_site_id: siteId,
    range_start: range.from,
    range_end: range.to,
    target_staff_id: range.staffId ?? null,
  });
  if (error || !Array.isArray(data)) throw new Error("Production rota data could not be loaded.");
  return data as PlannedShiftRow[];
}
