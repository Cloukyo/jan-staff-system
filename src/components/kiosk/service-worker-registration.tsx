"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) {
      return;
    }

    void navigator.serviceWorker
      .register("/sw.js", { scope: "/clock" })
      .catch((error: unknown) => {
        console.error("[staff-clock] service worker registration failed", {
          error: error instanceof Error ? error.message : "unknown",
        });
      });
  }, []);

  return null;
}
