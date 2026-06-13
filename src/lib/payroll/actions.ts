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
  const hoursBasis = value(formData, "hoursBasis") ?? "contracted";
  const contractedValue = value(formData, "contractedWeeklyHours");
  const contractedWeeklyHours = contractedValue ? Number(contractedValue) : null;
  const hourlyRate = value(formData, "hourlyRate");
  const annualSalary = value(formData, "annualSalary");
  const monthlySalary = value(formData, "monthlySalary");
  if (!staffId || !effectiveFrom || !["hourly", "salaried"].includes(payType ?? "")
    || !["contracted", "variable_hours", "casual", "zero_hours", "salaried_untracked"].includes(hoursBasis)
    || (hoursBasis === "contracted" && (!contractedWeeklyHours || contractedWeeklyHours <= 0))) {
    return fail("Staff, pay type, effective date and contracted hours or an hours exception are required.");
  }
  if (payType === "hourly" && (!hourlyRate || Number(hourlyRate) <= 0)) return fail("Enter a valid hourly rate.");
  if (payType === "salaried" && !((annualSalary && Number(annualSalary) > 0) || (monthlySalary && Number(monthlySalary) > 0))) {
    return fail("Enter an annual or monthly salary basis.");
  }
  const payload = {
    staff_id: staffId,
    pay_type: payType,
    hourly_rate: payType === "hourly" ? Number(hourlyRate) : null,
    annual_salary: payType === "salaried" && annualSalary ? Number(annualSalary) : null,
    monthly_salary: payType === "salaried" && monthlySalary ? Number(monthlySalary) : null,
    contracted_weekly_hours: contractedWeeklyHours,
    hours_basis: hoursBasis,
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
  revalidatePath("/payroll/arrangements");
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
  revalidatePath("/payroll/arrangements");
  revalidatePath("/payroll");
  return ok("Pay arrangement end date saved.");
}
