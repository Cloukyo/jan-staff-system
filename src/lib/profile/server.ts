import type { StaffAccount, StaffCertificate, StaffProfile, StaffQualification } from "@/types";
import { requireAttendanceSelfActor } from "@/lib/attendance/server-actor";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type ProductionProfile = {
  account: StaffAccount;
  profile: StaffProfile;
  qualifications: Pick<StaffQualification, "id" | "qualificationName" | "qualificationLevel">[];
  certificates: Pick<StaffCertificate, "id" | "certificateType" | "customTitle" | "expiryDate">[];
};

export async function loadCurrentProductionProfile(): Promise<ProductionProfile> {
  const actor = await requireAttendanceSelfActor();
  const commercialContext = actor.kind === "commercial" ? actor.context : null;
  const staffId = commercialContext?.staffId ?? (actor.kind === "legacy" ? actor.account.staffId : null);
  if (!staffId) throw new Error("Your linked staff profile could not be resolved.");
  const supabase = commercialContext
    ? (await import("@/lib/auth/supabase-admin")).createSupabaseAdminClient()
    : await createSupabaseServerClient();
  let profileQuery = supabase.from("staff_profiles").select("id,full_name,display_name,employment_role,main_qualification_level,is_apprentice,is_cover_staff,appointment_date,active,auth_user_id,email,notes,created_at,updated_at").eq("id", staffId);
  let qualificationQuery = supabase.from("staff_qualifications").select("id,qualification_name,qualification_level").eq("staff_id", staffId).is("archived_at", null).order("qualification_name");
  let certificateQuery = supabase.from("staff_certificates").select("id,certificate_type,custom_title,expiry_date").eq("staff_id", staffId).is("archived_at", null).order("certificate_type");
  if (commercialContext) {
    profileQuery = profileQuery.eq("organisation_id", commercialContext.organisationId);
    qualificationQuery = qualificationQuery.eq("organisation_id", commercialContext.organisationId);
    certificateQuery = certificateQuery.eq("organisation_id", commercialContext.organisationId);
  }
  const [profileResult, qualificationResult, certificateResult] = await Promise.all([
    profileQuery.single(),
    qualificationQuery,
    certificateQuery,
  ]);
  if (profileResult.error || !profileResult.data) throw new Error("Your linked staff profile could not be loaded.");
  const row = profileResult.data;
  const account: StaffAccount = actor.kind === "legacy" ? actor.account : {
    id: commercialContext!.membershipId,
    authUserId: row.auth_user_id,
    staffId,
    fullName: row.full_name,
    email: row.email ?? "",
    role: commercialContext!.roles.some((assignment) => assignment.role !== "staff") ? "manager" : "staff",
    active: commercialContext!.active,
    mustChangePassword: false,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  return {
    account,
    profile: {
      id: row.id,
      fullName: row.full_name,
      displayName: row.display_name,
      employmentRole: row.employment_role,
      mainQualificationLevel: row.main_qualification_level,
      isApprentice: row.is_apprentice,
      isCoverStaff: row.is_cover_staff,
      appointmentDate: row.appointment_date,
      active: row.active,
      authUserId: row.auth_user_id,
      email: row.email,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    qualifications: (qualificationResult.data ?? []).map((item) => ({
      id: item.id,
      qualificationName: item.qualification_name,
      qualificationLevel: item.qualification_level,
    })),
    certificates: (certificateResult.data ?? []).map((item) => ({
      id: item.id,
      certificateType: item.certificate_type,
      customTitle: item.custom_title,
      expiryDate: item.expiry_date,
    })),
  };
}
