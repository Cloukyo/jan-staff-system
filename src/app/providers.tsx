"use client";

import { DemoStoreProvider } from "@/lib/repositories/demo-store";

export function Providers({ children }: { children: React.ReactNode }) {
  return <DemoStoreProvider>{children}</DemoStoreProvider>;
}
