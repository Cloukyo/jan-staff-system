// @vitest-environment jsdom

import "fake-indexeddb/auto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useOfflineKiosk } from "@/components/kiosk/use-offline-kiosk";
import { offlineKioskRuntimeEnabled } from "@/lib/kiosk/offline/feature";
import { deleteOfflineDatabase } from "@/lib/kiosk/offline/database";

afterEach(async () => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  await deleteOfflineDatabase();
});

describe("offline kiosk runtime gate", () => {
  it.each([
    [undefined, false],
    ["", false],
    ["false", false],
    ["TRUE", false],
    ["true", true],
  ] as const)("maps %s to %s", (value, expected) => {
    expect(offlineKioskRuntimeEnabled(value)).toBe(expected);
  });

  it("does not contact offline endpoints while the runtime is disabled", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      throw new Error("Disabled offline runtime attempted a network request");
    });
    vi.stubGlobal("fetch", fetcher);
    const container = document.createElement("div");
    const root = createRoot(container);

    function Probe() {
      useOfflineKiosk();
      return null;
    }

    await act(async () => root.render(<Probe />));
    await act(async () => vi.advanceTimersByTimeAsync(5 * 60_000));

    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });
});
