// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  createServerClient: vi.fn(),
  from: vi.fn(),
  requireAccount: vi.fn(),
  requireSelfActor: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-admin", () => ({
  createSupabaseAdminClient: mocks.createAdminClient,
}));

vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: mocks.createServerClient,
}));

vi.mock("@/lib/auth/permissions", () => ({
  requireAccount: mocks.requireAccount,
}));

vi.mock("@/lib/attendance/server-actor", () => ({
  requireAttendanceSelfActor: mocks.requireSelfActor,
}));

import { loadCurrentProductionProfile } from "@/lib/profile/server";

type QueryResult = { data: unknown; error: null };

function query(result: QueryResult) {
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) builder[method] = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(result));
  builder.then = (resolve: (value: QueryResult) => unknown, reject: (error: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return builder as Record<string, ReturnType<typeof vi.fn>> & { single: ReturnType<typeof vi.fn> };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAccount.mockImplementation(() => {
    throw new Error("commercial profile used the legacy account guard");
  });
  mocks.requireSelfActor.mockResolvedValue({
    kind: "commercial",
    context: {
      membershipId: "membership-a",
      organisationId: "organisation-a",
      staffId: "staff-a",
      active: true,
      roles: [{ role: "staff", scopeType: "organisation", siteId: null }],
    },
  });
});

describe("commercial staff profile", () => {
  it("loads only the authenticated member's linked profile and evidence", async () => {
    const profile = query({
      data: {
        id: "staff-a",
        full_name: "Morgan Example",
        display_name: "Morgan",
        employment_role: "Practitioner",
        main_qualification_level: "Level 3",
        is_apprentice: false,
        is_cover_staff: false,
        appointment_date: "2024-01-15",
        active: true,
        auth_user_id: null,
        email: "morgan@example.com",
        notes: null,
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
      },
      error: null,
    });
    const qualifications = query({
      data: [{ id: "qualification-a", qualification_name: "Early Years Educator", qualification_level: "Level 3" }],
      error: null,
    });
    const certificates = query({
      data: [{ id: "certificate-a", certificate_type: "first_aid", custom_title: null, expiry_date: "2027-01-01" }],
      error: null,
    });
    const queries = { staff_profiles: profile, staff_qualifications: qualifications, staff_certificates: certificates };
    mocks.from.mockImplementation((table: keyof typeof queries) => queries[table]);
    mocks.createAdminClient.mockReturnValue({ from: mocks.from });

    const result = await loadCurrentProductionProfile();

    expect(result.account).toMatchObject({
      id: "membership-a",
      staffId: "staff-a",
      fullName: "Morgan Example",
      email: "morgan@example.com",
      role: "staff",
      active: true,
      mustChangePassword: false,
    });
    expect(result.profile.id).toBe("staff-a");
    expect(result.qualifications).toHaveLength(1);
    expect(result.certificates).toHaveLength(1);
    expect(mocks.requireSelfActor).toHaveBeenCalledOnce();
    expect(mocks.requireAccount).not.toHaveBeenCalled();
    expect(mocks.createAdminClient).toHaveBeenCalledOnce();
    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(profile.eq).toHaveBeenCalledWith("organisation_id", "organisation-a");
    expect(profile.eq).toHaveBeenCalledWith("id", "staff-a");
    for (const scopedQuery of [qualifications, certificates]) {
      expect(scopedQuery.eq).toHaveBeenCalledWith("organisation_id", "organisation-a");
      expect(scopedQuery.eq).toHaveBeenCalledWith("staff_id", "staff-a");
    }
  });
});
