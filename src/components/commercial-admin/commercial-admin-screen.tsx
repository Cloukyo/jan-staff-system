import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  MapPin,
  MonitorSmartphone,
  ShieldCheck,
  Users,
} from "lucide-react";
import { AdminCommandForm } from "./admin-command-form";
import {
  AdminListSearch,
  InvitationControls,
  MembershipAccessControls,
  ReplaceDeviceControl,
  StaffEligibilityControl,
} from "./admin-extra-controls";
import {
  EmptyState,
  Field,
  Panel,
  StatusPill,
  inputClassName,
} from "@/components/ui/primitives";
import type { CommercialAdminSnapshot } from "@/lib/commercial-admin/contracts";

export type CommercialAdminArea =
  | "overview"
  | "organisation"
  | "sites"
  | "staff"
  | "access"
  | "devices"
  | "settings"
  | "site-settings";
const prettyRole = (role: string) =>
  role.replaceAll("_", " ").replace(/^./, (value) => value.toUpperCase());

function PageHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body: string;
}) {
  return (
    <header className="mb-7 max-w-3xl">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-purple-700">
        {eyebrow}
      </p>
      <h1 className="mt-2 text-3xl font-black tracking-tight text-purple-950 sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-base leading-7 text-slate-600">{body}</p>
    </header>
  );
}

function Overview({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  const liveDevices = snapshot.devices.filter((device) => device.active).length;
  return (
    <>
      <PageHeader
        eyebrow="Commercial administration"
        title={`Welcome back to ${snapshot.organisation.displayName}`}
        body="Manage the people, places and access that keep your organisation running. Changes are checked against your role and current plan before they are saved."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Active sites",
            value: snapshot.sites.filter((site) => site.active).length,
            icon: MapPin,
            href: "/admin/sites",
          },
          {
            label: "Active staff",
            value: snapshot.staff.filter((staff) => staff.active).length,
            icon: Users,
            href: "/admin/staff",
          },
          {
            label: "Members",
            value: snapshot.memberships.filter(
              (member) => member.status === "active",
            ).length,
            icon: ShieldCheck,
            href: "/admin/access",
          },
          {
            label: "Online devices",
            value: liveDevices,
            icon: MonitorSmartphone,
            href: "/admin/devices",
          },
        ].map(({ label, value, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="group rounded-xl border border-purple-100 bg-white p-5 shadow-soft transition hover:-translate-y-0.5 hover:border-purple-200"
          >
            <Icon className="h-5 w-5 text-purple-700" />
            <p className="mt-5 text-3xl font-black text-purple-950">{value}</p>
            <p className="mt-1 text-sm font-semibold text-slate-600">{label}</p>
            <span className="mt-4 inline-block text-sm font-bold text-purple-700 group-hover:underline">
              Manage
            </span>
          </Link>
        ))}
      </div>
      <Panel className="mt-6 flex items-start gap-4">
        <CheckCircle2 className="mt-0.5 h-6 w-6 shrink-0 text-emerald-600" />
        <div>
          <h2 className="font-black text-purple-950">Organisation is live</h2>
          <p className="mt-1 text-sm leading-6 text-slate-600">
            Attendance evidence and historical records remain protected while
            you make administrative changes.
          </p>
        </div>
      </Panel>
    </>
  );
}

