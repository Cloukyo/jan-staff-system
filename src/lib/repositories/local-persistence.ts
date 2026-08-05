import type { DemoState } from "@/types";
import { createSeedState } from "@/lib/demo-data/seed";
import { migrateState } from "@/lib/repositories/demo-store";
import { browserIdentifiers, migrateStoredValue } from "@/lib/platform/browser-identifiers";

export const DEMO_STORAGE_KEY = browserIdentifiers.demoStorage.current;
export const LEGACY_DEMO_STORAGE_KEYS = browserIdentifiers.demoStorage.legacy;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadDemoStateFromStorage(storage: StorageLike): { state: DemoState; repaired: boolean; error?: string } {
  const saved = migrateStoredValue(storage, browserIdentifiers.demoStorage);
  if (!saved) return { state: createSeedState(), repaired: false };
  try {
    return { state: migrateState(JSON.parse(saved) as Partial<DemoState>), repaired: true };
  } catch (error) {
    console.warn("Workforce platform demo data was corrupted and has been reseeded.", error);
    return { state: createSeedState(), repaired: true, error: "Corrupted local demo data was reset." };
  }
}

export function saveDemoStateToStorage(storage: StorageLike, state: DemoState): { ok: boolean; error?: string } {
  try {
    storage.setItem(DEMO_STORAGE_KEY, JSON.stringify(state));
    return { ok: true };
  } catch (error) {
    console.error("Workforce platform demo data could not be saved.", error);
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
