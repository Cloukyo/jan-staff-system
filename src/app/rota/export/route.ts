import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { isoDate, weekStart } from "@/lib/dates/format";
import { buildRotaWorkbook, parseRotaExportOptions, rotaExportFilename } from "@/lib/exports/rota-excel";
import { loadProductionRotaForExport } from "@/lib/rota/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (getAppMode() !== "production") return new Response("Production rota export is unavailable in demo mode.", { status: 404 });
  const account = await requireAccount(["manager"]);
  const url = new URL(request.url);
  const requestedWeek = url.searchParams.get("week");
  if (!requestedWeek || !/^\d{4}-\d{2}-\d{2}$/.test(requestedWeek)) return new Response("Choose a valid rota week.", { status: 400 });
  const selectedWeek = isoDate(weekStart(requestedWeek));
  const options = parseRotaExportOptions(url.searchParams);
  try {
    const data = await loadProductionRotaForExport(selectedWeek, options.includeArchivedOrCancelled);
    if (!data.week) return new Response("No production rota exists for this week.", { status: 404 });
    const workbook = await buildRotaWorkbook(data, options, account.fullName);
    return new Response(new Uint8Array(workbook), {
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${rotaExportFilename(selectedWeek)}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return new Response("The production rota workbook could not be generated.", { status: 500 });
  }
}
