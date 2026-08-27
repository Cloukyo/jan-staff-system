import { AppShell } from "@/components/layout/app-shell";
import { isoDateInLondon } from "@/lib/dates/format";
import { loadCommercialAdminServer } from "@/lib/commercial-admin/server";
import { CommercialAdminScreen, type CommercialAdminArea } from "./commercial-admin-screen";
import { notFound } from "next/navigation";
import { BillingNotice } from "@/components/billing/billing-notice";

const requiredPermission: Partial<Record<CommercialAdminArea, string>> = {
  organisation: "organisation.manage", sites: "site.manage", staff: "staff.manage",
  access: "membership.manage", devices: "kiosk.manage", settings: "settings.manage", "site-settings": "settings.manage",
};

export async function CommercialAdminPage({ area }: { area: CommercialAdminArea }) {
  const snapshot = await loadCommercialAdminServer();
  const required = requiredPermission[area];
  if (required && !snapshot.actor.permissions.includes(required)) notFound();
  return <AppShell commercialPermissions={snapshot.actor.permissions}>
    {area === "overview" && snapshot.actor.permissions.includes("billing.manage") ? <BillingNotice/> : null}
    <CommercialAdminScreen area={area} snapshot={snapshot} today={isoDateInLondon()}/>
  </AppShell>;
}
