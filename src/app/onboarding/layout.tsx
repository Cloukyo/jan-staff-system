import { redirect } from "next/navigation";
import { resolvePostAuthDestinationServer } from "@/lib/auth/post-auth-server";

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const decision = await resolvePostAuthDestinationServer();
  if (!decision.destination.startsWith("/onboarding")) {
    redirect(`/auth/continue?next=${encodeURIComponent(decision.destination)}`);
  }
  return children;
}
