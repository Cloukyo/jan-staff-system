"use server";
import { redirect } from "next/navigation";
import { createHostedCheckout, createHostedPortal, updateHostedSubscription } from "./server";

export async function startBillingCheckout(formData: FormData): Promise<never> {
  const url = await createHostedCheckout({ planKey: String(formData.get("planKey")), planVersion: Number(formData.get("planVersion")), idempotencyKey: String(formData.get("idempotencyKey") || crypto.randomUUID()), returnPath: "/admin/billing" });
  redirect(url);
}
export async function openBillingPortal(): Promise<never> { redirect(await createHostedPortal("/admin/billing")); }
export async function requestSubscriptionCancellation(formData: FormData) {
  await updateHostedSubscription({ cancelAtPeriodEnd: true, idempotencyKey: String(formData.get("idempotencyKey") || crypto.randomUUID()) });
  redirect("/admin/billing?change=requested");
}
export async function resumeSubscription(formData: FormData) {
  await updateHostedSubscription({ cancelAtPeriodEnd: false, idempotencyKey: String(formData.get("idempotencyKey") || crypto.randomUUID()) });
  redirect("/admin/billing?change=requested");
}
export async function changeBillingPlan(formData: FormData) {
  await updateHostedSubscription({ planKey: String(formData.get("planKey")), planVersion: Number(formData.get("planVersion")), idempotencyKey: String(formData.get("idempotencyKey") || crypto.randomUUID()) });
  redirect("/admin/billing?change=requested");
}
