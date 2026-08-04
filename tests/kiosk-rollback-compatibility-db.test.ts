// @vitest-environment node

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { createAttendanceTestDatabase } from "./helpers/attendance-corrections-db";

function migrationSource(suffix: string): string {
  const file = readdirSync(resolve("supabase/migrations"))
    .find((candidate) => candidate.endsWith(suffix));
  if (!file) throw new Error(`Missing migration: ${suffix}`);
  return readFileSync(resolve("supabase/migrations", file), "utf8");
}

describe("rollback-compatible kiosk PIN verification", () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createAttendanceTestDatabase();
    await db.exec(`
      create table public.kiosk_devices (
        id uuid primary key default gen_random_uuid()
      );
      create or replace function extensions.digest(value text, algorithm text)
      returns bytea
      language sql
      immutable
      as $$
        select convert_to(value || algorithm, 'UTF8');
      $$;
    `);
    await db.exec(migrationSource("_attendance_state_machine.sql"));
    await db.exec(migrationSource("_kiosk_attendance_state_response.sql"));
    await db.exec(migrationSource("_restore_kiosk_pin_rollback_compatibility.sql"));
    await db.exec(`
      insert into public.staff_profiles (id, full_name)
      values ('rollback-staff', 'Rollback Staff');
      insert into public.staff_kiosk_settings (staff_id, pin_hash)
      values ('rollback-staff', '4827');
    `);
  }, 30_000);

  afterAll(async () => {
    await db?.close();
  });

  it("returns legacy fields and the authoritative state in one PostgREST row", async () => {
    const result = await db.query<{
      ok: boolean;
      code: string;
      current_status: string;
      attendance_state: { state: string; allowedActions: string[] };
      work_week_start_date: string;
      work_week_end_date: string;
      completed_minutes: number;
      open_shift_in_progress: boolean;
    }>(`
      select *
      from public.verify_device_kiosk_pin('device-token', 'rollback-staff', '4827')
    `);

    expect(result.rows).toEqual([expect.objectContaining({
      ok: true,
      current_status: "clocked_out",
      attendance_state: expect.objectContaining({
        state: "clocked_out",
        allowedActions: ["clock_in"],
      }),
      open_shift_in_progress: false,
    })]);
  });
});
