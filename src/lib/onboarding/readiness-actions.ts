"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { goLivePayloadSchema } from "./readiness-contracts";
import { executeOnboardingBootstrapCommandServer, loadOnboardingBootstrapServer } from "./server";

export type ReadinessActionState = { ok: boolean; code: string; message: string };

async function execute(type: "evaluate_readiness" | "go_live", payload: unknown, formData: FormData) {
  requireAal2(await requireCommercialIdentity());
  const snapshot = await loadOnboardingBootstrapServer();
  return executeOnboardingBootstrapCommandServer({
    schemaVersion: 1,
    workflowKey: "commercial_customer_v1",
    workflowVersion: 1,
    sessionId: snapshot.session.id,
    commandType: type,
    idempotencyKey: String(formData.get("idempotencyKey") || randomUUID()),
    expectedSessionRevision: String(formData.get("expectedSessionRevision") || snapshot.session.revision),
    payload,
  });
}

export async function refreshReadinessAction(_state: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const response = await execute("evaluate_readiness", {}, formData);
  const ok = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  revalidatePath("/onboarding/readiness");
  return { ok, code: response.commandResult.resultCode, message: ok ? "Readiness was checked against your current setup." : (response.commandResult.issues[0]?.message ?? "Readiness could not be confirmed.") };
}

export async function goLiveAction(_state: ReadinessActionState, formData: FormData): Promise<ReadinessActionState> {
  const parsed = goLivePayloadSchema.safeParse({
    readinessFingerprint: String(formData.get("readinessFingerprint") || ""),
    acknowledgedWarnings: formData.get("soleManagerAcknowledged") === "yes" ? ["sole_manager"] : [],
  });
  if (!parsed.success) return { ok: false, code: "confirmation_required", message: "Nothing was saved. Review the confirmation and try again." };
  const response = await execute("go_live", parsed.data, formData);
  if (["succeeded", "replayed"].includes(response.commandResult.outcome)) redirect("/commercial/welcome");
  revalidatePath("/onboarding/readiness");
  return { ok: false, code: response.commandResult.resultCode, message: response.commandResult.issues[0]?.message ?? "Nothing was saved. Review setup and try again." };
}
