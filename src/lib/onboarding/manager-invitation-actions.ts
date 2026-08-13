"use server";
import { randomUUID } from "node:crypto";
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
import { managerInvitationPayloadSchema } from "./manager-invitation-contracts";
const empty: OnboardingFormState = {
  ok: false,
  code: "",
  message: "",
  fieldErrors: {},
  values: {},
};
async function execute(
  commandType:
    | "create_manager_invitation"
    | "resend_manager_invitation"
    | "revoke_manager_invitation"
    | "acknowledge_sole_manager"
    | "complete_manager_invitation_step",
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
function state(
  response: Awaited<ReturnType<typeof execute>>,
  message: string,
  values: Record<string, string> = {},
  continuationUrl?: string,
): OnboardingFormState {
  const ok = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  return {
    ...empty,
    ok,
    code: response.commandResult.resultCode,
    message: ok
      ? message
      : (response.commandResult.issues[0]?.message ??
        "Nothing was saved. Reload and try again."),
    values,
    continuationUrl,
  };
}

async function previewInvitationUrl(
  response: Awaited<ReturnType<typeof execute>>,
): Promise<string | undefined> {
  if (
    !["preview", "local"].includes(process.env.APP_ENV ?? "") ||
    !hasSupabaseAdminConfig()
  )
    return undefined;
  const invitationId = (
    response.commandResult.resultReference as { invitationIds?: string[] }
  ).invitationIds?.[0];
  if (!invitationId) return undefined;
  const { data, error } = await createSupabaseAdminClient().rpc(
    "preview_manager_invitation_token",
    { invitation_id_value: invitationId },
  );
  const token =
    !error && data && typeof data === "object" && "invitationToken" in data
      ? data.invitationToken
      : null;
  return typeof token === "string" && /^[A-Fa-f0-9]{64}$/.test(token)
    ? `/invitations/manager?token=${encodeURIComponent(token)}`
    : undefined;
}
export async function createManagerInvitationAction(
  _previous: OnboardingFormState,
  formData: FormData,
): Promise<OnboardingFormState> {
  const values = {
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? ""),
    scopeType: String(formData.get("scopeType") ?? ""),
  };
  const parsed = managerInvitationPayloadSchema.safeParse({
    ...values,
    siteIds: formData.getAll("siteIds").map(String),
  });
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues)
      fieldErrors[issue.path.join(".")] ??= issue.message;
    return {
      ...empty,
      code: "validation_failed",
      message: "Nothing was saved. Check the highlighted invitation details.",
      fieldErrors,
      values,
    };
  }
  const response = await execute(
    "create_manager_invitation",
    parsed.data,
    formData,
  );
  const continuationUrl =
    response.commandResult.outcome === "succeeded"
      ? await previewInvitationUrl(response)
      : undefined;
  revalidatePath("/onboarding/managers");
  return state(
    response,
    "Invitation queued safely.",
    response.commandResult.outcome === "succeeded" ? {} : values,
    continuationUrl,
  );
}
export async function mutateManagerInvitationAction(
  formData: FormData,
): Promise<void> {
  const command =
    formData.get("intent") === "resend"
      ? "resend_manager_invitation"
      : "revoke_manager_invitation";
  const response = await execute(
    command,
    { invitationId: String(formData.get("invitationId")) },
    formData,
  );
  if (!["succeeded", "replayed"].includes(response.commandResult.outcome))
    redirect(
      `/onboarding/managers?error=${encodeURIComponent(response.commandResult.resultCode)}`,
    );
  revalidatePath("/onboarding/managers");
}
export async function finishManagerInvitationsAction(
  formData: FormData,
): Promise<void> {
  const acknowledge = formData.get("intent") === "sole_manager";
  const response = await execute(
    acknowledge
      ? "acknowledge_sole_manager"
      : "complete_manager_invitation_step",
    acknowledge ? { acknowledgement: "sole_manager_for_now" } : {},
    formData,
  );
  if (["succeeded", "replayed"].includes(response.commandResult.outcome))
    redirect("/onboarding/staff-invitations");
  redirect(
    `/onboarding/managers?error=${encodeURIComponent(response.commandResult.resultCode)}`,
  );
}
