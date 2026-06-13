import { LoginScreen } from "@/components/app/login-screen";

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
  return <LoginScreen notice={notice} />;
}
