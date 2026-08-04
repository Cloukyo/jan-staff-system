import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  deleteOfflineDatabase,
  enqueueAttendanceAction,
  installOfflineProvisioningPackage,
} from "@/lib/kiosk/offline/database";
import {
  loadOfflineRuntimeState,
  reportOfflineQueueHealth,
} from "@/lib/kiosk/offline/runtime";
import type { OfflineProvisioningPackage } from "@/lib/kiosk/offline/server-contract";

const provisioned: OfflineProvisioningPackage = {
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
  roster: [],
};

beforeEach(async () => deleteOfflineDatabase());
afterEach(async () => deleteOfflineDatabase());

describe("offline kiosk runtime health", () => {
  it("reports active, expiring and expired from preserved local authorisation", async () => {
    await installOfflineProvisioningPackage(provisioned);

    await expect(loadOfflineRuntimeState("2026-08-04T16:00:00.000Z"))
      .resolves.toEqual(expect.objectContaining({ lifecycle: "active" }));
    await expect(loadOfflineRuntimeState("2026-08-04T18:00:00.000Z"))
      .resolves.toEqual(expect.objectContaining({ lifecycle: "expiring" }));
    await expect(loadOfflineRuntimeState("2026-08-04T19:00:00.000Z"))
      .resolves.toEqual(expect.objectContaining({ lifecycle: "expired" }));
  });

  it("reports queue health without exposing queued payloads", async () => {
    await installOfflineProvisioningPackage(provisioned);
    await enqueueAttendanceAction({
      idempotencyKey: crypto.randomUUID(),
      authorisationId: provisioned.authorisation.id,
      rosterVersion: provisioned.authorisation.rosterVersion,
      deviceId: provisioned.device.id,
      staffId: "staff-a",
      action: "clock_in",
      occurredAtDevice: "2026-08-03T19:30:00.000Z",
      deviceTimezone: "Europe/London",
      operationalDateAtDevice: "2026-08-03",
      trustedSnapshotRevision: "revision-a",
      priorPendingActionId: null,
      unresolvedOlderException: false,
      signature: "signed",
    });
    const bodies: unknown[] = [];
    const fetcher: typeof fetch = async (_input, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };

    await expect(reportOfflineQueueHealth({
      fetcher,
      storage: { persisted: async () => true, estimate: async () => ({ usage: 4096 }) },
    })).resolves.toBe(true);
    expect(bodies).toEqual([expect.objectContaining({
      authorisationId: provisioned.authorisation.id,
      pendingCount: 1,
      storagePersisted: true,
      storageEstimateBytes: 4096,
    })]);
    expect(JSON.stringify(bodies)).not.toContain("staff-a");
  });
});
