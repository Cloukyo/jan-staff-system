import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { buildTemplateWorkbook, templateExportFilename } from "@/lib/exports/rota-excel";
import { loadRotaTemplateManager } from "@/lib/rota/template-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (getAppMode() !== "production") return new Response("Production template export is unavailable in demo mode.", { status: 404 });
  const account = await requireAccount(["manager"]);
  const url = new URL(request.url);
  const templateId = url.searchParams.get("template");
  if (!templateId) return new Response("Choose a rota template.", { status: 400 });
  try {
    const data = await loadRotaTemplateManager(templateId);
    if (!data.selected || data.selected.id !== templateId) return new Response("Rota template not found.", { status: 404 });
    const workbook = await buildTemplateWorkbook(
      data.selected,
      data.shifts,
      data.staff,
      { includeWeekends: url.searchParams.get("weekends") === "1", includeBreaks: url.searchParams.get("breaks") === "1" },
      account.fullName,
    );
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${templateExportFilename(data.selected.name)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("The rota template workbook could not be generated.", { status: 500 });
  }
}
