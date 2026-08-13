import { BrandMark } from "@/components/ui/brand";
import { ManagerInvitationAcceptance } from "@/components/invitations/manager-invitation-acceptance";
import {
  currentInvitationIdentityServer,
  inspectManagerInvitationServer,
} from "@/lib/invitations/manager-invitation-server";
import { managerInvitationPath } from "@/lib/invitations/continuation";
export const dynamic = "force-dynamic";
export default async function ManagerInvitationPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams).token;
  const token = typeof raw === "string" ? raw : "";
  const valid = managerInvitationPath(token) !== null;
  const [inspection, identity] = valid
    ? await Promise.all([
        inspectManagerInvitationServer(token),
        currentInvitationIdentityServer(),
      ])
    : [
        { state: "unavailable" },
        { authenticated: false, emailVerified: false, assuranceLevel: "aal1" },
      ];
  return (
    <main className="invitation-shell">
      <section className="invitation-card">
        <BrandMark />
        <ManagerInvitationAcceptance
          token={token}
          inspection={inspection}
          identity={identity}
        />
      </section>
      <aside>
        <strong>Access is checked twice</strong>
        <p>
          The invitation stores the intended role and sites. The server checks
          them again before creating access.
        </p>
      </aside>
    </main>
  );
}
