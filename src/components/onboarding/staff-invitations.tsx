"use client";
import Link from "next/link";
import { useActionState, useMemo, useState } from "react";
import { MailCheck, RefreshCw, UserRoundCheck, XCircle } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { OnboardingFormState } from "@/lib/onboarding/actions";
import {
  createStaffInvitationsAction,
  finishStaffInvitationsAction,
  mutateStaffInvitationAction,
} from "@/lib/onboarding/staff-invitation-actions";
import type { StaffInvitationSnapshot } from "@/lib/onboarding/staff-invitation-contracts";
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
const labels: Record<string, string> = {
  no_account: "No account",
  invitation_pending: "Invitation pending",
  delivery_failed: "Email delivery failed",
  invitation_expired: "Invitation expired",
  account_linked: "Account linked",
  pin_only: "PIN-only",
  needs_review: "Needs review",
};
export function StaffInvitations({
  snapshot,
  revision,
  keys,
}: {
  snapshot: StaffInvitationSnapshot;
  revision: string;
  keys: string[];
}) {
  const [state, action, pending] = useActionState(
    createStaffInvitationsAction,
    initial,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewing, setReviewing] = useState(false);
  const eligibleIds = useMemo(
    () =>
      new Set(
        snapshot.staff
          .filter(
            (staff) =>
              ["no_account", "delivery_failed", "invitation_expired"].includes(
                staff.accountState,
              ) && staff.maskedEmail,
          )
          .map((staff) => staff.staffId),
      ),
    [snapshot.staff],
  );
  return (
    <div className="staff-invitations">
      <section className="manager-invitation-intro">
        <UserRoundCheck aria-hidden />
        <div>
          <h2>Accounts are optional for attendance</h2>
          <p>
            Invite people who need self-service access. PIN-only staff can still
            use the kiosk when that attendance method is configured later.
          </p>
        </div>
      </section>
      <form action={action} className="onboarding-form staff-invitation-form">
        {<Hidden revision={revision} id={keys[0]} />}{" "}
        {reviewing
          ? selectedIds.map((staffId) => (
              <input
                key={staffId}
                type="hidden"
                name="staffIds"
                value={staffId}
              />
            ))
          : null}
        {state.message ? (
          <OnboardingNotice tone={state.ok ? "success" : "error"}>
            {state.message}
            {state.continuationUrl ? (
              <>
                <br />
                <Link href={state.continuationUrl}>
                  Open the first one-time Preview invitation
                </Link>
              </>
            ) : null}
          </OnboardingNotice>
        ) : null}
        <fieldset
          className="staff-invitation-selection"
          aria-describedby="staff-selection-help staff-selection-error"
        >
          <legend>
            {reviewing ? "Review staff invitations" : "Select staff to invite"}
          </legend>
          <p id="staff-selection-help">
            {reviewing
              ? "Check this list carefully. Sending creates one invitation and one delivery request for every person shown."
              : "Login access is linked to the existing staff profile and its authoritative site assignments."}
          </p>
          {state.fieldErrors.staffIds ? (
            <p id="staff-selection-error" className="onboarding-field-error">
              {state.fieldErrors.staffIds}
            </p>
          ) : null}
          {snapshot.staff.length === 0 ? (
            <div className="manager-invitation-empty">
              <MailCheck aria-hidden />
              <p>
                No staff profiles are available yet. You can invite staff later.
              </p>
            </div>
          ) : (
            <ul className={reviewing ? "staff-invitation-review" : undefined}>
              {snapshot.staff
                .filter(
                  (staff) => !reviewing || selectedIds.includes(staff.staffId),
                )
                .map((staff) => (
                  <li key={staff.staffId}>
                    <label>
                      <input
                        type="checkbox"
                        name="staffIds"
                        value={staff.staffId}
                        checked={selectedIds.includes(staff.staffId)}
                        onChange={(event) =>
                          setSelectedIds((current) =>
                            event.target.checked
                              ? [...current, staff.staffId]
                              : current.filter((id) => id !== staff.staffId),
                          )
                        }
                        aria-label={`Invite ${staff.displayName}`}
                        aria-invalid={Boolean(state.fieldErrors.staffIds)}
                        aria-describedby={
                          state.fieldErrors.staffIds
                            ? "staff-selection-error"
                            : undefined
                        }
                        disabled={reviewing || !eligibleIds.has(staff.staffId)}
                      />
                      <span>
                        <strong>{staff.displayName}</strong>
                        <small>{staff.maskedEmail ?? "No login email"}</small>
                      </span>
                    </label>
                    <span
                      className={`staff-account-status staff-account-status--${staff.accountState}`}
                    >
                      {labels[staff.accountState]}
                    </span>
                    <small>
                      {staff.siteIds.length} authorised{" "}
                      {staff.siteIds.length === 1 ? "site" : "sites"}
                    </small>
                    {staff.attendanceMode === "pin_only" ? (
                      <small>
                        PIN-only attendance remains available without an
                        account.
                      </small>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </fieldset>
        <div className="onboarding-form-actions">
          {reviewing ? (
            <Button
              type="button"
              variant="secondary"
              disabled={pending}
              onClick={() => setReviewing(false)}
              style={{ minHeight: 44 }}
            >
              Back to selection
            </Button>
          ) : null}
          {reviewing ? (
            <Button
              disabled={pending || selectedIds.length === 0}
              style={{ minHeight: 44 }}
            >
              {pending
                ? "Sending invitations..."
                : `Send ${selectedIds.length} invitation${selectedIds.length === 1 ? "" : "s"}`}
            </Button>
          ) : (
            <Button
              type="button"
              disabled={
                pending || selectedIds.length === 0 || eligibleIds.size === 0
              }
              onClick={() => setReviewing(true)}
              style={{ minHeight: 44 }}
            >
              Review selected staff
            </Button>
          )}
        </div>
      </form>
      <section
        className="manager-invitation-list"
        aria-labelledby="staff-invitations-status"
      >
        <div>
          <h2 id="staff-invitations-status">Invitation status</h2>
          <p>
            Profile, email delivery and account linking are tracked separately.
          </p>
        </div>
        <ul>
          {snapshot.staff
            .filter((s) => s.invitationId)
            .map((staff, index) => (
              <li key={staff.invitationId!}>
                <div>
                  <strong>{staff.displayName}</strong>
                  <span>{labels[staff.accountState]}</span>
                </div>
                {staff.invitationStatus === "pending" ? (
                  <div className="manager-invitation-controls">
                    <details>
                      <summary>
                        <RefreshCw aria-hidden />
                        Resend invitation
                      </summary>
                      <p>The current link will be replaced.</p>
                      <form action={mutateStaffInvitationAction}>
                        <Hidden
                          revision={revision}
                          id={keys[index * 2 + 1] ?? staff.invitationId!}
                        />
                        <input
                          type="hidden"
                          name="invitationId"
                          value={staff.invitationId!}
                        />
                        <Button
                          name="intent"
                          value="resend"
                          variant="secondary"
                          style={{ minHeight: 44 }}
                        >
                          Confirm resend
                        </Button>
                      </form>
                    </details>
                    <details>
                      <summary>
                        <XCircle aria-hidden />
                        Revoke invitation
                      </summary>
                      <p>
                        The invitation link will stop working. The staff profile
                        remains unchanged.
                      </p>
                      <form action={mutateStaffInvitationAction}>
                        <Hidden
                          revision={revision}
                          id={keys[index * 2 + 2] ?? staff.invitationId!}
                        />
                        <input
                          type="hidden"
                          name="invitationId"
                          value={staff.invitationId!}
                        />
                        <Button
                          name="intent"
                          value="revoke"
                          variant="secondary"
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
      </section>
      <div className="manager-completion">
        <form action={finishStaffInvitationsAction}>
          <Hidden revision={revision} id={keys.at(-2)!} />
          <Button
            name="intent"
            value="skip"
            variant="secondary"
            style={{ minHeight: 44 }}
          >
            Invite staff later
          </Button>
        </form>
        <form action={finishStaffInvitationsAction}>
          <Hidden revision={revision} id={keys.at(-1)!} />
          <Button
            name="intent"
            value="complete"
            disabled={
              !snapshot.staff.some(
                (s) => s.invitationId || s.accountState === "account_linked",
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
