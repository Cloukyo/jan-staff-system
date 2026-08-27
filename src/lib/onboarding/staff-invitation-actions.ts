"use server";
import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import {
  createSupabaseAdminClient,
  hasSupabaseAdminConfig,
} from "@/lib/auth/supabase-admin";
import type { OnboardingFormState } from "./actions";
import {
  executeOnboardingBootstrapCommandServer,
  loadOnboardingBootstrapServer,
} from "./server";
import { staffInvitationSelectionPayloadSchema } from "./staff-invitation-contracts";

async function execute(
  commandType:
    | "create_staff_invitations"
    | "resend_staff_invitation"
    | "revoke_staff_invitation"
    | "skip_staff_invitation_step"
    | "complete_staff_invitation_step",
  payload: unknown,
  formData: FormData,
) {
  requireAal2(await requireCommercialIdentity());
  const snapshot = await loadOnboardingBootstrapServer();
  return executeOnboardingBootstrapCommandServer({
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: snapshot.session.id,
    commandType,
    idempotencyKey: String(formData.get("idempotencyKey") || randomUUID()),
    expectedSessionRevision: String(
      formData.get("expectedSessionRevision") || snapshot.session.revision,
    ),
    payload,
  });
}
async function previewUrl(response: Awaited<ReturnType<typeof execute>>) {
  if (
    !["preview", "local"].includes(process.env.APP_ENV ?? "") ||
    !hasSupabaseAdminConfig()
  )
    return undefined;
  const id = (
    response.commandResult.resultReference as { invitationIds?: string[] }
  ).invitationIds?.[0];
  if (!id) return undefined;
  const { data, error } = await createSupabaseAdminClient().rpc(
    "preview_staff_invitation_token",
    { invitation_id_value: id },
  );
  const token =
    !error && data && typeof data === "object" && "invitationToken" in data
      ? data.invitationToken
      : null;
  return typeof token === "string" && /^[A-Fa-f0-9]{64}$/.test(token)
    ? `/invitations/staff?token=${encodeURIComponent(token)}`
    : undefined;
}
export async function createStaffInvitationsAction(
  _state: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const staffIds = formData.getAll("staffIds").map(String).toSorted();
  const parsed = staffInvitationSelectionPayloadSchema.safeParse({
    staffIds,
    reviewedSetHash: createHash("sha256")
      .update(staffIds.join("\n"))
      .digest("hex"),
  });
  if (!parsed.success)
    return {
      ok: false,
      code: "validation_failed",
      message: "Nothing was saved. Select at least one eligible staff member.",
      fieldErrors: { staffIds: "Select at least one staff member" },
      values: {},
    };
  const response = await execute(
    "create_staff_invitations",
    parsed.data,
    formData,
  );
  const ok = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  revalidatePath("/onboarding/staff-invitations");
  return {
    ok,
    code: response.commandResult.resultCode,
    message: ok
      ? "Staff invitations queued safely."
      : (response.commandResult.issues[0]?.message ?? "Nothing was saved."),
    fieldErrors: {},
    values: {},
    continuationUrl: ok ? await previewUrl(response) : undefined,
  };
}
export async function mutateStaffInvitationAction(formData: FormData) {
  const response = await execute(
    formData.get("intent") === "resend"
      ? "resend_staff_invitation"
      : "revoke_staff_invitation",
    { invitationId: String(formData.get("invitationId")) },
    formData,
  );
  if (!["succeeded", "replayed"].includes(response.commandResult.outcome))
    redirect(
      `/onboarding/staff-invitations?error=${encodeURIComponent(response.commandResult.resultCode)}`,
    );
  revalidatePath("/onboarding/staff-invitations");
}
export async function finishStaffInvitationsAction(formData: FormData) {
  const skip = formData.get("intent") === "skip";
  const response = await execute(
    skip ? "skip_staff_invitation_step" : "complete_staff_invitation_step",
    skip ? { acknowledgement: "invite_staff_later" } : {},
    formData,
  );
  if (["succeeded", "replayed"].includes(response.commandResult.outcome))
    redirect("/onboarding/kiosk");
  redirect(
    `/onboarding/staff-invitations?error=${encodeURIComponent(response.commandResult.resultCode)}`,
  );
}
