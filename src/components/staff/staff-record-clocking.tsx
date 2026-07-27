"use client";

import { StaffKioskControl } from "@/components/kiosk/staff-kiosk-management";
import { RefreshStaffClockControl } from "@/components/kiosk/device-management";
import { EmptyState, Panel } from "@/components/ui/primitives";
import type { ManagerKioskRow } from "@/lib/kiosk/server";

export function StaffRecordClocking({
  person,
}: {
  person: ManagerKioskRow | null;
}) {
  return (
    <div className="grid gap-4">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-black text-purple-950">Clocking-in access and PIN</h2>
            <p className="mt-2 text-sm text-slate-600">
              Choose whether this employee can use Staff Clock and set a temporary PIN when needed.
            </p>
          </div>
          <RefreshStaffClockControl />
        </div>
      </Panel>
      {person ? (
        <StaffKioskControl person={person} />
      ) : (
        <Panel>
          <EmptyState
            title="Clocking in is unavailable"
            body="This employee is inactive. Make the employment record active before setting up Staff Clock."
          />
        </Panel>
      )}
    </div>
  );
}
