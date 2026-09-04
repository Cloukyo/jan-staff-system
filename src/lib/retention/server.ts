"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { requireCustomerDomainActor } from "@/lib/customer-domain/server-actor";

export type HolidayPayEvidenceRow = {
  id: string; staffId: string; staffName: string; leaveRequestId: string | null; leaveMinutes: number;
  amountPaidPence: number; paidOn: string; evidenceNote: string; createdAt: string; retainedUntil: string | null;
};

export type HolidayPayEvidencePage = {
  rows: HolidayPayEvidenceRow[];
  approvedLeave: Array<{ id: string; staffId: string; staffName: string; startDate: string; endDate: string; requestedMinutes: number }>;
};

export async function loadHolidayPayEvidencePage(): Promise<HolidayPayEvidencePage> {
  const actor = await requireCustomerDomainActor("payroll.read");
  if (actor.kind !== "commercial") return { rows: [], approvedLeave: [] };
  const supabase = await createSupabaseServerClient();
  const organisationId = actor.context.organisationId;
  const [records, leave, staff] = await Promise.all([
    supabase.from("holiday_pay_records").select("*").eq("organisation_id", organisationId).is("voided_at", null).order("paid_on", { ascending: false }),
    supabase.from("leave_requests").select("id,staff_id,start_date,end_date,requested_minutes").eq("organisation_id", organisationId).eq("leave_type", "annual_leave").eq("status", "approved").order("start_date", { ascending: false }),
    supabase.from("staff_profiles").select("id,full_name").eq("organisation_id", organisationId),
  ]);
  if (records.error || leave.error || staff.error) throw new Error("Holiday pay evidence could not be loaded.");
  const names = new Map((staff.data ?? []).map((person) => [String(person.id), String(person.full_name)]));
  return {
    rows: (records.data ?? []).map((row) => ({
      id: row.id, staffId: row.staff_id, staffName: names.get(String(row.staff_id)) ?? "Staff member",
      leaveRequestId: row.leave_request_id, leaveMinutes: Number(row.leave_minutes), amountPaidPence: Number(row.amount_paid_pence),
      paidOn: row.paid_on, evidenceNote: row.evidence_note, createdAt: row.created_at, retainedUntil: row.retained_until,
    })),
    approvedLeave: (leave.data ?? []).map((row) => ({
      id: row.id, staffId: row.staff_id, staffName: names.get(String(row.staff_id)) ?? "Staff member",
      startDate: row.start_date, endDate: row.end_date, requestedMinutes: Number(row.requested_minutes),
    })),
  };
}

export async function recordHolidayPayEvidenceAction(_state: { ok: boolean; message: string }, formData: FormData) {
  requireAal2(await requireCommercialIdentity());
  const actor = await requireCustomerDomainActor("payroll.prepare");
  if (actor.kind !== "commercial") return { ok: false, message: "Commercial organisation access is required." };
  const leaveRequestId = String(formData.get("leaveRequestId") ?? "");
  const paidOn = String(formData.get("paidOn") ?? "");
  const evidenceNote = String(formData.get("evidenceNote") ?? "").trim();
  const pounds = String(formData.get("amountPaid") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(leaveRequestId) || !/^\d{4}-\d{2}-\d{2}$/.test(paidOn) || evidenceNote.length < 5 || !/^\d+(?:\.\d{1,2})?$/.test(pounds)) {
    return { ok: false, message: "Choose approved annual leave and enter the payment date, amount paid and an evidence note." };
  }
  const amountPaidPence = Math.round(Number(pounds) * 100);
  if (!Number.isSafeInteger(amountPaidPence) || amountPaidPence < 0) return { ok: false, message: "Enter a valid amount paid." };
  const supabase = await createSupabaseServerClient();
  const leave = await supabase.from("leave_requests").select("staff_id,requested_minutes")
    .eq("organisation_id", actor.context.organisationId).eq("id", leaveRequestId)
    .eq("leave_type", "annual_leave").eq("status", "approved").maybeSingle();
  if (leave.error || !leave.data) return { ok: false, message: "The approved annual leave record is not available." };
  const result = await supabase.from("holiday_pay_records").insert({
    organisation_id: actor.context.organisationId, staff_id: leave.data.staff_id, leave_request_id: leaveRequestId,
    leave_minutes: leave.data.requested_minutes, amount_paid_pence: amountPaidPence, paid_on: paidOn,
    evidence_note: evidenceNote, created_by_membership_id: actor.context.membershipId,
  });
  if (result.error) return { ok: false, message: "Holiday pay evidence could not be recorded." };
  revalidatePath("/leave/records");
  return { ok: true, message: "Holiday pay evidence recorded. The original entry is retained." };
}
