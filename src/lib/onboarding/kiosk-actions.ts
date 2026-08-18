"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { createPublicKioskClient } from "@/lib/kiosk/server";
import { setKioskDeviceCookie } from "@/lib/kiosk/device-session";
import {
  kioskClaimPayloadSchema,
  kioskPinSetupPayloadSchema,
  kioskRegistrationPayloadSchema,
} from "./kiosk-contracts";
import {
  executeOnboardingBootstrapCommandServer,
  loadOnboardingBootstrapServer,
} from "./server";

export type KioskSetupActionState = {
  ok: boolean;
  code: string;
  message: string;
  oneTimeRegistrationCode?: string;
  registrationId?: string;
  registrationExpiresAt?: string;
  enteredRegistrationCode?: string;
};

const initialFailure = (code: string, message: string): KioskSetupActionState => ({
  ok: false,
  code,
  message,
});

async function execute(commandType: "start_kiosk_registration" | "replace_kiosk_registration" | "revoke_kiosk_device" | "set_kiosk_staff_pin" | "confirm_kiosk_connection", payload: unknown, formData: FormData) {
  requireAal2(await requireCommercialIdentity());
  const snapshot = await loadOnboardingBootstrapServer();
  return executeOnboardingBootstrapCommandServer({
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: snapshot.session.id,
    commandType,
    idempotencyKey: String(formData.get("idempotencyKey") || randomUUID()),
    expectedSessionRevision: String(formData.get("expectedSessionRevision") || snapshot.session.revision),
    payload,
  });
}

export async function mutateKioskRegistrationAction(_state: KioskSetupActionState, formData: FormData): Promise<KioskSetupActionState> {
  const intent = formData.get("intent") === "replace" ? "replace_kiosk_registration" : "revoke_kiosk_device";
  const registrationId = String(formData.get("registrationId") || "");
  const response = await execute(intent, { registrationId }, formData);
  const ok = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  revalidatePath("/onboarding/kiosk");
  return { ok, code: response.commandResult.resultCode, message: ok ? (intent === "replace_kiosk_registration" ? "The old credential is revoked. Register the replacement with the new one-time code." : "The device credential was revoked immediately.") : (response.commandResult.issues[0]?.message ?? "Nothing was saved."), oneTimeRegistrationCode: response.oneTimeRegistrationCode, registrationId: response.commandResult.resultReference.kioskRegistrationId, registrationExpiresAt: response.registrationExpiresAt };
}

export async function completeKioskSetupAction(formData: FormData) {
  const response = await execute("confirm_kiosk_connection", {}, formData);
  if (["succeeded", "replayed"].includes(response.commandResult.outcome)) redirect("/onboarding/next");
  redirect(`/onboarding/kiosk?error=${encodeURIComponent(response.commandResult.resultCode)}`);
}

export async function startKioskRegistrationAction(_state: KioskSetupActionState, formData: FormData): Promise<KioskSetupActionState> {
  const parsed = kioskRegistrationPayloadSchema.safeParse({ siteId: String(formData.get("siteId") || ""), deviceName: String(formData.get("deviceName") || "") });
  if (!parsed.success) return initialFailure("validation_failed", "Nothing was saved. Choose a site and enter a recognisable device name.");
  const response = await execute("start_kiosk_registration", parsed.data, formData);
  const ok = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  if (!ok) return initialFailure(response.commandResult.resultCode, response.commandResult.issues[0]?.message ?? "Nothing was saved.");
  revalidatePath("/onboarding/kiosk");
  return {
    ok: true,
    code: response.commandResult.resultCode,
    message: response.oneTimeRegistrationCode ? "Registration code created. It is shown once only." : "The registration already exists. Create a replacement code if the original was lost.",
    oneTimeRegistrationCode: response.oneTimeRegistrationCode,
    registrationId: response.commandResult.resultReference.kioskRegistrationId,
    registrationExpiresAt: response.registrationExpiresAt,
  };
}

export async function setKioskStaffPinAction(_state: KioskSetupActionState, formData: FormData): Promise<KioskSetupActionState> {
  const parsed = kioskPinSetupPayloadSchema.safeParse({ staffId: String(formData.get("staffId") || ""), temporaryPin: String(formData.get("temporaryPin") || "") });
  if (!parsed.success) return initialFailure("validation_failed", "Nothing was saved. Enter a stronger PIN of four to six digits.");
  const response = await execute("set_kiosk_staff_pin", parsed.data, formData);
  const ok = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  revalidatePath("/onboarding/kiosk");
  return { ok, code: response.commandResult.resultCode, message: ok ? "PIN readiness saved securely. The PIN cannot be viewed again." : (response.commandResult.issues[0]?.message ?? "Nothing was saved.") };
}

export async function claimCommercialKioskAction(_state: KioskSetupActionState, formData: FormData): Promise<KioskSetupActionState> {
  const registrationId = String(formData.get("registrationId") || "");
  const enteredRegistrationCode = String(formData.get("registrationSecret") || "").slice(0, 19);
  const parsed = kioskClaimPayloadSchema.safeParse({ registrationId, registrationSecret: enteredRegistrationCode.toUpperCase().replace(/\s/g, ""), claimantNonce: String(formData.get("claimantNonce") || "") });
  if (!parsed.success) return { ...initialFailure("invalid_code", "Open the current registration link and check the 16-character code."), enteredRegistrationCode };
  const { data, error } = await createPublicKioskClient().rpc("claim_commercial_kiosk", { registration_id: parsed.data.registrationId, registration_secret: parsed.data.registrationSecret, claimant_nonce: parsed.data.claimantNonce });
  if (error || !data || typeof data !== "object") return { ...initialFailure("connection_problem", "The kiosk could not connect. Check Wi-Fi and try again."), enteredRegistrationCode };
  const result = data as { outcome?: string; deviceToken?: string; expiresAt?: string };
  if (!["claimed", "recovered"].includes(result.outcome ?? "") || !result.deviceToken || !result.expiresAt) return { ...initialFailure(result.outcome ?? "claim_failed", result.outcome === "expired" ? "This code has expired. Ask the manager to create a new one." : result.outcome === "already_claimed" ? "This code was already used on another device." : result.outcome === "rate_limited" ? "Too many attempts. Wait five minutes before trying again." : "The code was not recognised."), enteredRegistrationCode };
  await setKioskDeviceCookie(result.deviceToken, new Date(result.expiresAt));
  redirect("/clock");
}
