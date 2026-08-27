import { redirect } from "next/navigation";
import { LiveWelcome } from "@/components/commercial/live-welcome";
import { loadOnboardingBootstrapServer } from "@/lib/onboarding/server";

export const dynamic = "force-dynamic";

export default async function CommercialWelcomePage() {
  const snapshot = await loadOnboardingBootstrapServer();
  if (snapshot.session.status !== "live" || !snapshot.liveSummary) redirect("/onboarding/readiness");
  return <LiveWelcome summary={snapshot.liveSummary}/>;
}
