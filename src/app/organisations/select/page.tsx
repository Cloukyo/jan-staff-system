import { redirect } from "next/navigation";
import { OrganisationSelector } from "@/components/auth/organisation-selector";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { resolveAuthenticatedCommercialIdentity } from "@/lib/commercial-identity/identity";
import { safeCommercialContinuation } from "@/lib/commercial-identity/preference";
import { readCommercialPreference } from "@/lib/commercial-identity/session";
import { createSupabaseCommercialIdentityDependencies } from "@/lib/commercial-identity/supabase-store";

export const dynamic = "force-dynamic";

export default async function OrganisationSelectionPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  let identity;
  try {
    identity = await resolveAuthenticatedCommercialIdentity(await createSupabaseCommercialIdentityDependencies());
  } catch (error) {
    if (error instanceof CommercialIdentityError && error.code === "not_authenticated") redirect("/login");
    throw error;
  }
  const preference = await readCommercialPreference();
  const preferred = preference ? identity.memberships.find((membership) => membership.membershipId === preference.membershipId) : null;
  const stalePreference = Boolean(preference && (!preferred?.active || preferred.authorisationRevision !== preference.authorisationRevision));
  const { next } = await searchParams;
  return <OrganisationSelector memberships={identity.memberships} continuation={safeCommercialContinuation(next)} stalePreference={stalePreference} />;
}
