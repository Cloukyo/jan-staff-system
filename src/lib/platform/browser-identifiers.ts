export type CompatibleIdentifier = {
  current: string;
  legacy: readonly string[];
};

export const browserIdentifiers = {
  demoStorage: {
    current: "workforce-platform-demo-state-v1",
    legacy: ["jan-staff-demo-state-v5", "jan-staff-demo-state-v4", "jan-staff-demo-state-v3", "jan-staff-demo-state-v2", "jan-staff-demo-state-v1"],
  },
  complianceStorage: {
    current: "workforce-platform-compliance-demo-v1",
    legacy: ["jan-staff-compliance-demo-v1"],
  },
  rotaViewStorage: {
    current: "workforce-platform-rota-view",
    legacy: ["jan-staff-rota-view"],
  },
  managerSessionStorage: {
    current: "workforce-platform-manager-session",
    legacy: ["jan-staff-manager-session"],
  },
  deviceCookie: {
    current: "workforce_clocking_device",
    legacy: ["jan_kiosk_device"],
  },
  offlineDatabase: {
    current: "workforce-platform-clock",
    legacy: ["jan-staff-clock"],
  },
  backgroundSync: {
    current: "workforce-platform-clock-sync",
    legacy: ["jan-staff-clock-sync"],
  },
} as const satisfies Record<string, CompatibleIdentifier>;

type StorageReaderWriter = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

export function migrateStoredValue(
  storage: StorageReaderWriter,
  identifier: CompatibleIdentifier,
): string | null {
  const current = storage.getItem(identifier.current);
  if (current !== null) return current;
  for (const legacyKey of identifier.legacy) {
    const legacy = storage.getItem(legacyKey);
    if (legacy !== null) {
      storage.setItem(identifier.current, legacy);
      return legacy;
    }
  }
  return null;
}
