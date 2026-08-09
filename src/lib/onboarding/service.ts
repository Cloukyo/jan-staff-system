import { z } from "zod";
import {
  ONBOARDING_REQUIRED_READINESS_BLOCKERS,
  onboardingCommandResultSchema,
  onboardingCommandSchema,
  onboardingReadinessSnapshotSchema,
  type OnboardingCommand,
  type OnboardingCommandResult,
  type OnboardingReadinessSnapshot,
} from "./contracts";

export type OnboardingRpc = (
  name: "execute_onboarding_foundation_command",
  parameters: { command_envelope: OnboardingCommand },
) => Promise<{ data: unknown; error: { message?: string } | null }>;

export type OnboardingServiceDependencies = {
  rpc: OnboardingRpc;
};

export type OnboardingServiceResult = {
  commandResult: OnboardingCommandResult;
  readiness: OnboardingReadinessSnapshot | null;
};

const authoritativeResponseSchema = z.object({
  commandResult: onboardingCommandResultSchema,
  readiness: onboardingReadinessSnapshotSchema.nullable(),
}).strict();

function indeterminateResult(
  command: OnboardingCommand,
  resultCode: "command_state_indeterminate" | "invalid_authoritative_response",
): OnboardingServiceResult {
  return {
    commandResult: onboardingCommandResultSchema.parse({
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      sessionId: command.sessionId,
      commandType: command.commandType,
      outcome: "indeterminate",
      dataState: "unknown",
      resultCode,
      resultReference: {},
      sessionRevision: command.expectedSessionRevision,
      issues: [{
        code: "reconciliation_required",
        message: "The command result could not be confirmed. Retry with the same request key.",
        fieldPath: [],
        repairRoute: null,
      }],
    }),
    readiness: null,
  };
}

function responseMatchesCommand(
  command: OnboardingCommand,
  response: z.infer<typeof authoritativeResponseSchema>,
): boolean {
  const { commandResult, readiness } = response;
  if (commandResult.sessionId !== command.sessionId
    || commandResult.commandType !== command.commandType) {
    return false;
  }

  if (readiness === null) {
    return commandResult.outcome === "permission_denied";
  }

  if (readiness.sessionId !== command.sessionId
    || readiness.workflowRevision !== commandResult.sessionRevision) {
    return false;
  }

  return !readiness.items.some((item) => (
    ONBOARDING_REQUIRED_READINESS_BLOCKERS.some((key) => key === item.itemKey)
    && item.result === "not_applicable"
  ));
}

export async function executeOnboardingCommand(
  input: unknown,
  dependencies: OnboardingServiceDependencies,
): Promise<OnboardingServiceResult> {
  const command = onboardingCommandSchema.parse(input);
  const rpcResult = await dependencies.rpc("execute_onboarding_foundation_command", {
    command_envelope: command,
  });

  if (rpcResult.error) {
    return indeterminateResult(command, "command_state_indeterminate");
  }

  const parsed = authoritativeResponseSchema.safeParse(rpcResult.data);
  if (!parsed.success || !responseMatchesCommand(command, parsed.data)) {
    return indeterminateResult(command, "invalid_authoritative_response");
  }

  return parsed.data;
}
