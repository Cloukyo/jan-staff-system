import { buildComplianceEvidenceExportServer } from "@/lib/exports/compliance-evidence-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await buildComplianceEvidenceExportServer();
    return new Response(Uint8Array.from(result.bytes).buffer, { status: 200, headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${result.fileName}"`,
      "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff",
    } });
  } catch {
    return Response.json({ error: "Staff checks evidence is not available for this account." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
}
