import { notFound } from "next/navigation";
import { CommercialKioskRegistration, CommercialPreLiveKiosk } from "@/components/kiosk/commercial-kiosk-registration";
import { KioskSetup } from "@/components/onboarding/kiosk-setup";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { ReadinessReview } from "@/components/onboarding/readiness-review";
import { LiveWelcome } from "@/components/commercial/live-welcome";
import type { KioskOnboardingSnapshot } from "@/lib/onboarding/kiosk-contracts";
import type { CommercialReadinessSnapshot } from "@/lib/onboarding/readiness-contracts";

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

const readinessItems: CommercialReadinessSnapshot["items"] = [
  ["owner_security","account","Owner account"], ["legal_acceptance","account","Legal documents"], ["organisation_active","organisation","Organisation"],
  ["first_site","site","First site"], ["subscription_pending","plan","Free trial"], ["staff_present","staff","Staff"],
  ["manager_coverage","managers","Manager coverage"], ["staff_account_linkage","staff_accounts","Staff accounts"],
  ["online_kiosk","clocking_device","Clocking device"], ["attendance_safety","attendance","Attendance safety"], ["offline_disabled","attendance","Offline attendance"],
].map(([key,category,title]) => ({ key: key as CommercialReadinessSnapshot["items"][number]["key"], category: category as CommercialReadinessSnapshot["items"][number]["category"], status: key === "manager_coverage" ? "warning" : "ready", severity: key === "manager_coverage" ? "warning" : "blocker", title, explanation: key === "manager_coverage" ? "The owner is currently the sole manager. You can continue after acknowledging this." : `${title} is ready.`, remediationRoute: key === "manager_coverage" ? "/onboarding/managers" : null, evidenceRevision: `${key}:1` }));
const readinessPreview: CommercialReadinessSnapshot = { evaluatorVersion: 2, sessionId: "71000000-0000-4000-8000-000000000010", organisationId: "71000000-0000-4000-8000-000000000011", workflowRevision: "24", fingerprint: "a".repeat(64), overallStatus: "ready", blockerCount: 0, warningCount: 1, progressPercent: 100, evaluatedAt: "2026-08-14T05:00:00.000Z", items: readinessItems };

export default async function VisualCommercialPreview({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  if (!["local","preview"].includes(process.env.APP_ENV ?? "")) notFound();
  const state = (await searchParams).state;
  if (state === "register") return <CommercialKioskRegistration registrationId="71000000-0000-4000-8000-000000000002" registrationCode="ABCD2345EFGH6789"/>;
  if (state === "prelive") return <CommercialPreLiveKiosk siteName="Atlas Central" staffCount={2}/>;
  if (state === "setup") return <OnboardingShell activeStep="kiosk" completedSteps={["owner_security","legal_acceptance","organisation","first_site","subscription","staffing","manager_invitations","staff_invitations"]}><div className="onboarding-page-heading"><span>Clocking device</span><h1>Connect your online staff clock</h1><p>Register one browser to your location, check its connection and prepare at least one staff PIN.</p></div><KioskSetup snapshot={previewSnapshot} revision="18" keys={Array.from({length:8},(_,index)=>`71000000-0000-4000-8000-${String(index+10).padStart(12,"0")}`)}/></OnboardingShell>;
  if (state === "live") return <LiveWelcome summary={{ organisationId: readinessPreview.organisationId, organisationName: "Atlas Example", siteId: "71000000-0000-4000-8000-000000000001", siteName: "Atlas Central", subscriptionId: "71000000-0000-4000-8000-000000000012", subscriptionState: "trial_active", trialStartedAt: "2026-08-14T05:00:00.000Z", trialEndsAt: "2026-10-13T05:00:00.000Z", staffCount: 3, kioskConnected: true, offlineEnabled: false }}/>;
  return <OnboardingShell activeStep="readiness" completedSteps={["owner_security","legal_acceptance","organisation","first_site","subscription","staffing","manager_invitations","staff_invitations","kiosk"]}><div className="onboarding-page-heading"><span>Final review</span><h1>Ready to start live attendance?</h1><p>These checks come directly from your current organisation, staff and clocking device setup.</p></div><ReadinessReview readiness={readinessPreview} revision="24" refreshKey="71000000-0000-4000-8000-000000000020" goLiveKey="71000000-0000-4000-8000-000000000021"/></OnboardingShell>;
}
