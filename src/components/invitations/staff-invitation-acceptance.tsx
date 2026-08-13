"use client";
import Link from "next/link";
import { useActionState } from "react";
import {
  CheckCircle2,
  Clock3,
  ShieldAlert,
  UserRoundCheck,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import {
  acceptStaffInvitationAction,
  resendStaffInvitationVerificationAction,
  type StaffInvitationAcceptanceActionState,
} from "@/lib/invitations/staff-invitation-actions";
const copy: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This invitation has expired",
    body: "Ask an authorised manager to resend it.",
  },
  revoked: {
    title: "This invitation was revoked",
    body: "Contact your organisation if you still need an account.",
  },
  superseded: {
    title: "This invitation has been replaced",
    body: "Use the newest invitation you received.",
  },
  accepted: {
    title: "Account linked",
    body: "Your login is linked to your staff profile.",
  },
  already_linked: {
    title: "Account already linked",
    body: "This login is already linked to your staff profile.",
  },
  membership_conflict: {
    title: "Account link needs review",
    body: "An existing organisation account conflicts with this staff profile. Nothing was changed.",
  },
  staff_identity_changed: {
    title: "Staff details changed",
    body: "Ask an authorised manager to review and resend the invitation.",
  },
  authority_changed: {
    title: "Invitation needs review",
    body: "The inviter can no longer grant this account access.",
  },
  email_verification_required: {
    title: "Verify your email",
    body: "Verify the invited email address before accepting.",
  },
  unavailable: {
    title: "Invitation unavailable",
    body: "The link is invalid or no longer available.",
  },
};
export function StaffInvitationAcceptance({
  token,
  inspection,
  identity,
}: {
  token: string;
  inspection: { state: string; organisationName?: string };
  identity: { authenticated: boolean; emailVerified: boolean };
}) {
  const [state, action, pending] = useActionState(acceptStaffInvitationAction, {
    outcome: "",
    message: "",
  } satisfies StaffInvitationAcceptanceActionState);
  const outcome = state.outcome || inspection.state;
  if (copy[outcome])
    return (
      <State
        title={copy[outcome].title}
        body={state.message || copy[outcome].body}
        success={["accepted", "already_linked"].includes(outcome)}
      />
    );
  const next = `/invitations/staff?token=${encodeURIComponent(token)}`;
  if (!identity.authenticated)
    return (
      <div className="invitation-actions">
        <State
          title="Sign in to continue"
          body={`Use the email address invited to ${inspection.organisationName ?? "the organisation"}.`}
        />
        <Link
          className="onboarding-button-link"
          href={`/login?next=${encodeURIComponent(next)}`}
        >
          Sign in
        </Link>
        <Link
          className="invitation-secondary-link"
          href={`/signup?next=${encodeURIComponent(next)}`}
        >
          Create an account
        </Link>
      </div>
    );
  if (!identity.emailVerified)
    return (
      <div className="invitation-actions">
        <State
          title="Verify your email"
          body="Open the verification email, then return to this invitation."
        />
        <form action={resendStaffInvitationVerificationAction}>
          <input type="hidden" name="token" value={token} />
          <Button variant="secondary" style={{ minHeight: 44 }}>
            Resend verification email
          </Button>
        </form>
      </div>
    );
  return (
    <form action={action} className="invitation-actions">
      <input type="hidden" name="token" value={token} />
      <State
        title="Link your login"
        body={`${inspection.organisationName ?? "The organisation"} invited you to link this login to your existing staff profile. Your assigned sites are checked again before anything changes.`}
      />
      <Button disabled={pending} style={{ minHeight: 44 }}>
        {pending ? "Linking securely..." : "Accept and link account"}
      </Button>
    </form>
  );
}
function State({
  title,
  body,
  success = false,
}: {
  title: string;
  body: string;
  success?: boolean;
}) {
  const Icon = success
    ? CheckCircle2
    : title.includes("expired")
      ? Clock3
      : title.includes("Link")
        ? UserRoundCheck
        : ShieldAlert;
  return (
    <div
      className={`invitation-state ${success ? "invitation-state--success" : ""}`}
    >
      <Icon aria-hidden />
      <h1>{title}</h1>
      <p>{body}</p>
    </div>
  );
}
