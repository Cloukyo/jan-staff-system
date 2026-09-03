import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createPilotReadinessCommercialDatabase,
} from "./helpers/onboarding-persistence-db";
import {
  ORG_A,
  USER_A_OWNER,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";

const DIGEST = "a".repeat(64);
const OTHER_DIGEST = "b".repeat(64);
const ATTEMPT_A = "41000000-0000-4000-8000-000000000001";
const ATTEMPT_B = "42000000-0000-4000-8000-000000000001";

type Outcome = { outcome: string };

async function call(db: PGlite, sql: string, params: unknown[] = []) {
  const result = await db.query<Outcome>(sql, params);
  return result.rows[0];
}

describe("commercial pilot access migration", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createPilotReadinessCommercialDatabase();
    const migration = readdirSync(resolve("supabase/migrations")).find((name) =>
      name.endsWith("_commercial_pilot_access_control.sql"),
    );
    if (!migration) throw new Error("commercial pilot access migration is missing");
    await db.exec(readFileSync(resolve("supabase/migrations", migration), "utf8"));
    await db.exec("set role service_role");
    await call(db, "select public.configure_commercial_pilot_gate(true) as outcome");
    await call(
      db,
      "select public.grant_commercial_pilot_access($1, now() + interval '1 day') as outcome",
      [DIGEST],
    );
  });

  afterEach(async () => {
    await db.close();
  });

  it("reserves one grant atomically for only one signup attempt", async () => {
    const first = await call(
      db,
      "select public.reserve_commercial_pilot_access($1, $2) as outcome",
      [DIGEST, ATTEMPT_A],
    );
    const second = await call(
      db,
      "select public.reserve_commercial_pilot_access($1, $2) as outcome",
      [DIGEST, ATTEMPT_B],
    );

    expect(first.outcome).toBe("reserved");
    expect(second.outcome).toBe("unavailable");
  });

  it("authoritatively rejects expired, revoked and consumed grants", async () => {
    await call(db, "select public.revoke_commercial_pilot_access($1) as outcome", [DIGEST]);
    expect(
      (await call(db, "select public.reserve_commercial_pilot_access($1, $2) as outcome", [DIGEST, ATTEMPT_A])).outcome,
    ).toBe("unavailable");

    await call(
      db,
      "select public.grant_commercial_pilot_access($1, now() - interval '1 second') as outcome",
      [OTHER_DIGEST],
    );
    expect(
      (await call(db, "select public.reserve_commercial_pilot_access($1, $2) as outcome", [OTHER_DIGEST, ATTEMPT_B])).outcome,
    ).toBe("unavailable");
  });

  it("binds a reservation only to an existing Auth user", async () => {
    await call(db, "select public.reserve_commercial_pilot_access($1, $2) as outcome", [DIGEST, ATTEMPT_A]);
    const missing = await call(
      db,
      "select public.bind_commercial_pilot_access($1, $2, $3) as outcome",
      [DIGEST, ATTEMPT_A, "49000000-0000-4000-8000-000000000099"],
    );
    const existing = await call(
      db,
      "select public.bind_commercial_pilot_access($1, $2, $3) as outcome",
      [DIGEST, ATTEMPT_A, USER_A_OWNER],
    );

    expect(missing.outcome).toBe("auth_user_missing");
    expect(existing.outcome).toBe("bound");
  });

  it("consumes the bound grant on the authoritative live transition", async () => {
    await call(db, "select public.reserve_commercial_pilot_access($1, $2) as outcome", [DIGEST, ATTEMPT_A]);
    await call(db, "select public.bind_commercial_pilot_access($1, $2, $3) as outcome", [DIGEST, ATTEMPT_A, USER_A_OWNER]);
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await resetTenantDatabaseRole(db);
    await db.query("select set_config('app.commercial_go_live', $1, false)", [ORG_A]);
    await db.query(
      "update public.organisations set operational_state='live', went_live_at=now() where id=$1",
      [ORG_A],
    );
    await resetTenantDatabaseRole(db);
    const result = await db.query<{ consumed_at: string | null; consumed_organisation_id: string | null }>(
      "select consumed_at, consumed_organisation_id from private.commercial_pilot_access_grants where email_hmac=$1",
      [DIGEST],
    );

    expect(result.rows[0].consumed_at).not.toBeNull();
    expect(result.rows[0].consumed_organisation_id).toBe(ORG_A);
  });

  it("blocks live transition without a bound active grant", async () => {
    await setTenantAuthUser(db, USER_A_OWNER, "aal2");
    await resetTenantDatabaseRole(db);
    await db.query("select set_config('app.commercial_go_live', $1, false)", [ORG_A]);
    await expect(
      db.query(
        "update public.organisations set operational_state='live', went_live_at=now() where id=$1",
        [ORG_A],
      ),
    ).rejects.toThrow(/pilot access/i);
  });
});
