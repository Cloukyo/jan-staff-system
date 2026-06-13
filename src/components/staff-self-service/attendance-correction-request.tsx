"use client";

import { ProductionActionForm } from "@/components/compliance/production-action-form";
import { Field, Panel, inputClassName } from "@/components/ui/primitives";
import { submitAttendanceCorrectionRequestAction } from "@/lib/attendance/review-actions";

export function AttendanceCorrectionRequest({ defaultDate }: { defaultDate: string }) {
  return (
    <Panel>
      <h2 className="text-xl font-black text-purple-950">Report an attendance issue</h2>
      <p className="mt-2 text-sm text-slate-600">This sends a request to a manager. It does not alter the original clock events.</p>
      <ProductionActionForm action={submitAttendanceCorrectionRequestAction} submitLabel="Send request" className="mt-4">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Attendance date"><input className={inputClassName()} type="date" name="attendanceDate" defaultValue={defaultDate} required /></Field>
          <Field label="Issue">
            <select className={inputClassName()} name="issueType" required>
              <option value="forgot_clock_in">Forgot to clock in</option>
              <option value="forgot_clock_out">Forgot to clock out</option>
              <option value="incorrect_time">Incorrect time</option>
              <option value="other">Other issue</option>
            </select>
          </Field>
        </div>
        <Field label="What happened?"><textarea className={inputClassName("min-h-24")} name="staffNote" minLength={5} maxLength={1000} required /></Field>
      </ProductionActionForm>
    </Panel>
  );
}
