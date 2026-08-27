import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireCustomerDomainContext } from "@/lib/customer-domain/context";
import type { StaffImportInputRow } from "@/types/customer-domain";

export async function previewCommercialStaffImport(
  idempotencyKey: string,
  rows: readonly StaffImportInputRow[],
): Promise<string> {
  const context = await requireCustomerDomainContext("staff.manage", { siteRequired: true });
  if (!context.selectedSiteId) throw new Error("A site must be selected before previewing a staff import.");
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("preview_staff_import_batch", {
    target_organisation_id: context.organisationId,
    target_site_id: context.selectedSiteId,
    target_idempotency_key: idempotencyKey,
    input_rows: rows,
  });
  if (error || !data) throw new Error("Staff import preview could not be created.");
  return String(data);
}

export async function commitCommercialStaffImport(batchId: string): Promise<number> {
  await requireCustomerDomainContext("staff.manage", { siteRequired: true });
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("commit_staff_import_batch", { target_batch_id: batchId });
  if (error) throw new Error("Staff import could not be committed.");
  return Number(data ?? 0);
}
