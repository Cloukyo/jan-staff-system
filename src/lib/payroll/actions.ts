"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type PayrollActionState = { ok: boolean; message: string };
const fail = (message: string): PayrollActionState => ({ ok: false, message });
const ok = (message: string): PayrollActionState => ({ ok: true, message });

function value(formData: FormData, key: string) {
  const result = String(formData.get(key) ?? "").trim();
  return result || null;
}
export async function savePayArrangementAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
  const staffId = value(formData, "staffId");
  const payType = value(formData, "payType");
  const effectiveFrom = value(formData, "effectiveFrom");
  const contractedWeeklyHours = Number(value(formData, "contractedWeeklyHours"));
  if (!staffId || !effectiveFrom || !["hourly", "salaried"].includes(payType ?? "") || !Number.isFinite(contractedWeeklyHours)) {
    return fail("Staff, pay type, effective date and contracted hours are required.");
  }
  const payload = {
    staff_id: staffId,
    pay_type: payType,
    hourly_rate: payType === "hourly" ? Number(value(formData, "hourlyRate")) : null,
    annual_salary: payType === "salaried" && value(formData, "annualSalary") ? Number(value(formData, "annualSalary")) : null,
    monthly_salary: payType === "salaried" && value(formData, "monthlySalary") ? Number(value(formData, "monthlySalary")) : null,
    contracted_weekly_hours: contractedWeeklyHours,
    standard_daily_hours: value(formData, "standardDailyHours") ? Number(value(formData, "standardDailyHours")) : null,
    overtime_multiplier: value(formData, "overtimeMultiplier") ? Number(value(formData, "overtimeMultiplier")) : 1,
    effective_from: effectiveFrom,
    effective_to: value(formData, "effectiveTo"),
    is_active: true,
    manager_notes: value(formData, "managerNotes"),
    created_by: account.id,
    updated_by: account.id,
  };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_pay_arrangements").insert(payload);
  if (error) return fail(error.code === "23P01" ? "This arrangement overlaps an existing active arrangement." : "The pay arrangement could not be saved.");
  revalidatePath("/staff");
  revalidatePath("/payroll");
  return ok("Pay arrangement saved. Existing history was preserved.");
}

export async function closePayArrangementAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
  const arrangementId = value(formData, "arrangementId");
  const effectiveTo = value(formData, "effectiveTo");
  if (!arrangementId || !effectiveTo) return fail("Choose an end date.");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_pay_arrangements")
    .update({ effective_to: effectiveTo, updated_by: account.id })
    .eq("id", arrangementId);
  if (error) return fail("The arrangement could not be closed.");
  revalidatePath("/staff");
  revalidatePath("/payroll");
  return ok("Pay arrangement end date saved.");
}
