import { LoginScreen } from "@/components/app/login-screen";
import { safeCommercialContinuation } from "@/lib/invitations/continuation";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const notice = params["password-reset"] === "success"
    ? "Your password has been changed. Sign in with your new password."
    : params["reset-error"] === "invalid"
      ? "That password-reset link is invalid or has expired. Request a new email below."
      : undefined;
  const requestedNext = typeof params.next === "string" ? params.next : undefined;
  return <LoginScreen notice={notice} nextPath={safeCommercialContinuation(requestedNext) ?? undefined} />;
}
