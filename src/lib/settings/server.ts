import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { normaliseWeekStartDay, type WeekStartDay } from "@/lib/attendance/hours";
import { resolveOperationalSettings } from "@/lib/customer-domain/settings";
import type { OrganisationOperationalSettings } from "@/types/customer-domain";
import type { CommercialMembershipContext } from "@/types/tenancy";

export type ProductionSiteSettings = {
  workWeekStartsOn: WeekStartDay;
};

export async function loadProductionSiteSettings(): Promise<ProductionSiteSettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("rota_settings").select("work_week_starts_on,week_starts_on").eq("id", true).single();
  if (error) throw new Error("Production settings could not be loaded.");
  return {
    workWeekStartsOn: normaliseWeekStartDay(data.work_week_starts_on ?? data.week_starts_on),
  };
}

export async function loadCommercialOperationalSettings(
  context: Pick<CommercialMembershipContext, "organisationId" | "selectedSiteId">,
): Promise<OrganisationOperationalSettings> {
  if (!context.selectedSiteId) throw new Error("A site must be selected before loading site settings.");
  const supabase = await createSupabaseServerClient();
  const [organisationResult, siteResult] = await Promise.all([
    supabase.from("organisation_settings")
      .select("work_week_starts,default_timezone,operating_defaults,staffing_defaults")
      .eq("organisation_id", context.organisationId).single(),
    supabase.from("site_settings")
      .select("timezone_override,work_week_starts_override,operating_overrides,staffing_overrides")
      .eq("organisation_id", context.organisationId).eq("site_id", context.selectedSiteId).single(),
  ]);
  if (organisationResult.error || siteResult.error) throw new Error("Commercial site settings could not be loaded.");
  const organisation = organisationResult.data;
  const site = siteResult.data;
  const operatingDefaults = organisation.operating_defaults as Partial<{ openingTime: string; closingTime: string }>;
  const staffingDefaults = organisation.staffing_defaults as Partial<{ defaultBreakMinutes: number; minimumStaff: number }>;
  return resolveOperationalSettings({
    timezone: organisation.default_timezone,
    workWeekStarts: normaliseWeekStartDay(organisation.work_week_starts),
    operatingHours: {
      openingTime: operatingDefaults.openingTime ?? "07:30",
      closingTime: operatingDefaults.closingTime ?? "18:30",
    },
    staffing: {
      defaultBreakMinutes: staffingDefaults.defaultBreakMinutes ?? 0,
      minimumStaff: staffingDefaults.minimumStaff ?? 0,
    },
  }, {
    timezone: site.timezone_override,
    workWeekStarts: site.work_week_starts_override,
    operatingHours: site.operating_overrides as Record<string, string | null>,
    staffing: site.staffing_overrides as Record<string, number | null>,
  });
}

export async function loadCommercialSiteSettings(
  context: Pick<CommercialMembershipContext, "organisationId" | "selectedSiteId">,
): Promise<ProductionSiteSettings> {
  const settings = await loadCommercialOperationalSettings(context);
  return { workWeekStartsOn: normaliseWeekStartDay(settings.workWeekStarts) };
}

/** @deprecated Compatibility alias for integrations using the previous name. */
export type ProductionNurserySettings = ProductionSiteSettings;
/** @deprecated Use loadProductionSiteSettings. */
export const loadProductionNurserySettings = loadProductionSiteSettings;
