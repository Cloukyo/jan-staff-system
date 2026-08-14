import { notFound } from "next/navigation";
import { CommercialKioskRegistration, CommercialPreLiveKiosk } from "@/components/kiosk/commercial-kiosk-registration";
import { KioskSetup } from "@/components/onboarding/kiosk-setup";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import type { KioskOnboardingSnapshot } from "@/lib/onboarding/kiosk-contracts";

const previewSnapshot: KioskOnboardingSnapshot = {
  availableSites: [{ siteId: "71000000-0000-4000-8000-000000000001", displayName: "Atlas Central" }],
  registration: { registrationId: "71000000-0000-4000-8000-000000000002", siteId: "71000000-0000-4000-8000-000000000001", deviceName: "Reception tablet", status: "verified", expiresAt: "2026-08-14T03:00:00+01:00", claimedDeviceId: "71000000-0000-4000-8000-000000000003", revision: "3" },
  device: { deviceId: "71000000-0000-4000-8000-000000000003", siteId: "71000000-0000-4000-8000-000000000001", deviceName: "Reception tablet", active: true, status: "connected", lastSeenAt: "2026-08-14T02:45:00+01:00", appVersion: "preview", protocolVersion: 1, platformCategory: "tablet" },
  readiness: { complete: false, registrationReady: true, deviceActive: true, bindingValid: true, heartbeatRecent: true, rosterVerified: true, eligibleStaffCount: 3, pinReadyStaffCount: 2, offlineDisabled: true, offlineAuthorisationCount: 0 },
  staff: [
    { staffId: "fictional-staff-1", displayName: "Taylor Example", siteAssigned: true, attendanceEligible: true, pinRequired: true, pinReady: true, visibleOnKiosk: true },
    { staffId: "fictional-staff-2", displayName: "Morgan Sample", siteAssigned: true, attendanceEligible: true, pinRequired: true, pinReady: true, visibleOnKiosk: true },
    { staffId: "fictional-staff-3", displayName: "Casey Placeholder", siteAssigned: true, attendanceEligible: true, pinRequired: true, pinReady: false, visibleOnKiosk: false },
  ],
};

export default async function VisualCommercialPreview({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  if (!["local","preview"].includes(process.env.APP_ENV ?? "")) notFound();
  const state = (await searchParams).state;
  if (state === "register") return <CommercialKioskRegistration registrationId="71000000-0000-4000-8000-000000000002" registrationCode="ABCD2345EFGH6789"/>;
  if (state === "prelive") return <CommercialPreLiveKiosk siteName="Atlas Central" staffCount={2}/>;
  return <OnboardingShell activeStep="kiosk" completedSteps={["owner_security","legal_acceptance","organisation","first_site","subscription","staffing","manager_invitations","staff_invitations"]}><div className="onboarding-page-heading"><span>Clocking device</span><h1>Connect your online staff clock</h1><p>Register one browser to your location, check its connection and prepare at least one staff PIN.</p></div><KioskSetup snapshot={previewSnapshot} revision="18" keys={Array.from({length:8},(_,index)=>`71000000-0000-4000-8000-${String(index+10).padStart(12,"0")}`)}/></OnboardingShell>;
}
