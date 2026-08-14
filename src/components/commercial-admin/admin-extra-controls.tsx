"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { AdminCommandForm } from "./admin-command-form";
import { Field, inputClassName } from "@/components/ui/primitives";
import type { CommercialAdminSnapshot } from "@/lib/commercial-admin/contracts";

export function AdminListSearch({
  targetId,
  label = "Search",
}: {
  targetId: string;
  label?: string;
}) {
  const [query, setQuery] = useState("");

  function filter(value: string) {
    setQuery(value);
    const normalised = value.trim().toLocaleLowerCase("en-GB");
    document
      .querySelectorAll<HTMLElement>(`#${targetId} [data-admin-search]`)
      .forEach((item) => {
        item.hidden =
          Boolean(normalised) &&
          !item.dataset.adminSearch
            ?.toLocaleLowerCase("en-GB")
            .includes(normalised);
      });
  }

  return (
    <label className="relative mb-4 block w-full max-w-lg">
      <span className="sr-only">{label}</span>
      <Search
        aria-hidden
        className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
      />
      <input
        className={inputClassName("w-full")}
        style={{ paddingLeft: "3rem" }}
        type="search"
        value={query}
        placeholder={label}
        onChange={(event) => filter(event.target.value)}
      />
    </label>
  );
}

export function StaffEligibilityControl({
  staff,
  revision,
}: {
  staff: CommercialAdminSnapshot["staff"][number];
  revision: number;
}) {
  return (
    <AdminCommandForm
      className="mt-5 border-t border-purple-100 pt-5"
      commandName="set_staff_attendance_eligibility"
      revision={revision}
      submitLabel={
        staff.kiosk.enabled
          ? "Remove clocking eligibility"
          : "Enable clocking eligibility"
      }
      tone="secondary"
      confirmMessage={
        staff.kiosk.enabled
          ? "Remove this staff member from future clocking-in eligibility? Historical attendance stays intact."
          : undefined
      }
    >
      <input type="hidden" name="staffId" value={staff.id} />
      <input
        type="hidden"
        name="eligible"
        value={staff.kiosk.enabled ? "false" : "true"}
      />
      <p className="text-sm leading-6 text-slate-600">
        {staff.kiosk.enabled
          ? "Eligible for new online attendance actions."
          : "Not currently eligible for online attendance actions."}
      </p>
    </AdminCommandForm>
  );
}

export function MembershipAccessControls({
  member,
  sites,
  revision,
}: {
  member: CommercialAdminSnapshot["memberships"][number];
  sites: CommercialAdminSnapshot["sites"];
  revision: number;
}) {
  return (
    <div className="mt-4 grid gap-4 border-t border-purple-100 pt-4">
      <AdminCommandForm
        commandName="update_membership_access"
        revision={revision}
        submitLabel="Update role and access"
        tone="secondary"
      >
        <input type="hidden" name="membershipId" value={member.id} />
        <input
          type="hidden"
          name="membershipRevision"
          value={member.revision}
        />
        <Field label="Role">
          <select
            className={inputClassName()}
            name="role"
            required
            defaultValue={member.roles[0]?.role ?? "site_manager"}
          >
            <option value="organisation_admin">
              Organisation administrator
            </option>
            <option value="hr_admin">HR administrator</option>
            <option value="payroll_admin">Payroll administrator</option>
            <option value="site_manager">Site manager</option>
            <option value="scheduler">Scheduler</option>
          </select>
        </Field>
        <Field label="Access scope">
          <select
            className={inputClassName()}
            name="scopeType"
            required
            defaultValue={member.roles[0]?.scopeType ?? "site"}
          >
            <option value="organisation">All permitted sites</option>
            <option value="site">One site</option>
          </select>
        </Field>
        <Field label="Site, when using one-site access">
          <select
            className={inputClassName()}
            name="siteId"
            defaultValue={member.roles[0]?.siteId ?? ""}
          >
            <option value="">Select a site</option>
            {sites
              .filter((site) => site.active)
              .map((site) => (
                <option key={site.id} value={site.id}>
                  {site.name}
                </option>
              ))}
          </select>
        </Field>
      </AdminCommandForm>
      <div className="grid gap-3 sm:grid-cols-2">
        <AdminCommandForm
          commandName="suspend_membership"
          revision={revision}
          submitLabel="Suspend access"
          tone="danger"
          confirmMessage="Suspend this member's access? They will be signed out of protected workflows."
        >
          <input type="hidden" name="membershipId" value={member.id} />
          <input
            type="hidden"
            name="membershipRevision"
            value={member.revision}
          />
        </AdminCommandForm>
        <AdminCommandForm
          commandName="revoke_membership"
          revision={revision}
          submitLabel="Revoke membership"
          tone="danger"
          confirmMessage="Revoke this membership? This preserves its audit history and cannot be treated as a temporary suspension."
        >
          <input type="hidden" name="membershipId" value={member.id} />
          <input
            type="hidden"
            name="membershipRevision"
            value={member.revision}
          />
        </AdminCommandForm>
      </div>
    </div>
  );
}

export function InvitationControls({
  invitation,
  revision,
}: {
  invitation: CommercialAdminSnapshot["invitations"][number];
  revision: number;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      <AdminCommandForm
        commandName="resend_invitation"
        revision={revision}
        submitLabel="Resend"
        tone="secondary"
      >
        <input type="hidden" name="invitationId" value={invitation.id} />
        <input type="hidden" name="invitationKind" value={invitation.kind} />
      </AdminCommandForm>
      <AdminCommandForm
        commandName="revoke_invitation"
        revision={revision}
        submitLabel="Revoke"
        tone="danger"
        confirmMessage="Revoke this invitation?"
      >
        <input type="hidden" name="invitationId" value={invitation.id} />
      </AdminCommandForm>
    </div>
  );
}

export function ReplaceDeviceControl({
  device,
  siteName,
  revision,
}: {
  device: CommercialAdminSnapshot["devices"][number];
  siteName: string;
  revision: number;
}) {
  return (
    <details className="mt-4 border-t border-purple-100 pt-4">
      <summary className="cursor-pointer text-sm font-bold text-purple-700">
        Replace this device
      </summary>
      <AdminCommandForm
        className="mt-4"
        commandName="replace_kiosk_device"
        revision={revision}
        submitLabel="Revoke and create replacement code"
        tone="danger"
        confirmMessage={`Replace ${device.deviceName}? The existing device will be revoked immediately.`}
      >
        <input type="hidden" name="deviceId" value={device.id} />
        <input type="hidden" name="siteId" value={device.siteId} />
        <Field label={`Replacement device name for ${siteName}`}>
          <input
            className={inputClassName()}
            name="deviceName"
            defaultValue={`${device.deviceName} replacement`}
            required
          />
        </Field>
      </AdminCommandForm>
    </details>
  );
}
