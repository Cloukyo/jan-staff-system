import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";

const migrationPath = resolve(
  "supabase/migrations/20260805162339_core_platform_neutralisation.sql",
);

describe("core platform neutralisation migration", () => {
  it("introduces neutral work-area and operational-context columns additively", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/rota_settings[\s\S]*available_work_areas/);
    expect(sql).toMatch(/rota_shifts[\s\S]*work_area/);
    expect(sql).toMatch(/rota_template_shifts[\s\S]*work_area/);
    expect(sql).toMatch(/kiosk_devices[\s\S]*operational_context/);
    expect(sql).toMatch(/kiosk_offline_authorisations[\s\S]*operational_context/);
  });

  it("backfills legacy values and keeps old and new clients synchronized", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).toMatch(/available_work_areas\s*=\s*available_rooms/);
    expect(sql).toMatch(/work_area\s*=\s*room_or_area/);
    expect(sql).toMatch(/operational_context\s*=\s*nursery_context/);
    expect(sql).toContain("sync_neutral_work_area_fields");
    expect(sql).toContain("sync_neutral_operational_context_fields");
  });

  it("does not alter attendance evidence or permission objects", () => {
    const sql = readFileSync(migrationPath, "utf8");
    expect(sql).not.toMatch(/alter\s+table\s+public\.(clock_events|clock_event_corrections|attendance_)/i);
    expect(sql).not.toMatch(/create\s+policy|drop\s+policy|grant\s/i);
  });

  it("applies against the inherited schema and synchronises legacy and neutral writes", async () => {
    const db = new PGlite();
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema if not exists public;
      create table public.rota_settings (id boolean primary key, available_rooms text[] not null default array[]::text[]);
      create table public.rota_shifts (id uuid primary key, room_or_area text);
      create table public.rota_template_shifts (id uuid primary key, room_or_area text);
      create table public.kiosk_devices (id uuid primary key, nursery_context text not null default 'legacy-context');
      create table public.kiosk_offline_authorisations (id uuid primary key, nursery_context text not null);
      insert into public.rota_settings (id, available_rooms) values (true, array['Legacy room']);
      insert into public.rota_shifts (id, room_or_area) values ('00000000-0000-0000-0000-000000000001', 'Legacy room');
      insert into public.rota_template_shifts (id, room_or_area) values ('00000000-0000-0000-0000-000000000002', 'Legacy room');
      insert into public.kiosk_devices (id, nursery_context) values ('00000000-0000-0000-0000-000000000003', 'legacy-context');
      insert into public.kiosk_offline_authorisations (id, nursery_context) values ('00000000-0000-0000-0000-000000000004', 'legacy-context');
    `);
    await db.exec(readFileSync(migrationPath, "utf8"));

    expect((await db.query<{ available_work_areas: string[] }>("select available_work_areas from public.rota_settings where id = true")).rows[0].available_work_areas).toEqual(["Legacy room"]);
    await db.exec("update public.rota_shifts set work_area = 'Department' where id = '00000000-0000-0000-0000-000000000001'");
    expect((await db.query<{ room_or_area: string }>("select room_or_area from public.rota_shifts where id = '00000000-0000-0000-0000-000000000001'")).rows[0].room_or_area).toBe("Department");
    await db.exec("update public.kiosk_devices set nursery_context = 'legacy-update' where id = '00000000-0000-0000-0000-000000000003'");
    expect((await db.query<{ operational_context: string }>("select operational_context from public.kiosk_devices where id = '00000000-0000-0000-0000-000000000003'")).rows[0].operational_context).toBe("legacy-update");
    await db.close();
  }, 30_000);
});
