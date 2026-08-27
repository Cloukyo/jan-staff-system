import { commercialAdminCommandResultSchema, commercialAdminCommandSchema, commercialAdminSnapshotSchema } from "./contracts";

type RpcResult = Promise<{ data: unknown; error: { message?: string } | null }>;
export type CommercialAdminRpc = (name: "get_commercial_admin_snapshot" | "execute_commercial_admin_command", parameters: Record<string, unknown>) => RpcResult;

export async function loadCommercialAdminSnapshot(
  input: { organisationId: string; siteId?: string | null },
  dependencies: { rpc: CommercialAdminRpc },
) {
  const result = await dependencies.rpc("get_commercial_admin_snapshot", {
    target_organisation_id: input.organisationId,
    target_site_id: input.siteId ?? null,
  });
  if (result.error) throw new Error("Commercial administration could not be loaded.");
  const parsed = commercialAdminSnapshotSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.organisation.id !== input.organisationId) throw new Error("The authoritative commercial administration response was invalid.");
  return parsed.data;
}

export async function executeCommercialAdminCommand(input: unknown, dependencies: { rpc: CommercialAdminRpc }) {
  const command = commercialAdminCommandSchema.parse(input);
  const result = await dependencies.rpc("execute_commercial_admin_command", {
    target_organisation_id: command.organisationId,
    command_name: command.commandName,
    payload: command.payload,
    idempotency_key: command.idempotencyKey,
    expected_revision: command.expectedRevision,
  });
  if (result.error) throw new Error("The commercial administration command could not be confirmed.");
  const parsed = commercialAdminCommandResultSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("The authoritative commercial administration result was invalid.");
  return parsed.data;
}
