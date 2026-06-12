"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { clearKioskDeviceCookie, createKioskDeviceToken, setKioskDeviceCookie } from "@/lib/kiosk/device-session";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import type { PayrollActionState } from "@/lib/payroll/actions";

export async function activateKioskDeviceAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
  const deviceName = String(formData.get("deviceName") ?? "").trim();
  if (deviceName.length < 3 || deviceName.length > 100) {
    return { ok: false, message: "Enter a recognisable device name." };
  }
  const { token, tokenHash, expiresAt } = createKioskDeviceToken();
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("kiosk_devices").insert({
    device_name: deviceName,
    token_hash: `\\x${tokenHash}`,
    expires_at: expiresAt.toISOString(),
    activated_by: account.id,
  });
  if (error) return { ok: false, message: "This device could not be activated." };
  await supabase.auth.signOut();
  await setKioskDeviceCookie(token, expiresAt);
  redirect("/clock");
}

export async function revokeKioskDeviceAction(_state: PayrollActionState, formData: FormData): Promise<PayrollActionState> {
  const account = await requireAccount(["manager"]);
  const deviceId = String(formData.get("deviceId") ?? "");
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.from("kiosk_devices").update({
    active: false,
    revoked_by: account.id,
    revoked_at: new Date().toISOString(),
  }).eq("id", deviceId).eq("active", true);
  if (error) return { ok: false, message: "Kiosk access could not be revoked." };
  revalidatePath("/settings/kiosk");
  return { ok: true, message: "Kiosk device access revoked." };
}

export async function exitKioskModeAction() {
  await clearKioskDeviceCookie();
  redirect("/login");
}
