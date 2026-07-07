"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { normaliseWeekStartDay } from "@/lib/attendance/hours";

export type SettingsActionResult = {
  ok: boolean;
  message: string;
};

export async function saveProductionNurserySettingsAction(_state: SettingsActionResult, formData: FormData): Promise<SettingsActionResult> {
  await requireAccount(["manager"]);
  const workWeekStartsOn = normaliseWeekStartDay(Number(formData.get("workWeekStartsOn")));
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("rota_settings").update({ work_week_starts_on: workWeekStartsOn }).eq("id", true);
  if (error) return { ok: false, message: "Production settings could not be saved." };
  revalidatePath("/settings");
  revalidatePath("/attendance");
  revalidatePath("/clock");
  return { ok: true, message: "Production settings saved." };
}
