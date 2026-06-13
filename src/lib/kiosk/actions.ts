"use server";

import { revalidatePath } from "next/cache";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { createPublicKioskClient } from "@/lib/kiosk/server";
import { getKioskDeviceToken } from "@/lib/kiosk/device-session";
import { kioskResultMessage, validateKioskPin } from "@/lib/kiosk/security";
import type { KioskActionResult, KioskStatus } from "@/lib/kiosk/types";

type RpcResult = { ok: boolean; code: string; current_status: KioskStatus | null; recorded_at?: string | null };

function rpcResult(row: RpcResult | undefined): KioskActionResult {
  const code = row?.code ?? "request_failed";
  return {
    ok: Boolean(row?.ok),
    code,
    message: kioskResultMessage(code),
    currentStatus: row?.current_status ?? undefined,
    recordedAt: row?.recorded_at ?? undefined,
  };
}

export async function verifyKioskPinAction(staffId: string, pin: string): Promise<KioskActionResult> {
  if (!staffId || !/^\d{4,6}$/.test(pin)) return { ok: false, code: "invalid_pin", message: kioskResultMessage("invalid_pin") };
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) return { ok: false, code: "device_required", message: "This kiosk device is not active." };
  const supabase = createPublicKioskClient();
  const { data, error } = await supabase.rpc("verify_device_kiosk_pin", { device_token: deviceToken, target_staff_id: staffId, candidate_pin: pin });
  if (error) return { ok: false, code: "request_failed", message: kioskResultMessage("request_failed") };
  return rpcResult((data as RpcResult[] | null)?.[0]);
}

export async function changeTemporaryKioskPinAction(input: {
  staffId: string;
  temporaryPin: string;
  newPin: string;
  confirmation: string;
}): Promise<KioskActionResult> {
  if (!input.staffId || !/^\d{4,6}$/.test(input.temporaryPin)) {
    return { ok: false, code: "invalid_pin", message: kioskResultMessage("invalid_pin") };
  }
  if (input.newPin !== input.confirmation) {
    return { ok: false, code: "pin_mismatch", message: "The new PINs do not match." };
  }
  const validation = validateKioskPin(input.newPin);
  if (validation) return { ok: false, code: "weak_pin", message: validation };
  if (input.newPin === input.temporaryPin) {
    return { ok: false, code: "same_pin", message: kioskResultMessage("same_pin") };
  }

  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) return { ok: false, code: "device_required", message: "This kiosk device is not active." };
  const supabase = createPublicKioskClient();
  const { data, error } = await supabase.rpc("change_device_kiosk_pin", {
    device_token: deviceToken,
    target_staff_id: input.staffId,
    temporary_pin: input.temporaryPin,
    new_pin: input.newPin,
  });
  if (error) return { ok: false, code: "request_failed", message: kioskResultMessage("request_failed") };
  return rpcResult((data as RpcResult[] | null)?.[0]);
}

export async function recordKioskEventAction(input: {
  staffId: string;
  pin: string;
  eventType: "clock_in" | "clock_out";
  deviceId?: string;
}): Promise<KioskActionResult> {
  if (!input.staffId || !/^\d{4,6}$/.test(input.pin)) return { ok: false, code: "invalid_pin", message: kioskResultMessage("invalid_pin") };
  const deviceToken = await getKioskDeviceToken();
  if (!deviceToken) return { ok: false, code: "device_required", message: "This kiosk device is not active." };
  const supabase = createPublicKioskClient();
  const { data, error } = await supabase.rpc("record_device_kiosk_clock_event", {
    device_token: deviceToken,
    target_staff_id: input.staffId,
    candidate_pin: input.pin,
    requested_event_type: input.eventType,
  });
  if (error) return { ok: false, code: "request_failed", message: kioskResultMessage("request_failed") };
  const result = rpcResult((data as RpcResult[] | null)?.[0]);
  if (result.ok) {
    revalidatePath("/clock");
    revalidatePath("/attendance");
  }
  return result;
}

export async function saveKioskSettingsAction(_state: KioskActionResult, formData: FormData): Promise<KioskActionResult> {
  await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const enabled = formData.get("kioskEnabled") === "on";
  const resetRequired = formData.get("pinResetRequired") === "on";
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("staff_kiosk_settings").upsert({
    staff_id: staffId,
    kiosk_enabled: enabled,
    pin_reset_required: resetRequired,
  }, { onConflict: "staff_id" });
  if (error) return { ok: false, code: "save_failed", message: "Kiosk settings could not be saved." };
  revalidatePath("/settings/kiosk");
  revalidatePath("/clock");
  return { ok: true, code: "saved", message: "Kiosk settings saved." };
}

export async function setKioskPinAction(_state: KioskActionResult, formData: FormData): Promise<KioskActionResult> {
  await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const pin = String(formData.get("pin") ?? "");
  const requireChange = formData.get("requireChange") === "on";
  const validation = validateKioskPin(pin);
  if (validation) return { ok: false, code: "weak_pin", message: validation };
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("set_staff_kiosk_pin", {
    target_staff_id: staffId,
    new_pin: pin,
    require_change: requireChange,
  });
  if (error) return { ok: false, code: "save_failed", message: "The PIN could not be saved." };
  revalidatePath("/settings/kiosk");
  revalidatePath("/clock");
  return { ok: true, code: "saved", message: "A new kiosk PIN has been saved securely." };
}

export async function addClockCorrectionAction(_state: KioskActionResult, formData: FormData): Promise<KioskActionResult> {
  const account = await requireAccount(["manager"]);
  const staffId = String(formData.get("staffId") ?? "");
  const eventType = String(formData.get("eventType") ?? "");
  const eventTimestamp = String(formData.get("eventTimestamp") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (!staffId || !["clock_in", "clock_out"].includes(eventType) || !eventTimestamp || reason.length < 5) {
    return { ok: false, code: "invalid_correction", message: "Choose an event, time and a clear correction reason." };
  }
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("clock_events").insert({
    staff_id: staffId,
    event_type: eventType,
    event_timestamp: new Date(eventTimestamp).toISOString(),
    event_source: "manager",
    manager_correction: true,
    corrected_by: account.id,
    correction_reason: reason,
  });
  if (error) return { ok: false, code: "save_failed", message: "The correction could not be recorded." };
  revalidatePath("/attendance");
  revalidatePath("/clock");
  return { ok: true, code: "saved", message: "The correction was added without changing the original clock events." };
}
