import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { resolveAttendanceActor } from "@/lib/attendance/tenant-actor";

describe("attendance commercial compatibility adapter", () => {
  it("uses legacy only when no commercial membership exists", async () => {
    await expect(resolveAttendanceActor({
      loadCommercial: async () => { throw new CommercialIdentityError("site_unavailable"); },
      loadLegacy: async () => ({ id: "legacy" }),
    })).rejects.toMatchObject({ code: "site_unavailable" });

    await expect(resolveAttendanceActor({
      loadCommercial: async () => { throw new CommercialIdentityError("membership_required"); },
      loadLegacy: async () => ({ id: "legacy" }),
    })).resolves.toEqual({ kind: "legacy", account: { id: "legacy" } });
  });

  it("routes manager attendance mutations through membership-derived commercial RPCs", () => {
    const corrections = readFileSync(resolve("src/lib/attendance/correction-actions.ts"), "utf8");
    const reviews = readFileSync(resolve("src/lib/attendance/review-actions.ts"), "utf8");
    expect(corrections).toContain('requireAttendanceActor("attendance.correct"');
    expect(corrections).toContain('supabase.rpc("save_commercial_clock_event_correction"');
    expect(reviews).toContain('supabase.rpc("resolve_commercial_attendance_exception"');
    expect(reviews).toContain('supabase.rpc("dismiss_commercial_attendance_exception"');
  });

  it("uses a database dispatcher so commercial devices cannot fall into the unowned kiosk path", () => {
    const kiosk = readFileSync(resolve("src/lib/kiosk/actions.ts"), "utf8");
    expect(kiosk).toContain('supabase.rpc("verify_tenant_aware_device_kiosk_pin"');
    expect(kiosk).toContain('supabase.rpc("perform_tenant_aware_kiosk_attendance_action"');
  });
});
