import { createHash } from "node:crypto";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { requireActiveMembership, requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { isoDateInLondon } from "@/lib/dates/format";
import { loadHolidayPayEvidencePage } from "@/lib/retention/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function csv(value: unknown): string { return `"${String(value ?? "").replaceAll('"', '""')}"`; }

export async function GET() {
  try {
    requireAal2(await requireCommercialIdentity());
    const context = await requireActiveMembership({ selectionMode: "sensitive" });
    if (!context.permissions.includes("payroll.read")) throw new Error("Permission denied.");
    const data = await loadHolidayPayEvidencePage();
    const body = [
      ["Staff", "Paid on", "Leave minutes", "Amount paid GBP", "Evidence note", "Created at", "Retain until"].map(csv).join(","),
      ...data.rows.map((row) => [row.staffName, row.paidOn, row.leaveMinutes, (row.amountPaidPence / 100).toFixed(2), row.evidenceNote, row.createdAt, row.retainedUntil].map(csv).join(",")),
    ].join("\r\n");
    const fileName = `leave-holiday-pay-records-${isoDateInLondon()}.csv`;
    const supabase = await createSupabaseServerClient();
    const audit = await supabase.from("holiday_pay_evidence_export_audits").insert({ organisation_id: context.organisationId, exported_by_membership_id: context.membershipId, file_name: fileName, digest: createHash("sha256").update(body).digest("hex"), row_count: data.rows.length });
    if (audit.error) throw new Error("Audit failed.");
    return new Response(body, { status: 200, headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch {
    return Response.json({ error: "Retained leave records are not available for this account." }, { status: 403, headers: { "Cache-Control": "private, no-store" } });
  }
}
