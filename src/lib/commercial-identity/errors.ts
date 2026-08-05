export type CommercialIdentityErrorCode =
  | "not_authenticated"
  | "membership_required"
  | "organisation_selection_required"
  | "membership_unavailable"
  | "site_unavailable"
  | "permission_denied"
  | "linked_staff_required"
  | "mfa_required"
  | "stale_preference"
  | "invalid_continuation";

const safeMessages: Record<CommercialIdentityErrorCode, string> = {
  not_authenticated: "Authentication is required.",
  membership_required: "No active organisation access is available.",
  organisation_selection_required: "Select an organisation to continue.",
  membership_unavailable: "The selected organisation is unavailable.",
  site_unavailable: "The selected site is unavailable.",
  permission_denied: "This action is not available.",
  linked_staff_required: "A linked staff profile is required.",
  mfa_required: "Additional authentication is required.",
  stale_preference: "Your organisation access has changed. Please select it again.",
  invalid_continuation: "The requested destination is unavailable.",
};

export class CommercialIdentityError extends Error {
  constructor(readonly code: CommercialIdentityErrorCode) {
    super(safeMessages[code]);
    this.name = "CommercialIdentityError";
  }
}
