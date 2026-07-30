import {
  getTrustedState,
  listPendingActions,
} from "@/lib/kiosk/offline/database";
import type { AttendanceStateResult } from "@/lib/attendance/types";

export async function buildProvisionalState(
  staffId: string,
): Promise<AttendanceStateResult> {
  const trusted = await getTrustedState(staffId);
  if (!trusted) {
    throw new Error("A trusted attendance snapshot is required");
  }

  const provisional = structuredClone(trusted.state);
  const actions = (await listPendingActions())
    .filter((action) => action.staffId === staffId)
    .filter((action) => ["pending", "syncing"].includes(action.status));

  for (const action of actions) {
    if (action.action === "clock_out") {
      provisional.state = "clocked_out";
      provisional.currentEvent = null;
      provisional.allowedActions = ["clock_in"];
    } else {
      provisional.state = "clocked_in";
      provisional.currentEvent = null;
      provisional.allowedActions = ["clock_out"];
    }
    provisional.revision = `${provisional.revision}:pending:${action.idempotencyKey}`;
    provisional.evaluatedAt = action.occurredAtDevice;
    provisional.operationalDate = action.operationalDateAtDevice;
  }

  return provisional;
}
