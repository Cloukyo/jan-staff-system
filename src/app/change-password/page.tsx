import { redirect } from "next/navigation";
import { ChangePasswordScreen } from "@/components/auth/change-password-screen";
import { getCurrentAccount } from "@/lib/auth/permissions";

export const dynamic = "force-dynamic";

export default async function ChangePasswordPage() {
  const account = await getCurrentAccount();
  if (!account) redirect("/login");
  if (!account.mustChangePassword) redirect(account.role === "manager" ? "/dashboard" : "/leave");
  return <ChangePasswordScreen />;
}
