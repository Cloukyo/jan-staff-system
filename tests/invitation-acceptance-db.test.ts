import type { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MEMBERSHIP_A_ADMIN,
  MEMBERSHIP_A_OWNER,
  ORG_A,
  SITE_A1,
  SITE_B1,
  USER_MULTI,
  createIdentityMembershipDatabase,
  resetTenantDatabaseRole,
  setTenantAuthUser,
} from "./helpers/tenant-primitives-db";

const INVITED_USER = "c0000000-0000-0000-0000-000000000001";
const INVITATION_ID = "c1000000-0000-0000-0000-000000000001";
const TOKEN = "fictional-invitation-token-01";

async function seedInvitation(
  db: PGlite,
  options: {
    email?: string;
    role?: "staff" | "site_manager";
    siteId?: string | null;
    status?: "pending" | "revoked";
    expiresAt?: string;
    inviterId?: string;
    authUserId?: string;
  } = {},
) {
  const email = options.email ?? "invited@example.test";
  const role = options.role ?? "staff";
  const siteId = options.siteId ?? null;
  const authUserId = options.authUserId ?? INVITED_USER;
  await resetTenantDatabaseRole(db);
  await db.query("insert into auth.users (id, email) values ($1, $2) on conflict (id) do update set email = excluded.email", [authUserId, email]);
  await db.query(
    `insert into public.organisation_invitations
      (id, organisation_id, invited_email, token_hash, status, expires_at, invited_by_membership_id, revoked_at, created_at)
     values ($1, $2, $3, sha256(convert_to($4, 'UTF8')), $5::public.organisation_invitation_status, $6::timestamptz, $7,
       case when $5::text = 'revoked' then now() else null end,
       least(now(), $6::timestamptz - interval '7 days'))`,
    [INVITATION_ID, ORG_A, email, TOKEN, options.status ?? "pending", options.expiresAt ?? "2099-08-05T12:00:00Z", options.inviterId ?? MEMBERSHIP_A_OWNER],
  );
  await db.query(
    `insert into public.organisation_invitation_roles
      (organisation_id, invitation_id, role, scope_type, site_id)
     values ($1, $2, $3, $4, $5)`,
    [ORG_A, INVITATION_ID, role, siteId ? "site" : "organisation", siteId],
  );
  if (siteId) {
    await db.query(
      "insert into public.organisation_invitation_site_access (organisation_id, invitation_id, site_id) values ($1, $2, $3)",
      [ORG_A, INVITATION_ID, siteId],
    );
  }
  return authUserId;
}

async function accept(db: PGlite, token = TOKEN) {
  return db.query<{ organisation_id: string; membership_id: string; outcome: string; authorisation_revision: number }>(
    "select * from public.accept_organisation_invitation($1)",
    [token],
  );
}

