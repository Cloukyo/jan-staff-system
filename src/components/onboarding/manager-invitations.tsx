"use client";
import { useActionState, useState } from "react";
import {
  MailCheck,
  RefreshCw,
  ShieldCheck,
  UserRoundPlus,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import Link from "next/link";
import type { OnboardingFormState } from "@/lib/onboarding/actions";
import {
  createManagerInvitationAction,
  finishManagerInvitationsAction,
  mutateManagerInvitationAction,
} from "@/lib/onboarding/manager-invitation-actions";
import {
  MANAGER_ROLE_PRESENTATION,
  type ManagerInvitationSnapshot,
} from "@/lib/onboarding/manager-invitation-contracts";
import { OnboardingNotice } from "./onboarding-shell";
const initial: OnboardingFormState = {
  ok: false,
  code: "",
  message: "",
  fieldErrors: {},
  values: {},
};
function Hidden({ revision, id }: { revision: string; id: string }) {
  return (
    <>
      <input type="hidden" name="expectedSessionRevision" value={revision} />
      <input type="hidden" name="idempotencyKey" value={id} />
    </>
  );
}
export function ManagerInvitations({
  snapshot,
  revision,
  keys,
}: {
  snapshot: ManagerInvitationSnapshot;
  revision: string;
  keys: string[];
}) {
  const [role, setRole] =
    useState<keyof typeof MANAGER_ROLE_PRESENTATION>("site_manager");
  const [formState, action, pending] = useActionState(
    createManagerInvitationAction,
    initial,
  );
  const definition = MANAGER_ROLE_PRESENTATION[role];
  return (
    <div className="manager-invitations">
      <section className="manager-invitation-intro">
        <ShieldCheck aria-hidden />
        <div>
          <h2>Choose access deliberately</h2>
          <p>
            Role and site access are checked again by the server. Organisation
            owner access cannot be invited here.
          </p>
        </div>
      </section>
      <form action={action} className="onboarding-form manager-invitation-form">
        <Hidden revision={revision} id={keys[0]} />
        {formState.message ? (
          <OnboardingNotice tone={formState.ok ? "success" : "error"}>
            {formState.message}
            {formState.continuationUrl ? (
              <>
                <br />
                <Link href={formState.continuationUrl}>
                  Open the one-time Preview invitation
                </Link>
              </>
            ) : null}
          </OnboardingNotice>
        ) : null}
        <div className="onboarding-form-section">
          <div>
            <h2>Add manager</h2>
            <p>The invitation is saved before delivery is attempted.</p>
          </div>
          <div className="onboarding-form-grid">
            <label className="onboarding-field">
              <span>Email</span>
              <input
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={formState.values.email}
                aria-invalid={Boolean(formState.fieldErrors.email)}
                aria-describedby="manager-email-help"
                required
              />
              <small id="manager-email-help">
                {formState.fieldErrors.email ??
                  "Use the address this person will sign in with."}
              </small>
            </label>
            <label className="onboarding-field">
              <span>Role</span>
              <select
                name="role"
                value={role}
                onChange={(event) => setRole(event.target.value as typeof role)}
              >
                {Object.entries(MANAGER_ROLE_PRESENTATION).map(
                  ([value, item]) => (
                    <option key={value} value={value}>
                      {item.label}
                    </option>
                  ),
                )}
              </select>
              <small>{definition.description}</small>
            </label>
            <input type="hidden" name="scopeType" value={definition.scope} />
            {definition.scope === "site" ? (
              <fieldset
                className="manager-site-scope"
                aria-describedby="site-scope-help"
              >
                <legend>Site access</legend>
                <p id="site-scope-help">
                  Select every site this role may manage. Site access alone does
                  not grant permissions.
                </p>
                {snapshot.availableSites.map((site) => (
                  <label key={site.id}>
                    <input type="checkbox" name="siteIds" value={site.id} />
                    <span>{site.name}</span>
                  </label>
                ))}
              </fieldset>
            ) : (
              <div className="manager-organisation-scope">
                <strong>Organisation-wide access</strong>
                <p>
                  This role applies across the organisation and does not carry
                  separate site selections.
                </p>
              </div>
            )}
          </div>
        </div>
        <div className="onboarding-form-actions">
          <Button disabled={pending} style={{ minHeight: 44 }}>
            <UserRoundPlus aria-hidden />
            {pending ? "Saving invitation..." : "Send invitation"}
          </Button>
        </div>
      </form>
      <section
        className="manager-invitation-list"
        aria-labelledby="manager-invitation-list-title"
      >
        <div>
          <h2 id="manager-invitation-list-title">Manager invitations</h2>
          <p>
            Invitation, email delivery and acceptance are tracked separately.
          </p>
        </div>
        {snapshot.invitations.length === 0 ? (
          <div className="manager-invitation-empty">
            <MailCheck aria-hidden />
            <p>No manager invitations have been created yet.</p>
          </div>
        ) : (
          <ul>
            {snapshot.invitations.map((invitation, index) => (
              <li key={invitation.id}>
                <div>
                  <strong>{invitation.email}</strong>
                  <span>
                    {MANAGER_ROLE_PRESENTATION[invitation.role].label}
                  </span>
                </div>
                <dl>
                  <div>
                    <dt>Invitation</dt>
                    <dd>{invitation.status.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Email delivery</dt>
                    <dd>{invitation.deliveryStatus.replaceAll("_", " ")}</dd>
                  </div>
                  <div>
                    <dt>Acceptance</dt>
                    <dd>
                      {invitation.acceptedAt ? "Accepted" : "Awaiting response"}
                    </dd>
                  </div>
                </dl>
                {["pending", "expired", "revoked"].includes(
                  invitation.status,
                ) ? (
                  <div className="manager-invitation-controls">
                    {invitation.status === "pending" ? (
                      <details>
                        <summary>
                          <RefreshCw aria-hidden />
                          Resend invitation
                        </summary>
                        <p>
                          The current link will stop working and a replacement
                          will be queued.
                        </p>
                        <form action={mutateManagerInvitationAction}>
                          <Hidden
                            revision={revision}
                            id={keys[index * 2 + 1] ?? invitation.id}
                          />
                          <input
                            type="hidden"
                            name="invitationId"
                            value={invitation.id}
                          />
                          <Button
                            variant="secondary"
                            name="intent"
                            value="resend"
                            style={{ minHeight: 44 }}
                          >
                            Confirm resend
                          </Button>
                        </form>
                      </details>
                    ) : null}
                    <details>
                      <summary>
                        <XCircle aria-hidden />
                        Revoke invitation
                      </summary>
                      <p>
                        This link will stop working immediately. Invitation
                        history will remain.
                      </p>
                      <form action={mutateManagerInvitationAction}>
                        <Hidden
                          revision={revision}
                          id={keys[index * 2 + 2] ?? invitation.id}
                        />
                        <input
                          type="hidden"
                          name="invitationId"
                          value={invitation.id}
                        />
                        <Button
                          variant="secondary"
                          name="intent"
                          value="revoke"
                          style={{ minHeight: 44 }}
                        >
                          Confirm revoke
                        </Button>
                      </form>
                    </details>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="manager-completion">
        <form action={finishManagerInvitationsAction}>
          <Hidden revision={revision} id={keys.at(-2)!} />
          <Button
            name="intent"
            value="sole_manager"
            variant="secondary"
            style={{ minHeight: 44 }}
          >
            I&apos;ll manage this site myself for now
          </Button>
        </form>
        <form action={finishManagerInvitationsAction}>
          <Hidden revision={revision} id={keys.at(-1)!} />
          <Button
            name="intent"
            value="complete"
            disabled={
              !snapshot.invitations.some(
                (item) =>
                  item.status === "pending" || item.status === "accepted",
              )
            }
            style={{ minHeight: 44 }}
          >
            Continue
          </Button>
        </form>
      </div>
    </div>
  );
}
