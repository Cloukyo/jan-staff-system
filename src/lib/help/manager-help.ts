export type ManagerHelpTask = {
  id: string;
  group:
    | "Daily work"
    | "Staff records"
    | "Clocking in"
    | "Leave"
    | "Pay hours"
    | "Settings";
  title: string;
  summary: string;
  steps: readonly string[];
  href: string;
  shortcutLabel: string;
  keywords: readonly string[];
};

export const managerHelpTasks: ManagerHelpTask[] = [
  {
    id: "add-missing-clock-event",
    group: "Daily work",
    title: "Add a missing clock-in or clock-out",
    summary: "Record a time that a staff member forgot to clock.",
    steps: [
      "Open the missing clock event form.",
      "Choose the staff member, date and clock-in or clock-out time.",
      "Add the reason for the correction.",
      "Save the new manager correction.",
    ],
    href: "/attendance?view=hours",
    shortcutLabel: "Open Staff hours",
    keywords: [
      "forgot clock in",
      "forgot clock out",
      "missed clock",
      "missing time",
      "correction",
    ],
  },
  {
    id: "fix-one-clock-event",
    group: "Daily work",
    title: "Fix one clock event",
    summary: "Correct a recorded clock-in or clock-out while keeping the original record unchanged.",
    steps: [
      "Open Staff hours and choose the staff member.",
      "Open the day and choose Fix beside the event.",
      "Check the original and corrected values.",
      "Add a reason and save the correction.",
    ],
    href: "/attendance?view=hours",
    shortcutLabel: "Open Staff hours",
    keywords: ["wrong clock in", "wrong clock out", "fix event", "change time"],
  },
  {
    id: "use-planned-hours",
    group: "Daily work",
    title: "Use published planned hours",
    summary: "Apply the published rota boundaries after checking the proposed corrections.",
    steps: [
      "Open Staff hours and choose the staff member.",
      "Open the day and choose Use planned hours.",
      "Check the planned start, finish and any type changes.",
      "Add a reason and save the correction.",
    ],
    href: "/attendance?view=hours",
    shortcutLabel: "Open Staff hours",
    keywords: ["rota hours", "planned shift", "published rota", "apply planned hours"],
  },
  {
    id: "review-staff-week",
    group: "Daily work",
    title: "Review one person's week",
    summary: "Check one staff member's planned shifts, clock events and attendance warnings together.",
    steps: [
      "Open Staff hours.",
      "Choose the staff member.",
      "Open each day that needs attention.",
      "Save any corrections with a clear reason.",
    ],
    href: "/attendance?view=hours",
    shortcutLabel: "Open Staff hours",
    keywords: ["weekly attendance", "staff week", "hours detail", "review week"],
  },
  {
    id: "review-attendance",
    group: "Daily work",
    title: "Review attendance problems",
    summary: "Check missing times and other clocking problems that need a decision.",
    steps: [
      "Open the Needs attention view.",
      "Choose the day that you want to review.",
      "Open each problem and select the correct decision.",
      "Save the decision and any required reason.",
    ],
    href: "/attendance?view=needs-attention",
    shortcutLabel: "Open attendance problems",
    keywords: ["exceptions", "missing clock out", "wrong time", "follow up"],
  },
  {
    id: "edit-rota",
    group: "Daily work",
    title: "Create or change the rota",
    summary: "Add shifts, change hours and publish the weekly rota.",
    steps: [
      "Open the weekly rota.",
      "Choose the week and add or change staff shifts.",
      "Check the rota for warnings.",
      "Publish it when it is ready for staff.",
    ],
    href: "/rota",
    shortcutLabel: "Open weekly rota",
    keywords: ["shift", "schedule", "hours", "publish", "change rota"],
  },
  {
    id: "add-staff-member",
    group: "Staff records",
    title: "Add a staff member",
    summary: "Create a new staff record and enter their employment details.",
    steps: [
      "Open the new staff form.",
      "Enter their name, role and start date.",
      "Set the name that should appear on Staff Clock.",
      "Save the staff record.",
    ],
    href: "/staff?action=add",
    shortcutLabel: "Open new staff form",
    keywords: ["new employee", "new starter", "create staff", "employee record"],
  },
  {
    id: "change-staff-clock-name",
    group: "Staff records",
    title: "Change a name shown on Staff Clock",
    summary: "Update the familiar name staff see when clocking in.",
    steps: [
      "Open Staff records and choose the staff member.",
      "Open Employment.",
      "Change Name shown on Staff Clock and save.",
      "Refresh Staff Clock if the old name is still showing.",
    ],
    href: "/staff?filter=active",
    shortcutLabel: "Open active staff records",
    keywords: ["preferred name", "display name", "old name", "rename employee"],
  },
  {
    id: "enable-staff-clock",
    group: "Clocking in",
    title: "Enable Staff Clock and set a temporary PIN",
    summary: "Allow a staff member to use Staff Clock for the first time.",
    steps: [
      "Open Staff records and choose the staff member.",
      "Open Clocking in.",
      "Enable Staff Clock and enter a temporary PIN.",
      "Ask the staff member to replace it when they next clock in.",
    ],
    href: "/staff?filter=needs-setup",
    shortcutLabel: "Open staff needing setup",
    keywords: ["disabled", "kiosk access", "pin", "clocking access"],
  },
  {
    id: "manage-staff-login",
    group: "Staff records",
    title: "Enable or disable a staff login",
    summary: "Control whether a staff member can sign in to their own account.",
    steps: [
      "Open Staff records and choose the staff member.",
      "Open Staff login.",
      "Enable or disable their login.",
      "Save the change.",
    ],
    href: "/staff?filter=active",
    shortcutLabel: "Open active staff records",
    keywords: ["account", "disabled employee", "sign in", "login access"],
  },
  {
    id: "review-leave",
    group: "Leave",
    title: "Approve or reject a leave request",
    summary: "Review a staff leave request and record your decision.",
    steps: [
      "Open pending leave requests.",
      "Check the dates, hours and notes.",
      "Choose Approve or Reject.",
      "Add a note if needed and save the decision.",
    ],
    href: "/leave/requests",
    shortcutLabel: "Open pending leave requests",
    keywords: ["holiday", "annual leave", "time off", "decline", "pending"],
  },
  {
    id: "export-pay-hours",
    group: "Pay hours",
    title: "Check and export pay hours",
    summary: "Review attendance hours before downloading the manager workbook.",
    steps: [
      "Open Export pay hours and choose the date range.",
      "Check any unresolved attendance warnings.",
      "Confirm the hours are ready for preparation.",
      "Download the workbook.",
    ],
    href: "/payroll",
    shortcutLabel: "Open pay hours export",
    keywords: ["workbook", "download", "timesheet", "wages", "pay preparation"],
  },
  {
    id: "manage-clocking-device",
    group: "Settings",
    title: "Register or refresh a clocking-in device",
    summary: "Set up a nursery browser for Staff Clock or refresh its information.",
    steps: [
      "Open Clocking-in devices on the nursery device.",
      "Choose Register this browser if it is a new device.",
      "Choose Refresh Staff Clock when staff details have changed.",
    ],
    href: "/settings/kiosk",
    shortcutLabel: "Open clocking-in devices",
    keywords: ["tablet", "register this browser", "kiosk", "refresh staff clock"],
  },
];

function normaliseSearchText(value: string) {
  return value
    .toLocaleLowerCase("en-GB")
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();
}

export function filterManagerHelpTasks(query: string): ManagerHelpTask[] {
  const words = normaliseSearchText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return managerHelpTasks;

  return managerHelpTasks.filter((task) => {
    const searchableText = normaliseSearchText(
      [
        task.title,
        task.group,
        task.summary,
        ...task.steps,
        ...task.keywords,
      ].join(" "),
    );

    return words.every((word) => searchableText.includes(word));
  });
}
