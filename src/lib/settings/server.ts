import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { normaliseWeekStartDay, type WeekStartDay } from "@/lib/attendance/hours";

export type ProductionNurserySettings = {
  workWeekStartsOn: WeekStartDay;
};

export async function loadProductionNurserySettings(): Promise<ProductionNurserySettings> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("rota_settings").select("work_week_starts_on,week_starts_on").eq("id", true).single();
  if (error) throw new Error("Production settings could not be loaded.");
  return {
    workWeekStartsOn: normaliseWeekStartDay(data.work_week_starts_on ?? data.week_starts_on),
  };
}
