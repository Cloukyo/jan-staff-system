import { CommercialIdentityError } from "./errors";
import { safeCommercialContinuation } from "./preference";

export type CommercialProtectedRouteRecovery =
  | { kind: "redirect"; destination: string }
  | { kind: "not_found" }
  | { kind: "rethrow" };

export function commercialProtectedRouteRecovery(
  error: unknown,
  continuation: string,
): CommercialProtectedRouteRecovery {
  if (!(error instanceof CommercialIdentityError)) return { kind: "rethrow" };

  const safeContinuation = safeCommercialContinuation(continuation);
  const encodedContinuation = encodeURIComponent(safeContinuation);

  if (error.code === "not_authenticated") {
    return { kind: "redirect", destination: `/login?next=${encodedContinuation}` };
  }
  if (error.code === "mfa_required") {
    return { kind: "redirect", destination: `/mfa?next=${encodedContinuation}` };
  }
  if ([
    "membership_required",
    "organisation_selection_required",
    "membership_unavailable",
    "site_unavailable",
    "stale_preference",
  ].includes(error.code)) {
    return {
      kind: "redirect",
      destination: `/organisations/select?next=${encodedContinuation}`,
    };
  }
  if (error.code === "permission_denied" || error.code === "linked_staff_required") {
    return { kind: "not_found" };
  }
  return { kind: "rethrow" };
}
