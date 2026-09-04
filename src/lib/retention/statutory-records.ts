import { isoDateInLondon } from "@/lib/dates/format";

const STATUTORY_COMMENCEMENT_DATE = "2026-04-06";

export function statutoryRetentionUntil(createdAt: string): string | null {
  const created = new Date(createdAt);
  if (!Number.isFinite(created.getTime()) || isoDateInLondon(created) < STATUTORY_COMMENCEMENT_DATE) return null;
  const retained = new Date(created);
  retained.setUTCFullYear(retained.getUTCFullYear() + 6);
  return retained.toISOString();
}

export function canDeleteRetainedRecord(record: { retainedUntil: string | null; activeHold: boolean }, now = new Date()): boolean {
  if (record.activeHold) return false;
  return !record.retainedUntil || now >= new Date(record.retainedUntil);
}