describe("commercial invitation acceptance", () => {
  let db: PGlite;

  beforeEach(async () => {
    db = await createIdentityMembershipDatabase();
  }, 30_000);

  afterEach(async () => {
    await db?.close();
  });

  it("activates an existing Auth user from stored staff-role intent at AAL1", async () => {
    await seedInvitation(db);
    await setTenantAuthUser(db, INVITED_USER, "aal1");
    const result = await accept(db);
    expect(result.rows[0]).toEqual(expect.objectContaining({ organisation_id: ORG_A, outcome: "accepted" }));
    await resetTenantDatabaseRole(db);
    const role = await db.query<{ role: string }>(
      "select role from public.membership_role_assignments where membership_id = $1",
      [result.rows[0].membership_id],
    );
    expect(role.rows).toEqual([{ role: "staff" }]);
  });

  it("requires AAL2 for a privileged invited role", async () => {
    await seedInvitation(db, { role: "site_manager", siteId: SITE_A1 });
    await setTenantAuthUser(db, INVITED_USER, "aal1");
    await expect(accept(db)).rejects.toThrow("commercial_invitation_mfa_required");
  });

  it("accepts privileged stored site scope at AAL2", async () => {
    await seedInvitation(db, { role: "site_manager", siteId: SITE_A1 });
    await setTenantAuthUser(db, INVITED_USER, "aal2");
    const result = await accept(db);
    await resetTenantDatabaseRole(db);
    const access = await db.query<{ site_id: string }>(
      "select site_id from public.membership_site_access where membership_id = $1",
      [result.rows[0].membership_id],
    );
    expect(access.rows).toEqual([{ site_id: SITE_A1 }]);
  });

  it("returns the original result for a same-user token replay", async () => {
    await seedInvitation(db);
    await setTenantAuthUser(db, INVITED_USER);
    const first = await accept(db);
    const retry = await accept(db);
    expect(retry.rows[0]).toEqual({ ...first.rows[0], outcome: "already_accepted" });
  });

  it("rejects expired, revoked and email-mismatched invitations without tenant detail", async () => {
    await seedInvitation(db, { expiresAt: "2020-01-01T00:00:00Z" });
    await setTenantAuthUser(db, INVITED_USER);
    await expect(accept(db)).rejects.toThrow("commercial_invitation_unavailable");
  });

  it("rejects an explicitly revoked invitation", async () => {
    await seedInvitation(db, { status: "revoked" });
    await setTenantAuthUser(db, INVITED_USER);
    await expect(accept(db)).rejects.toThrow("commercial_invitation_unavailable");
  });

  it("supersedes an older pending token when a replacement is issued", async () => {
    await seedInvitation(db);
    await resetTenantDatabaseRole(db);
    const replacementId = "c1000000-0000-0000-0000-000000000002";
    await db.query(
      `insert into public.organisation_invitations
        (id, organisation_id, invited_email, token_hash, expires_at, invited_by_membership_id)
       values ($1, $2, 'invited@example.test', sha256(convert_to('replacement-token-02', 'UTF8')), now() + interval '7 days', $3)`,
      [replacementId, ORG_A, MEMBERSHIP_A_OWNER],
    );
    const old = await db.query<{ status: string; superseded_by_invitation_id: string }>(
      "select status, superseded_by_invitation_id from public.organisation_invitations where id = $1",
      [INVITATION_ID],
    );
    expect(old.rows).toEqual([{ status: "revoked", superseded_by_invitation_id: replacementId }]);
  });

  it("rejects an invitation when the authenticated email differs", async () => {
    await seedInvitation(db, { email: "different@example.test" });
    await resetTenantDatabaseRole(db);
    await db.query("update auth.users set email = 'invited@example.test' where id = $1", [INVITED_USER]);
    await setTenantAuthUser(db, INVITED_USER);
    await expect(accept(db)).rejects.toThrow("commercial_invitation_unavailable");
  });

  it("rejects duplicate membership instead of adding invited privileges", async () => {
    await seedInvitation(db, { email: "multi@example.test", authUserId: USER_MULTI });
    await setTenantAuthUser(db, USER_MULTI, "aal2");
    await expect(accept(db)).rejects.toThrow("commercial_invitation_duplicate_membership");
  });

  it("revalidates inviter authority at acceptance time", async () => {
    await seedInvitation(db, { inviterId: MEMBERSHIP_A_ADMIN });
    await resetTenantDatabaseRole(db);
    await db.query("update public.organisation_memberships set status = 'suspended', suspended_at = now() where id = $1", [MEMBERSHIP_A_ADMIN]);
    await setTenantAuthUser(db, INVITED_USER, "aal2");
    await expect(accept(db)).rejects.toThrow("commercial_invitation_unavailable");
  });

  it("rejects cross-organisation site intent through composite ownership", async () => {
    await resetTenantDatabaseRole(db);
    await expect(db.query(
      `insert into public.organisation_invitation_site_access
        (organisation_id, invitation_id, site_id) values ($1, 'a1000000-0000-0000-0000-000000000001', $2)`,
      [ORG_A, SITE_B1],
    )).rejects.toThrow();
  });
});
