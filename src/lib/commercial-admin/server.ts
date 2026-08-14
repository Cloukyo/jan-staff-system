import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireActiveMembership } from "@/lib/commercial-identity/server";
import { executeCommercialAdminCommand, loadCommercialAdminSnapshot, type CommercialAdminRpc } from "./service";

async function dependencies() {
  const supabase = await createSupabaseServerClient();
  const rpc: CommercialAdminRpc = async (name, parameters) => supabase.rpc(name, parameters);
  return { rpc };
}

export async function loadCommercialAdminServer() {
  const context = await requireActiveMembership({ selectionMode: "sensitive" });
  return loadCommercialAdminSnapshot({ organisationId: context.organisationId, siteId: context.selectedSiteId }, await dependencies());
}

export async function executeCommercialAdminCommandServer(input: {
  commandName: Parameters<typeof executeCommercialAdminCommand>[0] extends never ? never : string;
  payload: Record<string, unknown>;
  idempotencyKey: string;
  expectedRevision: number;
}) {
  const context = await requireActiveMembership({ selectionMode: "sensitive" });
  return executeCommercialAdminCommand({ ...input, organisationId: context.organisationId }, await dependencies());
}
