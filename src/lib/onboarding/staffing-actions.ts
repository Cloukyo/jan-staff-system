"use server";

import { createHash, randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireAal2 } from "@/lib/commercial-identity/guards";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import type { OnboardingFormState } from "./actions";
import { executeOnboardingBootstrapCommandServer, loadOnboardingBootstrapServer } from "./server";
import { manualStaffDraftPayloadSchema, manualStaffPayloadSchema } from "./staffing-contracts";
import { parseStaffingCsv } from "./staffing-csv";

const empty: OnboardingFormState = { ok: false, code: "", message: "", fieldErrors: {}, values: {} };

async function execute(commandType: "save_staff_draft" | "create_staff" | "preview_staff_import" | "review_staff_import_row" | "commit_staff_import" | "complete_staffing" | "skip_staffing", payload: unknown, formData: FormData) {
  requireAal2(await requireCommercialIdentity());
  const snapshot = await loadOnboardingBootstrapServer();
  return executeOnboardingBootstrapCommandServer({
    schemaVersion: 1, workflowKey: "commercial_customer_v1", workflowVersion: 1,
    sessionId: snapshot.session.id, commandType,
    idempotencyKey: String(formData.get("idempotencyKey") || randomUUID()),
    expectedSessionRevision: String(formData.get("expectedSessionRevision") || snapshot.session.revision), payload,
  });
}

function resultState(response: Awaited<ReturnType<typeof execute>>, successMessage: string): OnboardingFormState {
  const succeeded = ["succeeded", "replayed"].includes(response.commandResult.outcome);
  return succeeded
    ? { ...empty, ok: true, code: response.commandResult.resultCode, message: successMessage }
    : { ...empty, code: response.commandResult.resultCode, message: response.commandResult.issues[0]?.message ?? "Nothing was saved. Reload and try again." };
}

export async function createInitialStaffAction(_state: OnboardingFormState, formData: FormData): Promise<OnboardingFormState> {
  const values = Object.fromEntries(["externalStaffId","fullName","displayName","email","employmentStatus","startDate","jobRole"].map((key) => [key, String(formData.get(key) ?? "")]));
  values.attendanceEligible = formData.get("attendanceEligible") === "yes" ? "true" : "false";
  if (formData.get("intent") === "save_draft") {
    const draft = manualStaffDraftPayloadSchema.parse({ ...values, attendanceEligible: formData.get("attendanceEligible") === "yes" });
    const response = await execute("save_staff_draft", draft, formData);
    revalidatePath("/onboarding/staffing");
    return { ...resultState(response, "Draft saved. No staff record was created."), values };
  }
  const parsed = manualStaffPayloadSchema.safeParse({ ...values, attendanceEligible: formData.get("attendanceEligible") === "yes" });
  if (!parsed.success) {
    const fieldErrors: Record<string,string> = {};
    for (const issue of parsed.error.issues) fieldErrors[issue.path.join(".")] ??= issue.message;
    return { ...empty, code: "validation_failed", message: "Nothing was saved. Check the highlighted fields.", fieldErrors, values };
  }
  const response = await execute("create_staff", parsed.data, formData);
  revalidatePath("/onboarding/staffing");
  return { ...resultState(response, "Staff member added safely."), values: response.commandResult.outcome === "succeeded" ? {} : values };
}

export async function uploadStaffingCsvAction(_state: OnboardingFormState, formData: FormData): Promise<OnboardingFormState> {
  const file = formData.get("staffFile");
  if (!(file instanceof File)) return { ...empty, code: "file_required", message: "Choose a CSV file to review." };
  try {
    const payload = await parseStaffingCsv(file);
    const response = await execute("preview_staff_import", payload, formData);
    revalidatePath("/onboarding/staffing");
    return resultState(response, "The file was validated. Review every flagged row before importing.");
  } catch (error) {
    const code = error instanceof Error ? error.message : "invalid_file";
    return { ...empty, code, message: "Nothing was imported. Use the template and check the file format, dates, and attendance values." };
  }
}

export async function reviewStaffingRowAction(formData: FormData): Promise<void> {
  await execute("review_staff_import_row", {
    batchId: String(formData.get("batchId")), rowId: String(formData.get("rowId")), decision: String(formData.get("decision")),
  }, formData);
  revalidatePath("/onboarding/staffing");
}

export async function commitStaffingImportAction(formData: FormData): Promise<void> {
  const snapshot = await loadOnboardingBootstrapServer();
  const batch = snapshot.staffing.activeBatch;
  if (!batch) return;
  const reviewedSetHash = createHash("sha256").update(batch.rows
    .map(({ id, decision }) => `${id}:${decision}`).sort().join(",")).digest("hex");
  const response = await execute("commit_staff_import", { batchId: batch.id, reviewedSetHash }, formData);
  if (!["succeeded", "replayed"].includes(response.commandResult.outcome)) redirect(`/onboarding/staffing?error=${encodeURIComponent(response.commandResult.resultCode)}`);
  revalidatePath("/onboarding/staffing");
}

export async function finishStaffingAction(formData: FormData): Promise<void> {
  const command = formData.get("intent") === "skip" ? "skip_staffing" : "complete_staffing";
  const payload = command === "skip_staffing" ? { acknowledgement: "staffing_not_ready" } : {};
  const response = await execute(command, payload, formData);
  if (["succeeded", "replayed"].includes(response.commandResult.outcome)) redirect("/onboarding/next");
  redirect(`/onboarding/staffing?error=${encodeURIComponent(response.commandResult.resultCode)}`);
}
