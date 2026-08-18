import { buildCustomerExportServer } from "@/lib/exports/customer-export-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const exported = await buildCustomerExportServer();
    return new Response(exported.canonicalBody, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${exported.filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return Response.json({ error: "The organisation export is not available for this account." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
}
