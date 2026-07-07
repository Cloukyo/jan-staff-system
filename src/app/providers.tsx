"use client";

import { DemoStoreProvider } from "@/lib/repositories/demo-store";
import type { AppMode } from "@/lib/app-mode";

export function Providers({ children, appMode }: { children: React.ReactNode; appMode: AppMode }) {
  if (appMode === "demo") return <DemoStoreProvider>{children}</DemoStoreProvider>;
  return <>{children}</>;
}
