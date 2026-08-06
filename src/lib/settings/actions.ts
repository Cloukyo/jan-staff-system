"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { normaliseWeekStartDay } from "@/lib/attendance/hours";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";

export type SettingsActionResult = {
  ok: boolean;
  message: string;
};

export async function saveProductionSiteSettingsAction(_state: SettingsActionResult, formData: FormData): Promise<SettingsActionResult> {
  const actor = await requireCustomerDomainActor("settings.manage", { siteRequired: true });
  const workWeekStartsOn = normaliseWeekStartDay(Number(formData.get("workWeekStartsOn")));
  const supabase = await createSupabaseServerClient();
  const { error } = actor.kind === "commercial"
    ? actor.context.selectedSiteId
      ? await supabase.from("site_settings")
        .update({ work_week_starts_override: workWeekStartsOn })
        .eq("organisation_id", actor.context.organisationId)
        .eq("site_id", actor.context.selectedSiteId)
      : { error: new Error("A site must be selected.") }
    : await supabase.from("rota_settings").update({ work_week_starts_on: workWeekStartsOn }).eq("id", true);
  if (error) return { ok: false, message: "Production settings could not be saved." };
  revalidatePath("/settings");
  revalidatePath("/attendance");
  revalidatePath("/clock");
  return { ok: true, message: "Production settings saved." };
}

/** @deprecated Use saveProductionSiteSettingsAction. */
export const saveProductionNurserySettingsAction = saveProductionSiteSettingsAction;
