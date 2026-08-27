import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { loadBillingServer } from "@/lib/billing/server";

export async function BillingNotice() {
  const { snapshot } = await loadBillingServer();
  if (snapshot.noticeCode === "none") return null;
  const message = snapshot.accessMode === "restricted" ? "Billing needs attention. Core attendance and your records remain available."
    : snapshot.accessMode === "grace" ? "Payment recovery is needed before the grace period ends."
      : "Your trial ends within 14 days. Add payment details when you are ready to continue.";
  return <aside className={`billing-global-notice billing-global-notice--${snapshot.accessMode}`} aria-label="Billing notice">
    <AlertTriangle aria-hidden/><p><strong>{message}</strong><span>Growth and premium changes may be limited, but billing never removes your attendance evidence.</span></p>
    <Link href="/admin/billing">Review billing</Link>
  </aside>;
}
