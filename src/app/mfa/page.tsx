import { redirect } from "next/navigation";
import { BrandMark } from "@/components/ui/brand";
import { MfaSetup } from "@/components/onboarding/mfa-setup";
import { createSupabaseServerClient } from "@/lib/auth/supabase-server";
import { safeCommercialContinuation } from "@/lib/invitations/continuation";

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServerClient();
  const requested = (await searchParams).next;
  const nextPath = safeCommercialContinuation(typeof requested === "string" ? requested : undefined) ?? "/onboarding";
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  const [assurance, factors] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
  ]);
  if (assurance.data?.currentLevel === "aal2") redirect(nextPath);
  const hasVerifiedFactor = factors.data?.totp.some((factor) => factor.status === "verified") ?? false;
  return <main className="onboarding-auth-shell"><section className="onboarding-auth-card"><BrandMark /><div><span>Account security</span><h1>Multi-factor authentication</h1><p>Organisation owner actions require a verified authenticator code. This check is enforced again by the server.</p></div><MfaSetup nextPath={nextPath} hasVerifiedFactor={hasVerifiedFactor} /></section><aside><strong>Why this is required</strong><p>Multi-factor authentication protects organisation ownership, access and future administrative actions.</p></aside></main>;
}