function Organisation({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  const org = snapshot.organisation;
  return (
    <>
      <PageHeader
        eyebrow="Organisation"
        title="Organisation profile"
        body="Keep the customer account details used across all sites up to date."
      />
      <Panel>
        <AdminCommandForm
          commandName="update_organisation"
          revision={org.revision}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Organisation name">
              <input
                className={inputClassName()}
                name="displayName"
                defaultValue={org.displayName}
                required
              />
            </Field>
            <Field label="Legal name">
              <input
                className={inputClassName()}
                name="legalName"
                defaultValue={org.legalName}
                required
              />
            </Field>
            <Field label="Contact email">
              <input
                className={inputClassName()}
                type="email"
                name="contactEmail"
                defaultValue={org.contactEmail ?? ""}
                required
              />
            </Field>
            <Field label="Phone">
              <input
                className={inputClassName()}
                type="tel"
                name="contactPhone"
                defaultValue={org.contactPhone ?? ""}
              />
            </Field>
          </div>
          <fieldset className="grid gap-4 border-t border-purple-100 pt-5 sm:grid-cols-2">
            <legend className="mb-4 text-sm font-black text-purple-950">
              Postal address
            </legend>
            <Field label="Address line 1">
              <input
                className={inputClassName()}
                name="addressLine1"
                defaultValue={org.addressLine1 ?? ""}
              />
            </Field>
            <Field label="Address line 2">
              <input
                className={inputClassName()}
                name="addressLine2"
                defaultValue={org.addressLine2 ?? ""}
              />
            </Field>
            <Field label="Town or city">
              <input
                className={inputClassName()}
                name="locality"
                defaultValue={org.locality ?? ""}
              />
            </Field>
            <Field label="Region">
              <input
                className={inputClassName()}
                name="region"
                defaultValue={org.region ?? ""}
              />
            </Field>
            <Field label="Postcode">
              <input
                className={inputClassName()}
                name="postcode"
                defaultValue={org.postcode ?? ""}
              />
            </Field>
          </fieldset>
        </AdminCommandForm>
      </Panel>
    </>
  );
}

function Sites({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  return (
    <>
      <PageHeader
        eyebrow="Sites"
        title="Sites and locations"
        body="Add sites within your plan, update local details and preserve history when a site closes."
      />
      <div className="grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
        <div className="grid gap-4">
          {snapshot.sites.map((site) => (
            <Panel key={site.id}>
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="font-black text-purple-950">{site.name}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {[site.locality, site.postcode]
                      .filter(Boolean)
                      .join(", ") || "Address not added"}
                  </p>
                </div>
                <StatusPill tone={site.active ? "green" : "grey"}>
                  {site.active ? "Active" : "Archived"}
                </StatusPill>
              </div>
              {site.active ? (
                <details className="mt-5">
                  <summary className="cursor-pointer text-sm font-bold text-purple-700">
                    Edit site
                  </summary>
                  <AdminCommandForm
                    className="mt-4"
                    commandName="update_site"
                    revision={snapshot.organisation.revision}
                  >
                    <input type="hidden" name="siteId" value={site.id} />
                    <Field label="Site name">
                      <input
                        className={inputClassName()}
                        name="name"
                        defaultValue={site.name}
                        required
                      />
                    </Field>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Town or city">
                        <input
                          className={inputClassName()}
                          name="locality"
                          defaultValue={site.locality ?? ""}
                        />
                      </Field>
                      <Field label="Postcode">
                        <input
                          className={inputClassName()}
                          name="postcode"
                          defaultValue={site.postcode ?? ""}
                        />
                      </Field>
                      <Field label="Phone">
                        <input
                          className={inputClassName()}
                          name="phone"
                          defaultValue={site.phone ?? ""}
                        />
                      </Field>
                      <Field label="Email">
                        <input
                          className={inputClassName()}
                          type="email"
                          name="email"
                          defaultValue={site.email ?? ""}
                        />
                      </Field>
                    </div>
                  </AdminCommandForm>
                  <AdminCommandForm
                    className="mt-5 border-t border-red-100 pt-5"
                    commandName="archive_site"
                    revision={snapshot.organisation.revision}
                    submitLabel="Archive site"
                    tone="danger"
                    confirmMessage={`Archive ${site.name}? This is blocked while active staff or devices remain.`}
                  >
                    <input type="hidden" name="siteId" value={site.id} />
                  </AdminCommandForm>
                </details>
              ) : null}
            </Panel>
          ))}
        </div>
        <Panel>
          <h2 className="text-lg font-black text-purple-950">Add a site</h2>
          <p className="mt-1 text-sm text-slate-600">
            Your plan allowance is checked before anything is created.
          </p>
          <AdminCommandForm
            className="mt-5"
            commandName="create_site"
            revision={snapshot.organisation.revision}
            submitLabel="Create site"
          >
            <Field label="Site name">
              <input className={inputClassName()} name="name" required />
            </Field>
            <Field label="Address line 1">
              <input className={inputClassName()} name="addressLine1" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Town or city">
                <input className={inputClassName()} name="locality" />
              </Field>
              <Field label="Postcode">
                <input className={inputClassName()} name="postcode" />
              </Field>
            </div>
            <input type="hidden" name="timezone" value="Europe/London" />
            <input type="hidden" name="countryCode" value="GB" />
          </AdminCommandForm>
        </Panel>
      </div>
    </>
  );
}

function Staff({
  snapshot,
  today,
}: {
  snapshot: CommercialAdminSnapshot;
  today: string;
}) {
  return (
    <>
      <PageHeader
        eyebrow="Staff"
        title="Staff records and site assignments"
        body="Manage active staff and effective-dated site assignments without rewriting attendance or employment history."
      />
      <AdminListSearch
        targetId="commercial-staff-list"
        label="Search staff by name, role or site"
      />
      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <div id="commercial-staff-list" className="grid content-start gap-4">
          {snapshot.staff.length ? (
            snapshot.staff.map((staff) => (
              <div
                key={staff.id}
                data-admin-search={`${staff.fullName} ${staff.displayName} ${staff.employmentRole} ${staff.assignments.map((assignment) => assignment.siteName).join(" ")}`}
              >
              <Panel>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-black text-purple-950">
                      {staff.fullName}
                    </h2>
                    <p className="text-sm text-slate-600">
                      {staff.employmentRole}
                    </p>
                    <p className="mt-2 text-xs font-semibold text-slate-500">
                      {staff.assignments.map((a) => a.siteName).join(", ") ||
                        "No site assignment"}
                    </p>
                  </div>
                  <StatusPill tone={staff.active ? "green" : "grey"}>
                    {staff.active ? "Active" : "Inactive"}
                  </StatusPill>
                </div>
                {staff.active ? (
                  <details className="mt-5">
                    <summary className="cursor-pointer text-sm font-bold text-purple-700">
                      Manage record
                    </summary>
                    <AdminCommandForm
                      className="mt-4"
                      commandName="update_staff"
                      revision={snapshot.organisation.revision}
                    >
                      <input type="hidden" name="staffId" value={staff.id} />
                      <Field label="Full name">
                        <input
                          className={inputClassName()}
                          name="fullName"
                          defaultValue={staff.fullName}
                        />
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Known as">
                          <input
                            className={inputClassName()}
                            name="displayName"
                            defaultValue={staff.displayName}
                          />
                        </Field>
                        <Field label="Role or job title">
                          <input
                            className={inputClassName()}
                            name="employmentRole"
                            defaultValue={staff.employmentRole}
                          />
                        </Field>
                        <Field label="Work email">
                          <input
                            className={inputClassName()}
                            type="email"
                            name="email"
                            defaultValue={staff.email ?? ""}
                          />
                        </Field>
                      </div>
                    </AdminCommandForm>
                    <AdminCommandForm
                      className="mt-5 border-t border-purple-100 pt-5"
                      commandName="upsert_assignment"
                      revision={snapshot.organisation.revision}
                      submitLabel="Schedule assignment"
                    >
                      <input type="hidden" name="staffId" value={staff.id} />
                      <Field label="Site">
                        <select
                          className={inputClassName()}
                          name="siteId"
                          required
                        >
                          <option value="">Select a site</option>
                          {snapshot.sites
                            .filter((s) => s.active)
                            .map((site) => (
                              <option key={site.id} value={site.id}>
                                {site.name}
                              </option>
                            ))}
                        </select>
                      </Field>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field label="Effective from">
                          <input
                            className={inputClassName()}
                            type="date"
                            name="effectiveFrom"
                            defaultValue={today}
                            required
                          />
                        </Field>
                        <Field label="Effective to (optional)">
                          <input
                            className={inputClassName()}
                            type="date"
                            name="effectiveTo"
                          />
                        </Field>
                      </div>
                      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-purple-950">
                        <input
                          className="h-5 w-5"
                          type="checkbox"
                          name="primary"
                          value="true"
                        />
                        Make this the primary site for the effective period
                      </label>
                    </AdminCommandForm>
                    {staff.email ? (
                      <AdminCommandForm
                        className="mt-5 border-t border-purple-100 pt-5"
                        commandName="create_staff_invitation"
                        revision={snapshot.organisation.revision}
                        submitLabel="Create staff login invitation"
                        tone="secondary"
                      >
                        <input type="hidden" name="staffId" value={staff.id} />
                        <input type="hidden" name="email" value={staff.email} />
                      </AdminCommandForm>
                    ) : null}
                    <StaffEligibilityControl
                      staff={staff}
                      revision={snapshot.organisation.revision}
                    />
                    <AdminCommandForm
                      className="mt-5 border-t border-red-100 pt-5"
                      commandName="deactivate_staff"
                      revision={snapshot.organisation.revision}
                      submitLabel="Deactivate staff member"
                      tone="danger"
                      confirmMessage={`Deactivate ${staff.fullName}? Their historical records will be preserved.`}
                    >
                      <input type="hidden" name="staffId" value={staff.id} />
                    </AdminCommandForm>
                  </details>
                ) : null}
              </Panel>
              </div>
            ))
          ) : (
            <EmptyState
              title="No staff records"
              body="Add the first staff member using the form on this page."
            />
          )}
        </div>
        <Panel>
          <h2 className="text-lg font-black text-purple-950">
            Add a staff member
          </h2>
          <AdminCommandForm
            className="mt-5"
            commandName="create_staff"
            revision={snapshot.organisation.revision}
            submitLabel="Add staff member"
          >
            <Field label="Full name">
              <input className={inputClassName()} name="fullName" required />
            </Field>
            <Field label="Known as">
              <input className={inputClassName()} name="displayName" />
            </Field>
            <Field label="Role or job title">
              <input
                className={inputClassName()}
                name="employmentRole"
                required
              />
            </Field>
            <Field label="Primary site">
              <select className={inputClassName()} name="siteId" required>
                <option value="">Select a site</option>
                {snapshot.sites
                  .filter((s) => s.active)
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Effective from">
              <input
                className={inputClassName()}
                type="date"
                name="effectiveFrom"
                defaultValue={today}
                required
              />
            </Field>
            <input type="hidden" name="primary" value="true" />
          </AdminCommandForm>
        </Panel>
      </div>
    </>
  );
}

function Access({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  return (
    <>
      <PageHeader
        eyebrow="Access"
        title="Members and invitations"
        body="Grant the least access people need. Sensitive changes require MFA and the final owner is protected."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <h2 className="text-lg font-black text-purple-950">Active members</h2>
          <div className="mt-4 grid gap-3">
            {snapshot.memberships.map((member) => (
              <div
                key={member.id}
                className="rounded-lg border border-purple-100 p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-purple-950">
                      {member.email ?? member.staffId ?? "Account member"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">
                      {member.roles
                        .map((role) => prettyRole(role.role))
                        .join(", ") || "No active role"}
                    </p>
                  </div>
                  <StatusPill
                    tone={member.status === "active" ? "green" : "grey"}
                  >
                    {prettyRole(member.status)}
                  </StatusPill>
                </div>
                {member.id !== snapshot.actor.membershipId &&
                member.status === "active" ? (
                  <MembershipAccessControls
                    member={member}
                    sites={snapshot.sites}
                    revision={snapshot.organisation.revision}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </Panel>
        <div className="grid gap-5">
          <Panel>
            <h2 className="text-lg font-black text-purple-950">
              Invite a manager
            </h2>
            <AdminCommandForm
              className="mt-4"
              commandName="create_manager_invitation"
              revision={snapshot.organisation.revision}
              submitLabel="Create invitation"
            >
              <Field label="Email">
                <input
                  className={inputClassName()}
                  name="email"
                  type="email"
                  required
                />
              </Field>
              <Field label="Role">
                <select className={inputClassName()} name="role">
                  <option value="site_manager">Site manager</option>
                  <option value="organisation_admin">
                    Organisation administrator
                  </option>
                  <option value="hr_admin">HR administrator</option>
                  <option value="scheduler">Scheduler</option>
                </select>
              </Field>
              <Field label="Site scope">
                <select className={inputClassName()} name="siteId">
                  <option value="">
                    Organisation-wide, where role permits
                  </option>
                  {snapshot.sites
                    .filter((s) => s.active)
                    .map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                </select>
              </Field>
            </AdminCommandForm>
          </Panel>
          <Panel>
            <h2 className="text-lg font-black text-purple-950">
              Pending invitations
            </h2>
            <div className="mt-4 grid gap-3">
              {snapshot.invitations.length ? (
                snapshot.invitations.map((invitation) => (
                  <div
                    key={invitation.id}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-purple-100 p-3"
                  >
                    <div>
                      <p className="text-sm font-bold text-purple-950">
                        {invitation.email}
                      </p>
                      <p className="text-xs text-slate-500">
                        {prettyRole(invitation.kind)}
                      </p>
                    </div>
                    <InvitationControls
                      invitation={invitation}
                      revision={snapshot.organisation.revision}
                    />
                  </div>
                ))
              ) : (
                <EmptyState
                  title="No pending invitations"
                  body="New invitations will appear here."
                />
              )}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Devices({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  return (
    <>
      <PageHeader
        eyebrow="Devices and PINs"
        title="Online clocking-in devices"
        body="Register and replace site-bound devices. Offline attendance remains unavailable, and PINs are never shown after they are set."
      />
      <Panel className="mb-5 border-l-4 border-l-emerald-500">
        <div className="flex gap-3">
          <CheckCircle2 className="h-5 w-5 text-emerald-600" />
          <div>
            <p className="font-bold text-purple-950">
              Offline attendance is disabled
            </p>
            <p className="text-sm text-slate-600">
              Every attendance request requires the live server-authoritative
              path.
            </p>
          </div>
        </div>
      </Panel>
      <div className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <div className="grid gap-4">
          {snapshot.devices.length ? (
            snapshot.devices.map((device) => (
              <Panel key={device.id}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h2 className="font-black text-purple-950">
                      {device.deviceName}
                    </h2>
                    <p className="mt-1 text-sm text-slate-600">
                      {snapshot.sites.find((s) => s.id === device.siteId)
                        ?.name ?? "Site"}
                    </p>
                    <p className="mt-2 text-xs text-slate-500">
                      Last seen:{" "}
                      {device.lastSeenAt
                        ? new Intl.DateTimeFormat("en-GB", {
                            dateStyle: "medium",
                            timeStyle: "short",
                            timeZone: "Europe/London",
                          }).format(new Date(device.lastSeenAt))
                        : "Not yet connected"}
                    </p>
                  </div>
                  <StatusPill tone={device.active ? "green" : "grey"}>
                    {device.active ? "Active" : "Revoked"}
                  </StatusPill>
                </div>
                {device.active ? (
                  <>
                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      <AdminCommandForm
                        commandName="require_kiosk_reprovision"
                        revision={snapshot.organisation.revision}
                        submitLabel="Require reprovisioning"
                        tone="secondary"
                      >
                        <input type="hidden" name="deviceId" value={device.id} />
                      </AdminCommandForm>
                      <AdminCommandForm
                        commandName="revoke_kiosk_device"
                        revision={snapshot.organisation.revision}
                        submitLabel="Revoke device"
                        tone="danger"
                        confirmMessage="Revoke this device now? It will stop accepting clocking-in requests."
                      >
                        <input type="hidden" name="deviceId" value={device.id} />
                      </AdminCommandForm>
                    </div>
                    <ReplaceDeviceControl
                      device={device}
                      siteName={snapshot.sites.find((site) => site.id === device.siteId)?.name ?? "site"}
                      revision={snapshot.organisation.revision}
                    />
                  </>
                ) : null}
              </Panel>
            ))
          ) : (
            <EmptyState
              title="No devices"
              body="Register an online device for one of your sites."
            />
          )}
        </div>
        <div className="grid gap-5">
          <Panel>
            <h2 className="text-lg font-black text-purple-950">
              Register a device
            </h2>
            <AdminCommandForm
              className="mt-4"
              commandName="start_kiosk_registration"
              revision={snapshot.organisation.revision}
              submitLabel="Generate registration code"
            >
              <Field label="Device name">
                <input
                  className={inputClassName()}
                  name="deviceName"
                  placeholder="Reception tablet"
                  required
                />
              </Field>
              <Field label="Site">
                <select className={inputClassName()} name="siteId" required>
                  <option value="">Select a site</option>
                  {snapshot.sites
                    .filter((s) => s.active)
                    .map((site) => (
                      <option key={site.id} value={site.id}>
                        {site.name}
                      </option>
                    ))}
                </select>
              </Field>
            </AdminCommandForm>
          </Panel>
          <Panel>
            <h2 className="text-lg font-black text-purple-950">
              Reset a staff PIN
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Use a temporary PIN and give it to the staff member securely.
            </p>
            <AdminCommandForm
              className="mt-4"
              commandName="reset_staff_pin"
              revision={snapshot.organisation.revision}
              submitLabel="Reset PIN"
            >
              <Field label="Staff member">
                <select className={inputClassName()} name="staffId" required>
                  <option value="">Select staff</option>
                  {snapshot.staff
                    .filter((s) => s.active)
                    .map((staff) => (
                      <option key={staff.id} value={staff.id}>
                        {staff.fullName}
                      </option>
                    ))}
                </select>
              </Field>
              <Field label="Temporary PIN">
                <input
                  className={inputClassName()}
                  type="password"
                  inputMode="numeric"
                  pattern="[0-9]{4,6}"
                  name="temporaryPin"
                  required
                />
              </Field>
            </AdminCommandForm>
          </Panel>
        </div>
      </div>
    </>
  );
}

function Settings({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  return (
    <>
      <PageHeader
        eyebrow="Operational settings"
        title="Local operating defaults"
        body="Organisation defaults apply broadly. Site settings can override them without changing historical attendance evidence."
      />
      <div className="grid gap-5 xl:grid-cols-2">
        <Panel>
          <h2 className="text-lg font-black text-purple-950">
            Organisation defaults
          </h2>
          {snapshot.settings.organisation ? (
            <AdminCommandForm
              className="mt-4"
              commandName="update_organisation_settings"
              revision={snapshot.organisation.revision}
            >
              <Field label="Week starts on">
                <select
                  className={inputClassName()}
                  name="workWeekStarts"
                  defaultValue={snapshot.settings.organisation.workWeekStarts}
                >
                  <option value="1">Monday</option>
                  <option value="7">Sunday</option>
                </select>
              </Field>
              <Field label="Default timezone">
                <input
                  className={inputClassName()}
                  name="defaultTimezone"
                  defaultValue={snapshot.settings.organisation.defaultTimezone}
                />
              </Field>
            </AdminCommandForm>
          ) : (
            <p className="mt-4 text-sm text-slate-600">
              Default settings are unavailable.
            </p>
          )}
        </Panel>
        <Panel>
          <h2 className="text-lg font-black text-purple-950">
            Add a work area
          </h2>
          <AdminCommandForm
            className="mt-4"
            commandName="create_work_area"
            revision={snapshot.organisation.revision}
            submitLabel="Add work area"
          >
            <Field label="Name">
              <input
                className={inputClassName()}
                name="name"
                placeholder="Front office"
                required
              />
            </Field>
            <Field label="Site">
              <select className={inputClassName()} name="siteId" required>
                <option value="">Select a site</option>
                {snapshot.sites
                  .filter((s) => s.active)
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </Field>
          </AdminCommandForm>
          <div className="mt-5 flex flex-wrap gap-2">
            {snapshot.workAreas.map((area) => (
              <StatusPill key={area.id} tone="purple">
                {area.name}
              </StatusPill>
            ))}
          </div>
        </Panel>
        <Panel>
          <h2 className="text-lg font-black text-purple-950">
            Add a site closure
          </h2>
          <AdminCommandForm
            className="mt-4"
            commandName="create_site_closure"
            revision={snapshot.organisation.revision}
            submitLabel="Add closure"
          >
            <Field label="Label">
              <input
                className={inputClassName()}
                name="label"
                placeholder="Public holiday"
                required
              />
            </Field>
            <Field label="Site">
              <select className={inputClassName()} name="siteId" required>
                <option value="">Select a site</option>
                {snapshot.sites
                  .filter((s) => s.active)
                  .map((site) => (
                    <option key={site.id} value={site.id}>
                      {site.name}
                    </option>
                  ))}
              </select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts">
                <input
                  className={inputClassName()}
                  type="date"
                  name="startsOn"
                  required
                />
              </Field>
              <Field label="Ends">
                <input
                  className={inputClassName()}
                  type="date"
                  name="endsOn"
                  required
                />
              </Field>
            </div>
            <Field label="Notes">
              <textarea className={inputClassName("min-h-24")} name="notes" />
            </Field>
          </AdminCommandForm>
        </Panel>
        <Panel>
          <div className="flex gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-600" />
            <div>
              <h2 className="font-black text-purple-950">
                History stays intact
              </h2>
              <p className="mt-1 text-sm leading-6 text-slate-600">
                Archiving and effective-dated changes preserve past attendance,
                rota, leave and payroll evidence.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

function SiteSettings({ snapshot }: { snapshot: CommercialAdminSnapshot }) {
  return (
    <>
      <PageHeader
        eyebrow="Operational settings"
        title="Site hours and overrides"
        body="Edit the operating hours for each permitted site. These settings affect future operational guidance, not historical records."
      />
      <div className="grid gap-5 lg:grid-cols-2">
        {snapshot.settings.sites.map((setting) => {
          const site = snapshot.sites.find(
            (candidate) => candidate.id === setting.siteId,
          );
          return (
            <Panel key={setting.siteId}>
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-black text-purple-950">
                  {site?.name ?? "Site"}
                </h2>
                <StatusPill tone="purple">Europe/London</StatusPill>
              </div>
              <AdminCommandForm
                className="mt-5"
                commandName="update_site_settings"
                revision={snapshot.organisation.revision}
              >
                <input type="hidden" name="siteId" value={setting.siteId} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Opening time">
                    <input
                      className={inputClassName()}
                      type="time"
                      name="openingTime"
                      defaultValue={setting.openingTime?.slice(0, 5) ?? "08:00"}
                      required
                    />
                  </Field>
                  <Field label="Closing time">
                    <input
                      className={inputClassName()}
                      type="time"
                      name="closingTime"
                      defaultValue={setting.closingTime?.slice(0, 5) ?? "18:00"}
                      required
                    />
                  </Field>
                </div>
                <Field label="Week starts on">
                  <select
                    className={inputClassName()}
                    name="workWeekStartsOverride"
                    defaultValue={setting.workWeekStartsOverride ?? ""}
                  >
                    <option value="">Use organisation default</option>
                    <option value="1">Monday</option>
                    <option value="7">Sunday</option>
                  </select>
                </Field>
              </AdminCommandForm>
            </Panel>
          );
        })}
      </div>
    </>
  );
}

export function CommercialAdminScreen({
  snapshot,
  area,
  today,
}: {
  snapshot: CommercialAdminSnapshot;
  area: CommercialAdminArea;
  today: string;
}) {
  if (area === "organisation") return <Organisation snapshot={snapshot} />;
  if (area === "sites") return <Sites snapshot={snapshot} />;
  if (area === "staff") return <Staff snapshot={snapshot} today={today} />;
  if (area === "access") return <Access snapshot={snapshot} />;
  if (area === "devices") return <Devices snapshot={snapshot} />;
  if (area === "settings") return <Settings snapshot={snapshot} />;
  if (area === "site-settings") return <SiteSettings snapshot={snapshot} />;
  return <Overview snapshot={snapshot} />;
}
