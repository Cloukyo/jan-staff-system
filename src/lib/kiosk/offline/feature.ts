export function offlineKioskRuntimeEnabled(value?: string): boolean {
  return value === "true";
}

export const OFFLINE_KIOSK_RUNTIME_ENABLED = offlineKioskRuntimeEnabled(
  process.env.NEXT_PUBLIC_OFFLINE_KIOSK_RUNTIME_ENABLED,
);
