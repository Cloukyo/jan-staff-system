import { BrandMark } from "@/components/ui/brand";
import { StaffInvitationAcceptance } from "@/components/invitations/staff-invitation-acceptance";
import {
  currentStaffInvitationIdentityServer,
  inspectStaffInvitationServer,
} from "@/lib/invitations/staff-invitation-server";
import { staffInvitationPath } from "@/lib/invitations/continuation";
export const dynamic = "force-dynamic";
export default async function StaffInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const valid = staffInvitationPath(token) !== null;
  const [inspection, identity] = valid
    ? await Promise.all([
        inspectStaffInvitationServer(token),
        currentStaffInvitationIdentityServer(),
      ])
    : [
        { state: "unavailable" },
        { authenticated: false, emailVerified: false },
      ];
  return (
    <main className="invitation-shell">
      <section className="invitation-card">
        <BrandMark />
        <StaffInvitationAcceptance
          token={token}
          inspection={inspection}
          identity={identity}
        />
      </section>
      <aside>
        <strong>Your staff profile stays intact</strong>
        <p>
          Accepting links your login to the existing profile and its authorised
          sites. It does not change attendance evidence or create management
          access.
        </p>
      </aside>
    </main>
  );
}
