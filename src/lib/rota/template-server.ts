import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { ProductionRotaDataset } from "@/lib/rota/types";
import type {
  RotaTemplate,
  RotaTemplateApplyMode,
  RotaTemplateDataset,
  RotaTemplateShift,
  TemplateApplicationPreview,
} from "@/lib/rota/template-types";
import { buildTemplateApplicationPreview } from "@/lib/rota/template-validation";

function mapTemplate(row: Record<string, unknown>): RotaTemplate {
  return {
    id: String(row.id),
    name: String(row.name),
    description: row.description ? String(row.description) : null,
    status: String(row.status) as RotaTemplate["status"],
    sourceType: String(row.source_type) as RotaTemplate["sourceType"],
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTemplateShift(row: Record<string, unknown>): RotaTemplateShift {
  return {
    id: String(row.id),
    templateId: String(row.template_id),
    staffId: String(row.staff_id),
    dayOfWeek: Number(row.day_of_week),
    startTime: String(row.start_time).slice(0, 5),
    endTime: String(row.end_time).slice(0, 5),
    breakMinutes: row.break_minutes === null ? null : Number(row.break_minutes),
    roomOrArea: row.room_or_area ? String(row.room_or_area) : null,
    roleOnShift: row.role_on_shift ? String(row.role_on_shift) : null,
    notes: row.notes ? String(row.notes) : null,
    sortOrder: Number(row.sort_order),
    archivedAt: row.archived_at ? String(row.archived_at) : null,
  };
}

export async function loadRotaTemplateSummaries(): Promise<RotaTemplate[]> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.from("rota_templates").select("*").eq("status", "active").order("name");
  if (error) throw new Error("Rota templates could not be loaded.");
  return (data as Record<string, unknown>[]).map(mapTemplate);
}

export async function loadRotaTemplateManager(selectedId?: string): Promise<RotaTemplateDataset> {
  const supabase = await createSupabaseServerClient();
  const [templatesResult, staffResult] = await Promise.all([
    supabase.from("rota_templates").select("*").order("status").order("name"),
    supabase.from("staff_profiles").select("id,full_name,display_name,employment_role,active").order("full_name"),
  ]);
  if (templatesResult.error || staffResult.error) throw new Error("Rota template data could not be loaded.");
  const templates = (templatesResult.data as Record<string, unknown>[]).map(mapTemplate);
  const selected = templates.find((template) => template.id === selectedId) ?? templates.find((template) => template.status === "active") ?? null;
  let shifts: RotaTemplateShift[] = [];
  if (selected) {
    const result = await supabase.from("rota_template_shifts").select("*")
      .eq("template_id", selected.id).is("archived_at", null).order("day_of_week").order("sort_order").order("start_time");
    if (result.error) throw new Error("Template shifts could not be loaded.");
    shifts = (result.data as Record<string, unknown>[]).map(mapTemplateShift);
  }
  return {
    templates,
    selected,
    shifts,
    staff: staffResult.data.map((row) => ({
      id: row.id,
      fullName: row.full_name,
      displayName: row.display_name,
      employmentRole: row.employment_role,
      active: row.active,
    })),
  };
}

export async function loadTemplateApplicationPreview(
  templateId: string,
  mode: RotaTemplateApplyMode,
  rota: ProductionRotaDataset,
): Promise<TemplateApplicationPreview | null> {
  const supabase = await createSupabaseServerClient();
  const [templateResult, shiftsResult, certificatesResult] = await Promise.all([
    supabase.from("rota_templates").select("*").eq("id", templateId).eq("status", "active").maybeSingle(),
    supabase.from("rota_template_shifts").select("*").eq("template_id", templateId).is("archived_at", null)
      .order("day_of_week").order("sort_order").order("start_time"),
    supabase.from("staff_certificates").select("staff_id").is("archived_at", null).eq("permanent", false)
      .lt("expiry_date", rota.weekStart),
  ]);
  if (templateResult.error || shiftsResult.error || certificatesResult.error || !templateResult.data) return null;
  return buildTemplateApplicationPreview({
    template: mapTemplate(templateResult.data as Record<string, unknown>),
    templateShifts: (shiftsResult.data as Record<string, unknown>[]).map(mapTemplateShift),
    rota,
    mode,
    expiredCertificateStaffIds: new Set(certificatesResult.data.map((row) => row.staff_id)),
  });
}
