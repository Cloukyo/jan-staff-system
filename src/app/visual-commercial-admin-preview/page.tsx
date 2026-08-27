import { notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import {
  CommercialAdminScreen,
  type CommercialAdminArea,
} from "@/components/commercial-admin/commercial-admin-screen";
import type { CommercialAdminSnapshot } from "@/lib/commercial-admin/contracts";

const ids = {
  organisation: "82000000-0000-4000-8000-000000000001",
  owner: "82000000-0000-4000-8000-000000000002",
  manager: "82000000-0000-4000-8000-000000000003",
  siteOne: "82000000-0000-4000-8000-000000000004",
  siteTwo: "82000000-0000-4000-8000-000000000005",
  assignmentOne: "82000000-0000-4000-8000-000000000006",
  assignmentTwo: "82000000-0000-4000-8000-000000000007",
  invitation: "82000000-0000-4000-8000-000000000008",
  device: "82000000-0000-4000-8000-000000000009",
  area: "82000000-0000-4000-8000-000000000010",
  closure: "82000000-0000-4000-8000-000000000011",
};

const snapshot: CommercialAdminSnapshot = {
  organisation: {
    id: ids.organisation,
    displayName: "Northstar Example Works",
    legalName: "Northstar Example Works Limited",
    contactEmail: "operations@example.invalid",
    contactPhone: "+44 7700 900000",
    countryCode: "GB",
    timezone: "Europe/London",
    operationalState: "live",
    addressLine1: "1 Example Square",
    addressLine2: null,
    locality: "Sampleton",
    region: "Fictionshire",
    postcode: "AA1 1AA",
    revision: 12,
  },
  actor: {
    membershipId: ids.owner,
    revision: 3,
    permissions: ["organisation.manage", "site.manage", "staff.manage", "membership.manage", "kiosk.manage", "settings.manage"],
  },
  selectedSiteId: ids.siteOne,
  sites: [
    { id: ids.siteOne, name: "Northstar Central", slug: "northstar-central", active: true, timezone: "Europe/London", addressLine1: "1 Example Square", locality: "Sampleton", postcode: "AA1 1AA", phone: null, email: null, archivedAt: null, revision: 4 },
    { id: ids.siteTwo, name: "Northstar Riverside", slug: "northstar-riverside", active: true, timezone: "Europe/London", addressLine1: "2 Placeholder Lane", locality: "Sampleton", postcode: "AA2 2AA", phone: null, email: null, archivedAt: null, revision: 2 },
  ],
  staff: [
    { id: "fictional-staff-taylor", fullName: "Taylor Example", displayName: "Taylor", employmentRole: "Operations coordinator", email: "taylor@example.invalid", active: true, appointmentDate: "2026-08-01", revision: 3, assignments: [{ id: ids.assignmentOne, siteId: ids.siteOne, siteName: "Northstar Central", effectiveFrom: "2026-08-01", effectiveTo: null, primary: true, revision: 2 }], kiosk: { enabled: true, pinReady: true } },
    { id: "fictional-staff-morgan", fullName: "Morgan Sample", displayName: "Morgan", employmentRole: "Team member", email: "morgan@example.invalid", active: true, appointmentDate: "2026-08-04", revision: 2, assignments: [{ id: ids.assignmentTwo, siteId: ids.siteTwo, siteName: "Northstar Riverside", effectiveFrom: "2026-08-04", effectiveTo: null, primary: true, revision: 1 }], kiosk: { enabled: false, pinReady: false } },
  ],
  memberships: [
    { id: ids.owner, email: "owner@example.invalid", status: "active", staffId: null, revision: 3, roles: [{ role: "organisation_owner", scopeType: "organisation", siteId: null }], siteIds: [] },
    { id: ids.manager, email: "manager@example.invalid", status: "active", staffId: null, revision: 2, roles: [{ role: "site_manager", scopeType: "site", siteId: ids.siteTwo }], siteIds: [ids.siteTwo] },
  ],
  invitations: [{ id: ids.invitation, email: "invitee@example.invalid", kind: "manager", status: "pending", expiresAt: "2026-08-21T12:00:00.000Z", staffId: null }],
  workAreas: [{ id: ids.area, siteId: ids.siteOne, name: "Front office", code: "front-office", active: true, revision: 1 }],
  closures: [{ id: ids.closure, siteId: ids.siteOne, label: "Example closure", startsOn: "2026-12-25", endsOn: "2026-12-25", revision: 1 }],
  devices: [{ id: ids.device, siteId: ids.siteOne, deviceName: "Reception tablet", active: true, lastSeenAt: "2026-08-14T10:25:00.000Z", appVersion: "preview", protocolVersion: 1, reprovisionRequired: false, offlineEnabled: false }],
  settings: {
    organisation: { workWeekStarts: 1, defaultTimezone: "Europe/London", operatingDefaults: {}, staffingDefaults: {}, branding: {}, revision: 2 },
    sites: [
      { siteId: ids.siteOne, openingTime: "08:00:00", closingTime: "18:00:00", timezoneOverride: null, workWeekStartsOverride: null, operatingOverrides: {}, staffingOverrides: {}, revision: 2 },
      { siteId: ids.siteTwo, openingTime: "08:30:00", closingTime: "17:30:00", timezoneOverride: null, workWeekStartsOverride: null, operatingOverrides: {}, staffingOverrides: {}, revision: 1 },
    ],
  },
};

const allowedAreas: CommercialAdminArea[] = ["overview", "organisation", "sites", "staff", "access", "devices", "settings", "site-settings"];

export default async function VisualCommercialAdminPreview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!["local", "preview"].includes(process.env.APP_ENV ?? "")) notFound();
  const requested = (await searchParams).area;
  const area = typeof requested === "string" && allowedAreas.includes(requested as CommercialAdminArea)
    ? requested as CommercialAdminArea
    : "overview";
  return (
    <AppShell commercialPermissions={snapshot.actor.permissions}>
      <CommercialAdminScreen snapshot={snapshot} area={area} today="2026-08-14" />
    </AppShell>
  );
}
