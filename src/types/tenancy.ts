export const ORGANISATION_ROLES = [
  "organisation_owner",
  "organisation_admin",
  "hr_admin",
  "payroll_admin",
  "site_manager",
  "scheduler",
  "staff",
] as const;

export type OrganisationRole = (typeof ORGANISATION_ROLES)[number];

export const ORGANISATION_PERMISSIONS = [
  "organisation.manage",
  "organisation.audit.read",
  "billing.manage",
  "membership.read",
  "membership.manage",
  "site.read",
  "site.manage",
  "staff.read",
  "staff.manage",
  "compliance.read",
  "compliance.manage",
  "leave.read",
  "leave.manage",
  "rota.read",
  "rota.manage",
  "attendance.read",
  "attendance.review",
  "attendance.correct",
  "payroll.read",
  "payroll.prepare",
  "payroll.export",
  "kiosk.read",
  "kiosk.manage",
  "settings.manage",
] as const;

export type OrganisationPermission = (typeof ORGANISATION_PERMISSIONS)[number];
export type OrganisationStatus = "trial" | "active" | "past_due" | "suspended" | "offboarding" | "closed";
export type OrganisationMembershipStatus = "invited" | "active" | "suspended" | "revoked";
export type MembershipScopeType = "organisation" | "site";
export type OrganisationInvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export function isOrganisationRole(value: string): value is OrganisationRole {
  return (ORGANISATION_ROLES as readonly string[]).includes(value);
}

export function isOrganisationPermission(value: string): value is OrganisationPermission {
  return (ORGANISATION_PERMISSIONS as readonly string[]).includes(value);
}

export interface Organisation {
  id: string;
  legalName: string;
  displayName: string;
  slug: string;
  status: OrganisationStatus;
  countryCode: string;
  timezone: string;
  billingEmail: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationSite {
  id: string;
  organisationId: string;
  name: string;
  slug: string;
  timezone: string;
  active: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OrganisationMembership {
  id: string;
  organisationId: string;
  authUserId: string;
  staffId: string | null;
  status: OrganisationMembershipStatus;
  joinedAt: string | null;
  suspendedAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MembershipRoleAssignment {
  id: string;
  organisationId: string;
  membershipId: string;
  role: OrganisationRole;
  scopeType: MembershipScopeType;
  siteId: string | null;
  grantedAt: string;
  revokedAt: string | null;
}

export interface MembershipSiteAccess {
  id: string;
  organisationId: string;
  membershipId: string;
  siteId: string;
  grantedAt: string;
  revokedAt: string | null;
}

export interface StaffSiteAssignment {
  id: string;
  organisationId: string;
  staffId: string;
  siteId: string;
  effectiveFrom: string;
  effectiveTo: string | null;
  isPrimary: boolean;
  employmentRole: string | null;
  createdAt: string;
  updatedAt: string;
}

export type AuthenticatorAssuranceLevel = "aal1" | "aal2";

export interface CommercialRoleSummary {
  role: OrganisationRole;
  scopeType: MembershipScopeType;
  siteId: string | null;
}

export interface CommercialMembershipSummary {
  membershipId: string;
  organisationId: string;
  organisationDisplayName: string;
  organisationStatus: OrganisationStatus;
  organisationArchived: boolean;
  status: OrganisationMembershipStatus;
  active: boolean;
  staffId: string | null;
  authorisationRevision: number;
  roles: CommercialRoleSummary[];
  siteAccess: string[];
  permissions: OrganisationPermission[];
  sitePermissions: Record<string, OrganisationPermission[]>;
}

export interface CommercialIdentitySnapshot {
  authUserId: string;
  email: string | null;
  aal: AuthenticatorAssuranceLevel;
  memberships: CommercialMembershipSummary[];
}

export interface CommercialMembershipContext extends CommercialMembershipSummary {
  selectedSiteId: string | null;
  permittedSiteIds: string[];
  permissions: OrganisationPermission[];
}
