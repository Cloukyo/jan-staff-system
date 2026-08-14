"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { commercialAdminCommandNameSchema } from "./contracts";
import { executeCommercialAdminCommandServer } from "./server";

export type CommercialAdminActionState = { ok: boolean; message: string; oneTimeCode?: string };
export const initialCommercialAdminActionState: CommercialAdminActionState = { ok: false, message: "" };

function scalar(value: FormDataEntryValue): string | boolean {
  const text = String(value).trim();
  if (text === "true") return true;
  if (text === "false") return false;
  return text;
}

function secureCode(length: number): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(randomBytes(length), (value) => alphabet[value % alphabet.length]).join("");
}

function messageFor(outcome: string, code?: string) {
  if (outcome === "success") return "Saved. The change is now active.";
  if (outcome === "workflow_changed") return "This page is out of date. Reload it before trying again.";
  if (outcome === "upgrade_required") return "Your current plan does not include more of this resource. Review your plan before continuing.";
  if (outcome === "mfa_required") return "Multi-factor authentication is required for this change.";
  if (outcome === "permission_denied") return "You do not have permission to make this change.";
  if (code === "last_active_owner") return "The final active organisation owner cannot be removed.";
  if (code === "site_in_use") return "This site still has active staff assignments or a clocking-in device.";
  if (outcome === "idempotency_conflict") return "This request changed while it was being retried. Reload and try again.";
  return "Nothing was changed. Check the details and try again.";
}

export async function commercialAdminAction(
  _state: CommercialAdminActionState,
  formData: FormData,
): Promise<CommercialAdminActionState> {
  const command = commercialAdminCommandNameSchema.safeParse(String(formData.get("commandName") ?? ""));
  const expectedRevision = Number(formData.get("expectedRevision"));
  if (!command.success || !Number.isSafeInteger(expectedRevision) || expectedRevision < 1) return { ok: false, message: "This page is out of date. Reload it before trying again." };

  const payload: Record<string, unknown> = {};
  for (const [key, value] of formData.entries()) {
    if (["commandName", "expectedRevision", "idempotencyKey"].includes(key)) continue;
    payload[key] = scalar(value);
  }

  let oneTimeCode: string | undefined;
  if (["create_manager_invitation", "create_staff_invitation", "resend_invitation"].includes(command.data)) {
    const token = randomBytes(32).toString("hex");
    payload.tokenHash = createHash("sha256").update(token).digest("hex");
    const invitationKind = command.data === "create_staff_invitation" || payload.invitationKind === "staff" ? "staff" : "manager";
    delete payload.invitationKind;
    oneTimeCode = `/invitations/${invitationKind}?token=${encodeURIComponent(token)}`;
  }
  if (["start_kiosk_registration", "replace_kiosk_device"].includes(command.data)) {
    oneTimeCode = secureCode(16);
    payload.secretHash = createHash("sha256").update(oneTimeCode).digest("hex");
  }

  try {
    const result = await executeCommercialAdminCommandServer({
      commandName: command.data,
      payload,
      expectedRevision,
      idempotencyKey: String(formData.get("idempotencyKey") || crypto.randomUUID()),
    });
    if (result.outcome === "success") {
      revalidatePath("/admin", "layout");
      return { ok: true, message: messageFor(result.outcome, result.code), oneTimeCode };
    }
    return { ok: false, message: messageFor(result.outcome, "code" in result ? result.code : undefined) };
  } catch {
    return { ok: false, message: "The change could not be confirmed. Nothing should be retried until you reload this page." };
  }
}
