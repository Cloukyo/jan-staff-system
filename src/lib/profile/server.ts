import type { StaffAccount, StaffCertificate, StaffProfile, StaffQualification } from "@/types";
import { requireAccount } from "@/lib/auth/permissions";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";

export type ProductionProfile = {
  account: StaffAccount;
  profile: StaffProfile;
  qualifications: Pick<StaffQualification, "id" | "qualificationName" | "qualificationLevel">[];
  certificates: Pick<StaffCertificate, "id" | "certificateType" | "customTitle" | "expiryDate">[];
};

export async function loadCurrentProductionProfile(): Promise<ProductionProfile> {
  const account = await requireAccount(["manager", "staff"]);
  const supabase = await createSupabaseServerClient();
  const [profileResult, qualificationResult, certificateResult] = await Promise.all([
    supabase.from("staff_profiles").select("id,full_name,display_name,employment_role,main_qualification_level,is_apprentice,is_cover_staff,appointment_date,active,auth_user_id,email,notes,created_at,updated_at").eq("id", account.staffId).single(),
    supabase.from("staff_qualifications").select("id,qualification_name,qualification_level").eq("staff_id", account.staffId).is("archived_at", null).order("qualification_name"),
    supabase.from("staff_certificates").select("id,certificate_type,custom_title,expiry_date").eq("staff_id", account.staffId).is("archived_at", null).order("certificate_type"),
  ]);
  if (profileResult.error || !profileResult.data) throw new Error("Your linked staff profile could not be loaded.");
  const row = profileResult.data;
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
