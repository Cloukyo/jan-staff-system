"use client";

import { StaffKioskControl } from "@/components/kiosk/staff-kiosk-management";
import { EmptyState, Panel } from "@/components/ui/primitives";
import type { ManagerKioskRow } from "@/lib/kiosk/server";

export function StaffRecordClocking({
  person,
  refreshAction,
}: {
  person: ManagerKioskRow | null;
  refreshAction: () => Promise<void>;
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
          <form action={refreshAction}>
            <button
              className="inline-flex min-h-11 items-center rounded-lg bg-white px-4 py-2 text-sm font-semibold text-purple-900 ring-1 ring-purple-200 hover:bg-purple-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
              type="submit"
            >
              Refresh Staff Clock
            </button>
          </form>
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
