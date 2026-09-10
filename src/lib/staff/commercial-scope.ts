import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { isoDateInLondon } from "@/lib/dates/format";
import type { CommercialMembershipContext } from "@/types/tenancy";

export type CommercialStaffSiteContext = Pick<
  CommercialMembershipContext,
  "organisationId" | "selectedSiteId"
>;

function selectedSiteId(context: CommercialStaffSiteContext): string {
  if (!context.selectedSiteId) throw new Error("A current site selection is required.");
  return context.selectedSiteId;
}

export async function loadCommercialStaffIdsForSelectedSite(
  context: CommercialStaffSiteContext,
): Promise<string[]> {
  const supabase = await createSupabaseServerClient();
  const today = isoDateInLondon();
  const { data, error } = await supabase
    .from("staff_site_assignments")
    .select("staff_id")
    .eq("organisation_id", context.organisationId)
    .eq("site_id", selectedSiteId(context))
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`);
  if (error) throw new Error("Staff site scope could not be loaded.");
  return [...new Set((data ?? []).map((row) => String(row.staff_id)))];
}

export async function isCommercialStaffInSelectedSiteScope(
  context: CommercialStaffSiteContext,
  staffId: string,
): Promise<boolean> {
  const supabase = await createSupabaseServerClient();
  const today = isoDateInLondon();
  const { data, error } = await supabase
    .from("staff_site_assignments")
    .select("staff_id")
    .eq("organisation_id", context.organisationId)
    .eq("site_id", selectedSiteId(context))
    .eq("staff_id", staffId)
    .lte("effective_from", today)
    .or(`effective_to.is.null,effective_to.gte.${today}`)
    .limit(1)
    .maybeSingle();
  return !error && Boolean(data);
}
