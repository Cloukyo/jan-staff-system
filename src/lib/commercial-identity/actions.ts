"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createLogger } from "@/lib/observability/logging";
import { correlationId } from "@/lib/observability/request-context";
import { resolveMembershipContext } from "./context";
import { resolveAuthenticatedCommercialIdentity } from "./identity";
import { safeCommercialContinuation } from "./preference";
import { writeCommercialPreference } from "./session";
import { createSupabaseCommercialIdentityDependencies } from "./supabase-store";

export async function selectCommercialOrganisation(formData: FormData): Promise<never> {
  const requestId = correlationId((await headers()).get("x-request-id"));
  const membershipId = String(formData.get("membershipId") ?? "");
  const identity = await resolveAuthenticatedCommercialIdentity(await createSupabaseCommercialIdentityDependencies());
  const context = resolveMembershipContext(identity, { requestedMembershipId: membershipId, selectionMode: "sensitive" });
  await writeCommercialPreference({
    membershipId: context.membershipId,
    siteId: null,
    authorisationRevision: context.authorisationRevision,
  });
  createLogger("commercial-identity", { correlationId: requestId }).info("Commercial organisation preference updated");
  redirect(safeCommercialContinuation(String(formData.get("continuation") ?? "/dashboard")));
}
