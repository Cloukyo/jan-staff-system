import { redirect } from "next/navigation";
import { ResetPasswordScreen } from "@/components/auth/reset-password-screen";
import { getCurrentAccount } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login?reset-error=invalid");
  return <ResetPasswordScreen />;
}
