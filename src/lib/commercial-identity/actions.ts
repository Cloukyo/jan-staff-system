"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createLogger } from "@/lib/observability/logging";
import { correlationId } from "@/lib/observability/request-context";
import { CommercialIdentityError } from "./errors";
import type { CommercialIdentitySnapshot, CommercialMembershipContext } from "@/types/tenancy";
import { resolveOrganisationSelection, resolveSelectionMembership, resolveSiteSelection, sitePreference, siteSelectionUrl } from "./site-navigation";
import { resolveAuthenticatedCommercialIdentity } from "./identity";
import { safeCommercialContinuation } from "./preference";
import { clearCommercialPreference, readCommercialPreference, writeCommercialPreference } from "./session";
import { createSupabaseCommercialIdentityDependencies } from "./supabase-store";

async function selectionIdentity() {
  try {
    return await resolveAuthenticatedCommercialIdentity(await createSupabaseCommercialIdentityDependencies());
  } catch (error) {
    if (error instanceof CommercialIdentityError && error.code === "not_authenticated") redirect("/login");
    throw error;
  }
}

async function recoverSelection(error: unknown, identity: CommercialIdentitySnapshot, membershipId: string, continuation: string): Promise<never> {
  if (!(error instanceof CommercialIdentityError)) throw error;
  let context: CommercialMembershipContext | null = null;
  try { context = resolveSelectionMembership(identity, membershipId); } catch (selectionError) {
    if (!(selectionError instanceof CommercialIdentityError)) throw selectionError;
  }
  if (context) {
    await writeCommercialPreference(sitePreference(context));
    redirect(siteSelectionUrl(continuation, true));
  }
  await clearCommercialPreference();
  redirect(`/organisations/select?next=${encodeURIComponent(continuation)}`);
}

export async function selectCommercialOrganisation(formData: FormData): Promise<never> {
  const requestId = correlationId((await headers()).get("x-request-id"));
  const membershipId = String(formData.get("membershipId") ?? "");
  const continuation = safeCommercialContinuation(String(formData.get("continuation") ?? "/dashboard"));
  const identity = await selectionIdentity();
  let context: CommercialMembershipContext;
  try { context = resolveOrganisationSelection(identity, membershipId); } catch (error) {
    return recoverSelection(error, identity, membershipId, continuation);
  }
  await writeCommercialPreference(sitePreference(context));
  createLogger("commercial-identity", { correlationId: requestId }).info("Commercial organisation preference updated");
  redirect(context.selectedSiteId ? continuation : siteSelectionUrl(continuation));
}

export async function selectCommercialSite(formData: FormData): Promise<never> {
  const requestId = correlationId((await headers()).get("x-request-id"));
  const membershipId = String(formData.get("membershipId") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const continuation = safeCommercialContinuation(String(formData.get("continuation") ?? "/dashboard"));
  const identity = await selectionIdentity();
  const preference = await readCommercialPreference();
  const submittedRevision = formData.get("authorisationRevision");
  const revision = submittedRevision === null
    ? (preference?.membershipId === membershipId ? preference.authorisationRevision : undefined)
    : Number(submittedRevision);
  let context: CommercialMembershipContext;
  try {
    context = resolveSiteSelection(identity, membershipId, siteId, revision);
  } catch (error) {
    return recoverSelection(error, identity, membershipId, continuation);
  }
  await writeCommercialPreference(sitePreference(context));
  createLogger("commercial-identity", { correlationId: requestId }).info("Commercial site preference updated");
  redirect(continuation);
}
