"use client";
import Link from "next/link";
import { useActionState } from "react";
import { CheckCircle2, Clock3, LockKeyhole, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import {
  acceptManagerInvitationAction,
  resendManagerInvitationVerificationAction,
  type InvitationAcceptanceActionState,
} from "@/lib/invitations/manager-invitation-actions";
const copy: Record<string, { title: string; body: string }> = {
  expired: {
    title: "This invitation has expired",
    body: "Ask the organisation owner to resend it.",
  },
  revoked: {
    title: "This invitation was revoked",
    body: "Contact the organisation owner if you still need access.",
  },
  superseded: {
    title: "This invitation has been replaced",
    body: "Use the newest invitation you received.",
  },
  accepted: {
    title: "Invitation accepted",
    body: "Your organisation access is ready.",
  },
  already_accepted: {
    title: "Invitation accepted",
    body: "This invitation was already completed safely.",
  },
  membership_already_exists: {
    title: "Membership already exists",
    body: "No duplicate access was created. Contact an organisation owner to change your role.",
  },
  authority_changed: {
    title: "Invitation needs review",
    body: "The inviter no longer has authority to grant this access. Ask an organisation owner to send a new invitation.",
  },
  scope_changed: {
    title: "Site access changed",
    body: "One or more intended sites are no longer available. Ask an organisation owner to review and resend the invitation.",
  },
  email_verification_required: {
    title: "Verify your email",
    body: "Verify the invited email address before accepting this invitation.",
  },
  unavailable: {
    title: "Invitation unavailable",
    body: "The link is invalid or no longer available.",
  },
};
export function ManagerInvitationAcceptance({
  token,
  inspection,
  identity,
}: {
  token: string;
  inspection: { state: string; organisationName?: string; roleLabel?: string };
  identity: {
    authenticated: boolean;
    emailVerified: boolean;
    assuranceLevel: string;
  };
}) {
  const [state, action, pending] = useActionState(
    acceptManagerInvitationAction,
    { outcome: "", message: "" } satisfies InvitationAcceptanceActionState,
  );
  const outcome = state.outcome || inspection.state;
  if (copy[outcome]) {
    const item = copy[outcome];
    return (
      <InvitationState
        title={item.title}
        body={state.message || item.body}
        success={outcome === "accepted" || outcome === "already_accepted"}
      />
    );
  }
  const next = `/invitations/manager?token=${encodeURIComponent(token)}`;
  if (!identity.authenticated)
    return (
      <div className="invitation-actions">
        <InvitationState
          title="Sign in to continue"
          body={`Authenticate with the email address invited to ${inspection.organisationName ?? "the organisation"}.`}
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
        <InvitationState
          title="Verify your email"
          body="Open the verification email, then return to this invitation."
        />
        <form action={resendManagerInvitationVerificationAction}>
          <input type="hidden" name="token" value={token} />
          <Button variant="secondary" style={{ minHeight: 44 }}>
            Resend verification email
          </Button>
        </form>
      </div>
    );
  if (identity.assuranceLevel !== "aal2")
    return (
      <div className="invitation-actions">
        <InvitationState
          title="Complete multi-factor authentication"
          body="Privileged manager access is not activated until this security check succeeds."
        />
        <Link
          className="onboarding-button-link"
          href={`/mfa?next=${encodeURIComponent(next)}`}
        >
          Continue to MFA
        </Link>
      </div>
    );
  return (
    <form action={action} className="invitation-actions">
      <input type="hidden" name="token" value={token} />
      <InvitationState
        title="Review your invitation"
        body={`${inspection.organisationName ?? "The organisation"} invited you as ${inspection.roleLabel ?? "a manager"}. Role and site access will be loaded securely from the invitation.`}
      />
      <Button disabled={pending} style={{ minHeight: 44 }}>
        {pending ? "Accepting safely..." : "Accept invitation"}
      </Button>
    </form>
  );
}
function InvitationState({
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
      : title.includes("MFA")
        ? LockKeyhole
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
