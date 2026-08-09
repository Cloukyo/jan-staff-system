import { describe, expect, it } from "vitest";
import { executeOnboardingCommand } from "@/lib/onboarding/service";

const SESSION_ID = "51000000-0000-4000-8000-000000000001";
const IDEMPOTENCY_KEY = "51000000-0000-4000-8000-000000000002";

const command = {
  schemaVersion: 1,
  workflowKey: "commercial_customer_v1",
  workflowVersion: 1,
  sessionId: SESSION_ID,
  commandType: "evaluate_readiness",
  idempotencyKey: IDEMPOTENCY_KEY,
  expectedSessionRevision: "4",
  payload: {},
} as const;

const offlineReadiness = {
  itemKey: "offline_disabled",
  evaluatorVersion: 1,
  severity: "blocker",
  result: "pass",
  reasonCode: "offline_disabled",
  userMessage: "Offline attendance is disabled.",
  repairRoute: null,
  evidenceAt: "2026-08-09T10:30:00+01:00",
  sourceRevision: "commercial_offline_policy:1",
} as const;

function rpcResponse(readinessItem: Record<string, unknown> = offlineReadiness) {
  return {
    commandResult: {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      sessionId: SESSION_ID,
      commandType: "evaluate_readiness",
      outcome: "succeeded",
      dataState: "saved",
      resultCode: "readiness_evaluated",
      resultReference: {},
      sessionRevision: "5",
      issues: [],
    },
    readiness: {
      schemaVersion: 1,
      workflowKey: "commercial_customer_v1",
      workflowVersion: 1,
      evaluatorVersion: 1,
      sessionId: SESSION_ID,
      organisationId: "10000000-0000-4000-8000-000000000001",
      overallStatus: "needs_attention",
      workflowRevision: "5",
      items: [readinessItem],
      evaluatedAt: "2026-08-09T10:30:00+01:00",
    },
  };
}

describe("onboarding command service", () => {
  it("validates a command envelope and accepts matching authoritative RPC evidence", async () => {
    const calls: Array<{ name: string; parameters: Record<string, unknown> }> = [];

    const result = await executeOnboardingCommand(command, {
      rpc: async (name, parameters) => {
        calls.push({ name, parameters });
        return { data: rpcResponse(), error: null };
      },
    });

    expect(calls).toEqual([{
      name: "execute_onboarding_foundation_command",
      parameters: { command_envelope: command },
    }]);
    expect(result.commandResult).toMatchObject({
      outcome: "succeeded",
      dataState: "saved",
      sessionRevision: "5",
    });
    expect(result.readiness).toMatchObject({
      sessionId: SESSION_ID,
      workflowRevision: "5",
    });
  });

  it("rejects invalid versioned input before invoking the database", async () => {
    let calls = 0;
    await expect(executeOnboardingCommand({ ...command, workflowVersion: 2 }, {
      rpc: async () => {
        calls += 1;
        return { data: null, error: null };
      },
    })).rejects.toThrow();
    expect(calls).toBe(0);
  });

  it("returns an indeterminate result without invented readiness after transport ambiguity", async () => {
    const result = await executeOnboardingCommand(command, {
      rpc: async () => ({ data: null, error: { message: "connection closed" } }),
    });

    expect(result).toEqual({
      commandResult: {
        schemaVersion: 1,
        workflowKey: "commercial_customer_v1",
        workflowVersion: 1,
        sessionId: SESSION_ID,
        commandType: "evaluate_readiness",
        outcome: "indeterminate",
        dataState: "unknown",
        resultCode: "command_state_indeterminate",
        resultReference: {},
        sessionRevision: "4",
        issues: [{
          code: "reconciliation_required",
          message: "The command result could not be confirmed. Retry with the same request key.",
          fieldPath: [],
          repairRoute: null,
        }],
      },
      readiness: null,
    });
  });

  it("rejects not_applicable for the mandatory offline-disabled blocker", async () => {
    const result = await executeOnboardingCommand(command, {
      rpc: async () => ({
        data: rpcResponse({
          ...offlineReadiness,
          result: "not_applicable",
          reasonCode: "not_applicable",
        }),
        error: null,
      }),
    });

    expect(result.commandResult).toMatchObject({
      outcome: "indeterminate",
      dataState: "unknown",
      resultCode: "invalid_authoritative_response",
    });
    expect(result.readiness).toBeNull();
  });

  it("preserves a tenant-safe permission denial without requiring readiness disclosure", async () => {
    const denied = await executeOnboardingCommand(command, {
      rpc: async () => ({
        data: {
          commandResult: {
            schemaVersion: 1,
            workflowKey: "commercial_customer_v1",
            workflowVersion: 1,
            sessionId: SESSION_ID,
            commandType: "evaluate_readiness",
            outcome: "permission_denied",
            dataState: "not_saved",
            resultCode: "permission_denied",
            resultReference: {},
            sessionRevision: "4",
            issues: [{
              code: "permission_denied",
              message: "This onboarding command is not available.",
              fieldPath: [],
              repairRoute: null,
            }],
          },
          readiness: null,
        },
        error: null,
      }),
    });

    expect(denied.commandResult).toMatchObject({
      outcome: "permission_denied",
      resultCode: "permission_denied",
    });
    expect(denied.readiness).toBeNull();
  });
});
