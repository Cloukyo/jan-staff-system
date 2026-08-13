import { z } from "zod";
import {
  onboardingBootstrapCommandSchema,
  onboardingBootstrapSnapshotSchema,
  onboardingCommandResultSchema,
  onboardingReadinessSnapshotSchema,
  type OnboardingBootstrapSnapshot,
} from "./contracts";

type RpcResult = Promise<{ data: unknown; error: { message?: string } | null }>;

export type OnboardingBootstrapRpc = (
  name: "get_or_create_onboarding_bootstrap" | "execute_onboarding_bootstrap_command",
  parameters?: { command_envelope: unknown },
) => RpcResult;

export type OnboardingBootstrapDependencies = { rpc: OnboardingBootstrapRpc };

const commandResponseSchema = z.object({
  commandResult: onboardingCommandResultSchema,
  readiness: onboardingReadinessSnapshotSchema.nullable(),
  bootstrap: onboardingBootstrapSnapshotSchema.nullable(),
}).strict();

export async function loadOnboardingBootstrap(
  dependencies: OnboardingBootstrapDependencies,
): Promise<OnboardingBootstrapSnapshot> {
  const result = await dependencies.rpc("get_or_create_onboarding_bootstrap");
  if (result.error) throw new Error("Authoritative onboarding state could not be loaded.");
  const parsed = onboardingBootstrapSnapshotSchema.safeParse(result.data);
  if (!parsed.success) throw new Error("The authoritative onboarding response was invalid.");
  return parsed.data;
}

export async function executeOnboardingBootstrapCommand(
  input: unknown,
  dependencies: OnboardingBootstrapDependencies,
) {
  const command = onboardingBootstrapCommandSchema.parse(input);
  if (![
    "accept_legal_documents",
    "create_organisation",
    "save_step_draft",
    "create_first_site",
    "select_plan",
    "save_staff_draft",
    "create_staff",
    "preview_staff_import",
    "review_staff_import_row",
    "commit_staff_import",
    "complete_staffing",
    "skip_staffing",
    "create_manager_invitation",
    "resend_manager_invitation",
    "revoke_manager_invitation",
    "acknowledge_sole_manager",
    "complete_manager_invitation_step",
  ].includes(command.commandType)) {
    throw new Error("This command is not part of the available onboarding milestones.");
  }
  const result = await dependencies.rpc("execute_onboarding_bootstrap_command", {
    command_envelope: command,
  });
  if (result.error) throw new Error("The onboarding command result could not be confirmed.");
  const parsed = commandResponseSchema.safeParse(result.data);
  if (!parsed.success
    || parsed.data.commandResult.sessionId !== command.sessionId
    || parsed.data.commandResult.commandType !== command.commandType
    || (parsed.data.bootstrap !== null
      && BigInt(parsed.data.bootstrap.session.revision) < BigInt(parsed.data.commandResult.sessionRevision))) {
    throw new Error("The authoritative response was invalid.");
  }
  return parsed.data;
}
