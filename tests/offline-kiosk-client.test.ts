import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteOfflineDatabase,
  installOfflineProvisioningPackage,
  getOfflineProvisioningPackage,
  listPendingActions,
} from "@/lib/kiosk/offline/database";
import {
  enrolVerifiedOfflinePin,
  refreshOfflineProvisioning,
  queueProvisionalAttendanceAction,
  verifyStoredOfflinePin,
} from "@/lib/kiosk/offline/provisioning";
import type { OfflineProvisioningPackage } from "@/lib/kiosk/offline/server-contract";

function packageValue(): OfflineProvisioningPackage {
  return {
    schemaVersion: 1,
    featureEnabled: true,
    device: { id: "746cbd28-b1fa-4765-b874-4631b8b0cf47", name: "Front tablet" },
    authorisation: {
      id: "4053cc19-27ec-4274-9a26-3d8dcf5b788e",
      issuedAt: "2026-08-03T19:00:00.000Z",
      expiresAt: "2026-08-04T19:00:00.000Z",
      rosterVersion: "fb15c29e3f4b15f597781b085a71e466f6f95bb751e9729aa9041f328b57e211",
    },
    server: { time: "2026-08-03T19:00:00.000Z", timezone: "Europe/London", operationalDayStart: "00:00" },
    roster: [{
      staffId: "staff-a",
      displayName: "Demo B",
      employmentRole: "Practitioner",
      pinVersion: "pin-v1",
      trustedState: {
        state: "clocked_out",
        operationalDate: "2026-08-03",
        currentEvent: null,
        unresolvedExceptions: [],
        allowedActions: ["clock_in"],
        warnings: [],
        revision: "revision-a",
        evaluatedAt: "2026-08-03T19:00:00.000Z",
      },
    }],
  };
}

beforeEach(async () => deleteOfflineDatabase());
afterEach(async () => deleteOfflineDatabase());

describe("offline kiosk client provisioning", () => {
  it("fetches and installs a server-authorised package using only the public device key", async () => {
    const provisioned = packageValue();
    const requests: unknown[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      requests.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true, package: provisioned }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    };

    await expect(refreshOfflineProvisioning({
      fetcher,
      now: () => "2026-08-03T19:00:00.000Z",
    })).resolves.toEqual({ status: "active", package: provisioned });
    expect(await getOfflineProvisioningPackage()).toEqual(provisioned);
    const serialisedRequest = JSON.stringify(requests);
    expect(serialisedRequest).toContain('"kty":"EC"');
    expect(serialisedRequest).not.toMatch(/private|verifier|pin|salary|hourly/i);
  });

  it("preserves an installed package when refresh is denied", async () => {
    const provisioned = packageValue();
    await installOfflineProvisioningPackage(provisioned);
    const fetcher: typeof fetch = async () => new Response(
      JSON.stringify({ ok: false, code: "device_revoked" }),
      { status: 403, headers: { "Content-Type": "application/json" } },
    );

    await expect(refreshOfflineProvisioning({ fetcher })).resolves.toEqual({ status: "device_revoked" });
    expect(await getOfflineProvisioningPackage()).toEqual(provisioned);
  });

  it("enrols only a successfully checked six-digit PIN for the active authorisation", async () => {
    await installOfflineProvisioningPackage(packageValue());

    await expect(enrolVerifiedOfflinePin({
      staffId: "staff-a",
      pin: "482731",
      now: "2026-08-03T19:01:00.000Z",
    })).resolves.toEqual({ status: "enrolled" });
    await expect(verifyStoredOfflinePin({
      staffId: "staff-a",
      pin: "482731",
      now: "2026-08-03T19:02:00.000Z",
    })).resolves.toEqual(expect.objectContaining({ status: "verified" }));
  });

  it("does not enrol four or five digit online PINs for offline use", async () => {
    await installOfflineProvisioningPackage(packageValue());

    await expect(enrolVerifiedOfflinePin({
      staffId: "staff-a",
      pin: "4826",
      now: "2026-08-03T19:01:00.000Z",
    })).resolves.toEqual({ status: "ineligible" });
  });

  it("returns unavailable instead of guessing without a current verifier", async () => {
    await installOfflineProvisioningPackage(packageValue());

    await expect(verifyStoredOfflinePin({
      staffId: "staff-a",
      pin: "482731",
      now: "2026-08-03T19:02:00.000Z",
    })).resolves.toEqual({ status: "unavailable" });
  });

  it("queues an explicit provisional action once even when tapped twice", async () => {
    await installOfflineProvisioningPackage(packageValue());
    const input = {
      staffId: "staff-a",
      action: "clock_in" as const,
      expectedRevision: "revision-a",
      occurredAt: "2026-08-03T19:30:00.000Z",
      unresolvedOlderException: false,
    };

    const [first, second] = await Promise.all([
      queueProvisionalAttendanceAction(input),
      queueProvisionalAttendanceAction(input),
    ]);

    expect(second.idempotencyKey).toBe(first.idempotencyKey);
    expect(await listPendingActions()).toEqual([
      expect.objectContaining({ action: "clock_in", status: "pending" }),
    ]);
  });
});
