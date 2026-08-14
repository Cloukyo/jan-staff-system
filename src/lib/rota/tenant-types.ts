import { z } from "zod";

export const commercialOperationResultSchema = z.object({
  outcome: z.enum([
    "success",
    "permission_denied",
    "mfa_required",
    "not_found",
    "invalid_request",
    "conflict",
    "workflow_changed",
    "idempotency_conflict",
    "indeterminate",
  ]),
  code: z.string().optional(),
  revision: z.coerce.number().int().positive().optional(),
  weekId: z.string().uuid().optional(),
  shiftId: z.string().uuid().optional(),
  leaveRequestId: z.string().uuid().optional(),
  templateId: z.string().uuid().optional(),
  copiedShifts: z.coerce.number().int().nonnegative().optional(),
  skippedShifts: z.coerce.number().int().nonnegative().optional(),
  affectedShiftCount: z.coerce.number().int().nonnegative().optional(),
});

export type CommercialOperationResult = z.infer<typeof commercialOperationResultSchema>;

export type CommercialRotaCommand =
  | "create_week"
  | "save_shift"
  | "archive_shift"
  | "set_week_status"
  | "copy_previous_week"
  | "copy_day"
  | "save_week_as_template"
  | "apply_template";

export type CommercialLeaveCommand = "create_leave" | "cancel_leave" | "review_leave";

export type PlannedShiftRow = {
  organisation_id: string;
  site_id: string;
  shift_id: string;
  rota_week_id: string;
  staff_id: string;
  shift_date: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  work_area_id: string | null;
  role_on_shift: string | null;
};
