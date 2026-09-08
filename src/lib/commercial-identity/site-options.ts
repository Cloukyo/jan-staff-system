import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { CommercialMembershipContext } from "@/types/tenancy";

export async function loadAuthorisedSiteOptions(context: CommercialMembershipContext): Promise<Array<{ id: string; name: string }>> {
  if (context.permittedSiteIds.length === 0) return [];
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("organisation_sites").select("id,name")
    .eq("organisation_id", context.organisationId).eq("active", true).is("archived_at", null)
    .in("id", context.permittedSiteIds).order("name");
  if (error) throw new Error("Your sites could not be loaded. Please try again.");
  return (data ?? []).map((site) => ({ id: String(site.id), name: String(site.name) }));
}
