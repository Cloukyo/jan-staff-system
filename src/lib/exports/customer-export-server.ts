import "server-only";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireAal2, requirePermission } from "@/lib/commercial-identity/guards";
import { requireActiveMembership, requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { buildCustomerExport } from "./customer-export";

export async function buildCustomerExportServer() {
  requireAal2(await requireCommercialIdentity());
  const context = requirePermission(await requireActiveMembership({ selectionMode: "sensitive" }), "organisation.export");
  const supabase = await createSupabaseServerClient();
  return buildCustomerExport({
    async prepare() {
      const response = await supabase.rpc("prepare_customer_export", { target_organisation_id: context.organisationId });
      if (response.error || !response.data) throw new Error("Customer export projection could not be prepared.");
      return response.data;
    },
    async recordAudit(input) {
      const response = await supabase.rpc("record_customer_export_audit", {
        target_organisation_id: context.organisationId,
        schema_version: input.schemaVersion,
        file_name: input.filename,
        digest: input.digest,
        category_counts: input.counts,
      });
      if (response.error) throw new Error("Customer export audit receipt could not be recorded.");
      return response.data;
    },
  });
}
