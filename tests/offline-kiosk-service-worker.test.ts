import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

type WorkerListeners = Record<string, (event: unknown) => void>;

function workerHarness(options?: { fetchRejects?: boolean }) {
  const source = readFileSync(resolve("public/sw.js"), "utf8");
  const listeners: WorkerListeners = {};
  const cachedShell = new Response("cached clock");
  const cache = {
    addAll: vi.fn(async () => undefined),
    match: vi.fn(async (request: RequestInfo | URL) => {
      const url =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.pathname
            : new URL(request.url).pathname;
      return url === "/clock" ? cachedShell.clone() : undefined;
    }),
    put: vi.fn(async () => undefined),
  };
  const caches = {
    open: vi.fn(async () => cache),
    keys: vi.fn(async () => [
      "jan-staff-clock-shell-v0",
      "jan-staff-clock-shell-v1",
      "unrelated-cache",
    ]),
    delete: vi.fn(async () => true),
    match: cache.match,
  };
  const fetchMock = options?.fetchRejects
    ? vi.fn(async () => {
        throw new TypeError("offline");
      })
    : vi.fn(async () => new Response("network", { status: 200 }));
  const foregroundClient = { postMessage: vi.fn() };
  const worker = {
    location: { origin: "https://staff-clock.test" },
    addEventListener: vi.fn(
      (type: string, listener: (event: unknown) => void) => {
        listeners[type] = listener;
      },
    ),
    skipWaiting: vi.fn(async () => undefined),
    clients: {
      claim: vi.fn(async () => undefined),
      matchAll: vi.fn(async () => [foregroundClient]),
    },
  };

  new Function("self", "caches", "fetch", source)(
    worker,
    caches,
    fetchMock,
  );

  return { listeners, cache, caches, fetchMock, worker, foregroundClient };
}

describe("offline kiosk service worker", () => {
  it("pre-caches only the clock shell and required static brand asset", async () => {
    const { listeners, cache } = workerHarness();
    let completion = Promise.resolve();

    listeners.install({
      waitUntil(value: Promise<void>) {
        completion = value;
      },
    });
    await completion;

    expect(cache.addAll).toHaveBeenCalledWith([
      "/clock",
      "/brand/jan-logo.png",
    ]);
    const serialised = JSON.stringify(cache.addAll.mock.calls);
    expect(serialised).not.toMatch(
      /attendance|payroll|compliance|api\/kiosk|supabase/i,
    );
  });

  it("removes only obsolete Staff Clock cache versions on activation", async () => {
    const { listeners, caches, worker } = workerHarness();
    let completion = Promise.resolve();

    listeners.activate({
      waitUntil(value: Promise<void>) {
        completion = value;
      },
    });
    await completion;

    expect(caches.delete).toHaveBeenCalledWith("jan-staff-clock-shell-v0");
    expect(caches.delete).not.toHaveBeenCalledWith(
      "jan-staff-clock-shell-v1",
    );
    expect(caches.delete).not.toHaveBeenCalledWith("unrelated-cache");
    expect(worker.clients.claim).toHaveBeenCalled();
  });

  it("returns the compatible cached clock shell after navigation failure", async () => {
    const { listeners } = workerHarness({ fetchRejects: true });
    let response: Promise<Response> | undefined;

    listeners.fetch({
      request: {
        method: "GET",
        mode: "navigate",
        destination: "document",
        url: "https://staff-clock.test/clock",
      },
      respondWith(value: Promise<Response>) {
        response = value;
      },
    });

    expect(await (await response)?.text()).toBe("cached clock");
  });

  it.each(["/attendance", "/payroll", "/compliance"])(
    "does not intercept manager route %s",
    (pathname) => {
      const { listeners } = workerHarness();
      const respondWith = vi.fn();

      listeners.fetch({
        request: {
          method: "GET",
          mode: "navigate",
          destination: "document",
          url: `https://staff-clock.test${pathname}`,
        },
        respondWith,
      });

      expect(respondWith).not.toHaveBeenCalled();
    },
  );

  it("does not intercept offline API or Supabase responses", () => {
    const { listeners } = workerHarness();
    const apiRespondWith = vi.fn();
    const supabaseRespondWith = vi.fn();

    listeners.fetch({
      request: {
        method: "GET",
        mode: "cors",
        destination: "",
        url: "https://staff-clock.test/api/kiosk/offline/sync",
      },
      respondWith: apiRespondWith,
    });
    listeners.fetch({
      request: {
        method: "GET",
        mode: "cors",
        destination: "",
        url: "https://example.supabase.co/rest/v1/clock_events",
      },
      respondWith: supabaseRespondWith,
    });

    expect(apiRespondWith).not.toHaveBeenCalled();
    expect(supabaseRespondWith).not.toHaveBeenCalled();
  });

  it("registers the worker without depending on Background Sync", () => {
    const registration = readFileSync(
      resolve("src/components/kiosk/service-worker-registration.tsx"),
      "utf8",
    );

    expect(registration).toMatch(
      /navigator\.serviceWorker\s*\.register\("\/sw\.js"/,
    );
    expect(registration).toContain('scope: "/clock"');
    expect(registration).not.toContain(".sync.register");
  });

  it("uses Background Sync only to wake a foreground queue worker", async () => {
    const { listeners, worker, foregroundClient } = workerHarness();
    let completion = Promise.resolve();

    listeners.sync({
      tag: "jan-staff-clock-sync",
      waitUntil(value: Promise<void>) {
        completion = value;
      },
    });
    await completion;

    expect(worker.clients.matchAll).toHaveBeenCalledWith({ type: "window", includeUncontrolled: true });
    expect(foregroundClient.postMessage).toHaveBeenCalledWith({ type: "OFFLINE_SYNC_REQUESTED" });
  });
});
