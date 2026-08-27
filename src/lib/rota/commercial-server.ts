import { loadCommercialOperationalSettings } from "@/lib/settings/server";
import { loadCommercialRotaSnapshot } from "@/lib/rota/tenant-service";
import type { ProductionRotaDataset, ProductionRotaShift, ProductionRotaWeek, RotaLeaveWarning } from "@/lib/rota/types";
import type { CommercialMembershipContext } from "@/types/tenancy";
import type { RotaTemplate, RotaTemplateApplyMode, RotaTemplateShift, TemplateApplicationPreview } from "@/lib/rota/template-types";
import { buildTemplateApplicationPreview } from "@/lib/rota/template-validation";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function mapWeek(value: unknown): ProductionRotaWeek | null {
  const row = record(value);
  if (!row.id) return null;
  return {
    id: String(row.id),
    weekStartDate: String(row.week_start_date),
    status: String(row.status) as ProductionRotaWeek["status"],
    title: nullable(row.title), notes: nullable(row.notes), publishedAt: nullable(row.published_at),
    archivedAt: nullable(row.archived_at), revision: Number(row.revision),
  };
}

function mapShift(row: Record<string, unknown>): ProductionRotaShift {
  const workArea = nullable(row.work_area);
  return {
    id: String(row.id), rotaWeekId: String(row.rota_week_id), staffId: String(row.staff_id),
    shiftDate: String(row.shift_date), startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5),
    breakMinutes: Number(row.break_minutes), breakUnspecified: Boolean(row.break_unspecified), workArea, workAreaId: nullable(row.work_area_id), roomOrArea: workArea,
    roleOnShift: nullable(row.role_on_shift), notes: nullable(row.notes), status: String(row.status) as ProductionRotaShift["status"],
    inactiveStaffOverrideReason: nullable(row.inactive_staff_override_reason), leaveOverrideReason: nullable(row.leave_override_reason),
    overlapOverrideReason: nullable(row.overlap_override_reason), archivedAt: nullable(row.archived_at), revision: Number(row.revision),
  };
}

export async function loadCommercialProductionRota(
  context: CommercialMembershipContext,
  weekStart: string,
): Promise<ProductionRotaDataset> {
  const [snapshot, settings, siteChoices] = await Promise.all([
    loadCommercialRotaSnapshot(context, weekStart),
    loadCommercialOperationalSettings(context),
    loadCommercialRotaSiteChoices(context),
  ]);
  const site = record(snapshot.site);
  const workAreas = rows(snapshot.workAreas);
  return {
    organisationId: context.organisationId,
    membershipId: context.membershipId,
    site: { id: String(site.id), name: String(site.name) },
    siteChoices,
    weekStart,
    week: mapWeek(snapshot.week),
    shifts: rows(snapshot.shifts).map(mapShift),
    staff: rows(snapshot.staff).map((row) => ({
      id: String(row.id), fullName: String(row.full_name), displayName: String(row.display_name),
      employmentRole: String(row.employment_role ?? "Staff"), active: Boolean(row.active),
    })),
    leave: rows(snapshot.leave).map((row) => ({
      id: String(row.id), staffId: String(row.staff_id), startDate: String(row.start_date), endDate: String(row.end_date),
      dayPart: String(row.day_part), startTime: nullable(row.start_time), endTime: nullable(row.end_time), status: String(row.status),
    })) as RotaLeaveWarning[],
    settings: {
      openingTime: settings.operatingHours.openingTime,
      closingTime: settings.operatingHours.closingTime,
      defaultBreakMinutes: settings.staffing.defaultBreakMinutes,
      shiftIntervalMinutes: 15,
      availableWorkAreas: workAreas.map((area) => String(area.name)),
      workAreaOptions: workAreas.map((area) => ({ id: String(area.id), name: String(area.name) })),
      availableRooms: workAreas.map((area) => String(area.name)),
      allowOverlapOverride: false,
      allowInactiveStaffOverride: false,
    },
  };
}

function mapTemplate(row: Record<string, unknown>): RotaTemplate {
  return {
    id: String(row.id), name: String(row.name), description: nullable(row.description), status: String(row.status) as RotaTemplate["status"],
    sourceType: String(row.source_type) as RotaTemplate["sourceType"], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
  };
}

function mapTemplateShift(row: Record<string, unknown>): RotaTemplateShift {
  return {
    id: String(row.id), templateId: String(row.template_id), staffId: String(row.staff_id), dayOfWeek: Number(row.day_of_week),
    startTime: String(row.start_time).slice(0, 5), endTime: String(row.end_time).slice(0, 5), breakMinutes: Number(row.break_minutes),
    workArea: nullable(row.room_or_area), roomOrArea: nullable(row.room_or_area), roleOnShift: nullable(row.role_on_shift), notes: nullable(row.notes),
    sortOrder: Number(row.sort_order), archivedAt: nullable(row.archived_at),
  };
}

export async function loadCommercialRotaSiteChoices(context: CommercialMembershipContext) {
  const client = await createSupabaseServerClient();
  const { data, error } = await client.from("organisation_sites").select("id,name")
    .eq("organisation_id", context.organisationId).in("id", context.permittedSiteIds).eq("active", true).is("archived_at", null).order("name");
  if (error) throw new Error("Available rota sites could not be loaded.");
  return data.map((site) => ({ id: String(site.id), name: String(site.name) }));
}

export async function loadCommercialRotaTemplates(
  context: CommercialMembershipContext,
  weekStart: string,
  rota: ProductionRotaDataset,
  selectedTemplateId?: string,
  mode: RotaTemplateApplyMode = "empty_days",
): Promise<{ templates: RotaTemplate[]; preview: TemplateApplicationPreview | null }> {
  const snapshot = await loadCommercialRotaSnapshot(context, weekStart);
  const definitions = rows(snapshot.templates);
  const templates = definitions.map(mapTemplate);
  const selected = definitions.find((item) => String(item.id) === selectedTemplateId);
  if (!selected) return { templates, preview: null };
  const template = mapTemplate(selected);
  return {
    templates,
    preview: buildTemplateApplicationPreview({
      template,
      templateShifts: rows(selected.shifts).map(mapTemplateShift),
      rota,
      mode,
      expiredCertificateStaffIds: new Set(),
    }),
  };
}
