import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const manager = readFileSync(resolve("src/components/onboarding/kiosk-setup.tsx"), "utf8");
const tablet = readFileSync(resolve("src/components/kiosk/commercial-kiosk-registration.tsx"), "utf8");
const claim = readFileSync(resolve("src/lib/onboarding/kiosk-actions.ts"), "utf8");
const clock = readFileSync(resolve("src/app/clock/page.tsx"), "utf8");

describe("commercial online kiosk setup UI", () => {
  it("uses the reusable onboarding shell with authoritative security language", () => {
    expect(manager).toMatch(/Online setup only/);
    expect(manager).toMatch(/Pre-live mode/);
    expect(manager).toMatch(/offline attendance remains disabled/);
    expect(manager).not.toMatch(/nursery|preschool|Jan/);
  });
  it("offers a touch-first claim flow with safe recovery states", () => {
    expect(tablet).toMatch(/Register this clocking device/);
    expect(tablet).toMatch(/minLength|one-time-code/);
    expect(claim).toMatch(/expired|already_claimed|rate_limited|connection_problem/);
    expect(claim).toMatch(/setKioskDeviceCookie/);
  });
  it("renders a clear pre-live state instead of attendance controls", () => {
    expect(tablet).toMatch(/Waiting for Go Live/);
    expect(tablet).toMatch(/Clock-in and clock-out stay unavailable/);
    expect(clock).toMatch(/CommercialPreLiveKiosk/);
  });
  it("never exposes PINs, credentials or pay fields in manager readiness copy", () => {
    expect(manager).not.toMatch(/pinHash|deviceToken|salary|hourly.?rate/i);
    expect(manager).toMatch(/PINs are stored securely and never shown/);
  });
});
