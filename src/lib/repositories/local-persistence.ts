import type { DemoState } from "@/types";
import { createSeedState } from "@/lib/demo-data/seed";
import { migrateState } from "@/lib/repositories/demo-store";

export const DEMO_STORAGE_KEY = "jan-staff-demo-state-v4";
export const LEGACY_DEMO_STORAGE_KEYS = ["jan-staff-demo-state-v3", "jan-staff-demo-state-v2", "jan-staff-demo-state-v1"];

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadDemoStateFromStorage(storage: StorageLike): { state: DemoState; repaired: boolean; error?: string } {
  const saved = storage.getItem(DEMO_STORAGE_KEY) ?? LEGACY_DEMO_STORAGE_KEYS.map((key) => storage.getItem(key)).find(Boolean);
  if (!saved) return { state: createSeedState(), repaired: false };
  try {
    return { state: migrateState(JSON.parse(saved) as Partial<DemoState>), repaired: true };
  } catch (error) {
    console.warn("Jan Staff demo data was corrupted and has been reseeded.", error);
    return { state: createSeedState(), repaired: true, error: "Corrupted local demo data was reset." };
  }
}

export function saveDemoStateToStorage(storage: StorageLike, state: DemoState): { ok: boolean; error?: string } {
  try {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (error) {
    console.error("Jan Staff demo data could not be saved.", error);
    return { ok: false, error: "Demo data could not be saved in this browser." };
  }
}

export function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  return {
    data: { ...initial },
    getItem(key) {
      return this.data[key] ?? null;
    },
    setItem(key, value) {
      this.data[key] = value;
    },
    removeItem(key) {
      delete this.data[key];
    },
  };
}
