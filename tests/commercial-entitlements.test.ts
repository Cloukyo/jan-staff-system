import { describe, expect, it } from "vitest";
import {
  capabilityDecisionSchema,
  evaluateCapabilityDecision,
  requireCapabilityDecision,
  CapabilityDeniedError,
  loadCapabilityDecision,
  requireCapability,
} from "@/lib/commercial/entitlements";

describe("commercial capability decisions", () => {
  it("evaluates boolean and usage-limited capabilities from authoritative values", () => {
    expect(evaluateCapabilityDecision({
      capabilityKey: "attendance.core",
      valueType: "boolean",
      booleanValue: true,
      integerValue: null,
      currentUsage: null,
    })).toMatchObject({ allowed: true, decisionCode: "allowed" });

    expect(evaluateCapabilityDecision({
      capabilityKey: "staff.active.limit",
      valueType: "integer",
      booleanValue: null,
      integerValue: 75,
      currentUsage: 75,
      requestedUnits: 1,
    })).toMatchObject({ allowed: false, decisionCode: "limit_reached", limit: 75, currentUsage: 75 });
  });

  it("keeps offline attendance denied even if upstream data attempts to enable it", () => {
    expect(evaluateCapabilityDecision({
      capabilityKey: "attendance.offline",
      valueType: "boolean",
      booleanValue: true,
      integerValue: null,
      currentUsage: null,
    })).toMatchObject({ allowed: false, decisionCode: "offline_disabled" });
  });

  it("returns stable missing-authority decisions and never implies tenant access", () => {
    const decision = capabilityDecisionSchema.parse(evaluateCapabilityDecision({
      capabilityKey: "sites.active.limit",
      valueType: null,
      booleanValue: null,
      integerValue: null,
      currentUsage: 1,
    }));
    expect(decision).toMatchObject({ allowed: false, decisionCode: "subscription_required", grantsTenantAccess: false });
    expect(() => requireCapabilityDecision(decision)).toThrow(CapabilityDeniedError);
  });

  it("loads and requires decisions through the authoritative RPC boundary", async () => {
    const rpc = async () => ({ data: { capabilityKey: "onboarding.configure", allowed: true,
      decisionCode: "allowed", limit: null, currentUsage: null, grantsTenantAccess: false }, error: null });
    await expect(loadCapabilityDecision({ organisationId: "65000000-0000-4000-8000-000000000001", capabilityKey: "onboarding.configure" }, rpc))
      .resolves.toMatchObject({ allowed: true, grantsTenantAccess: false });
    await expect(requireCapability({ organisationId: "65000000-0000-4000-8000-000000000001", capabilityKey: "onboarding.configure" }, rpc))
      .resolves.toMatchObject({ allowed: true });
  });
});
