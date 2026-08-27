import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { StaffSiteAssignment } from "@/types/tenancy";

export async function loadCommercialStaffSiteAssignments(
  organisationId: string,
  options: { staffId?: string; siteId?: string } = {},
): Promise<StaffSiteAssignment[]> {
  const supabase = await createSupabaseServerClient();
  let query = supabase.from("staff_site_assignments")
    .select("id,organisation_id,staff_id,site_id,effective_from,effective_to,is_primary,employment_role,created_at,updated_at")
    .eq("organisation_id", organisationId)
    .order("effective_from")
    .order("id");
  if (options.staffId) query = query.eq("staff_id", options.staffId);
  if (options.siteId) query = query.eq("site_id", options.siteId);
  const { data, error } = await query;
  if (error) throw new Error("Commercial staff assignments could not be loaded.");
  return (data ?? []).map((row) => ({
    id: row.id,
    organisationId: row.organisation_id,
    staffId: row.staff_id,
    siteId: row.site_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isPrimary: row.is_primary,
    employmentRole: row.employment_role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}
