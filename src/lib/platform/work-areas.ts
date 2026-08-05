export function readWorkArea(row: Record<string, unknown>): string | null {
  const value = row.work_area ?? row.room_or_area;
  return typeof value === "string" && value.trim() ? value : null;
}

export function readAvailableWorkAreas(row: Record<string, unknown>): string[] {
  const value = row.available_work_areas ?? row.available_rooms;
  return Array.isArray(value) ? value.map(String) : [];
}

export function workAreaPayload(value: FormDataEntryValue | null | undefined): {
  work_area: string | null;
  room_or_area: string | null;
} {
  const workArea = String(value ?? "").trim() || null;
  return { work_area: workArea, room_or_area: workArea };
}
