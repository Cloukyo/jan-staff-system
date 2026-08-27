"use client";

import { useActionState, useState } from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import type { StaffingSnapshot } from "@/lib/onboarding/staffing-contracts";
import { commitStaffingImportAction, createInitialStaffAction, finishStaffingAction, reviewStaffingRowAction, uploadStaffingCsvAction } from "@/lib/onboarding/staffing-actions";
import type { OnboardingFormState } from "@/lib/onboarding/actions";
import { OnboardingNotice } from "./onboarding-shell";

const initial: OnboardingFormState = { ok: false, code: "", message: "", fieldErrors: {}, values: {} };
const fieldClass = "onboarding-field";

function HiddenCommand({ revision, keyValue }: { revision: string; keyValue: string }) {
  return <><input type="hidden" name="expectedSessionRevision" value={revision}/><input type="hidden" name="idempotencyKey" value={keyValue}/></>;
}

export function InitialStaffing({ snapshot, draft, sessionRevision, idempotencyKeys }: { snapshot: StaffingSnapshot; draft: Record<string, unknown>; sessionRevision: string; idempotencyKeys: string[] }) {
  const [mode, setMode] = useState<"manual"|"import">(snapshot.activeBatch ? "import" : "manual");
  const [manualState, manualAction, manualPending] = useActionState(createInitialStaffAction, initial);
  const [uploadState, uploadAction, uploadPending] = useActionState(uploadStaffingCsvAction, initial);
  const value = (key: string, fallback = "") => manualState.values[key] ?? (typeof draft[key] === "string" ? String(draft[key]) : fallback);
  const allowance = snapshot.remainingStaffAllowance === null ? "Plan allowance available" : `${snapshot.remainingStaffAllowance} remaining on this plan`;
  return <div className="staffing-setup">
    <section className="staffing-summary" aria-label="Staffing status"><div><Users aria-hidden/><span><strong>{snapshot.activeStaffCount} active staff</strong><small>{allowance}</small></span></div><div><CheckCircle2 aria-hidden/><span><strong>{snapshot.firstSiteName ?? "First site"}</strong><small>New staff are assigned here</small></span></div></section>
    <div className="staffing-paths" role="tablist" aria-label="Choose how to add staff">
      <button type="button" role="tab" aria-selected={mode === "manual"} onClick={() => setMode("manual")}><UserPlus aria-hidden/><span><strong>Add one person</strong><small>Best for a small initial team</small></span></button>
      <button type="button" role="tab" aria-selected={mode === "import"} onClick={() => setMode("import")}><FileSpreadsheet aria-hidden/><span><strong>Import a CSV</strong><small>Preview and review before commit</small></span></button>
    </div>

    {mode === "manual" ? <form action={manualAction} className="onboarding-form staffing-form">
      <HiddenCommand revision={sessionRevision} keyValue={idempotencyKeys[0]}/>
      {manualState.message ? <OnboardingNotice tone={manualState.ok ? "success" : "error"}>{manualState.message}</OnboardingNotice> : null}
      <div className="onboarding-form-section"><div><h2>Person details</h2><p>This creates an organisation-owned staff profile and first-site assignment only.</p></div><div className="onboarding-form-grid">
        <label className={fieldClass}><span>External staff ID</span><input name="externalStaffId" defaultValue={value("externalStaffId")} aria-invalid={Boolean(manualState.fieldErrors.externalStaffId)}/><small>{manualState.fieldErrors.externalStaffId ?? "Your existing employee or payroll reference."}</small></label>
        <label className={fieldClass}><span>Full name</span><input name="fullName" autoComplete="name" defaultValue={value("fullName")} aria-invalid={Boolean(manualState.fieldErrors.fullName)} required/><small>{manualState.fieldErrors.fullName}</small></label>
        <label className={fieldClass}><span>Display name</span><input name="displayName" defaultValue={value("displayName")} required/><small>Shown in day-to-day operational screens.</small></label>
        <label className={fieldClass}><span>Work email <em>Optional</em></span><input name="email" type="email" autoComplete="email" defaultValue={value("email")}/><small>No invitation is sent.</small></label>
        <label className={fieldClass}><span>Employment status</span><select name="employmentStatus" defaultValue={value("employmentStatus","active")}><option value="active">Active</option><option value="future_starter">Future starter</option></select></label>
        <label className={fieldClass}><span>Start date</span><input name="startDate" type="date" defaultValue={value("startDate")} required/></label>
        <label className={fieldClass}><span>Role</span><select name="jobRole" defaultValue={value("jobRole","staff")}><option value="staff">Staff</option><option value="supervisor">Supervisor</option><option value="manager">Manager</option></select></label>
        <label className="staffing-check"><input type="checkbox" name="attendanceEligible" value="yes" defaultChecked={(manualState.values.attendanceEligible ?? String(draft.attendanceEligible ?? true)) !== "false"}/><span><strong>Attendance eligible</strong><small>This records eligibility only. Kiosk access stays disabled and no PIN is created.</small></span></label>
      </div></div>
      <div className="onboarding-form-actions onboarding-form-actions--split"><Button variant="secondary" name="intent" value="save_draft" disabled={manualPending}>Save draft</Button><Button name="intent" value="create" disabled={manualPending}>{manualPending ? "Saving safely..." : "Add staff member"}</Button></div>
    </form> : <section className="staffing-import">
      <form action={uploadAction} className="staffing-upload"><HiddenCommand revision={sessionRevision} keyValue={idempotencyKeys[1]}/>
        {uploadState.message ? <OnboardingNotice tone={uploadState.ok ? "success" : "error"}>{uploadState.message}</OnboardingNotice> : null}
        <FileSpreadsheet aria-hidden/><div><h2>Upload your staffing file</h2><p>CSV only, up to 250 rows and 1 MB. The file is validated first and is never imported automatically.</p><a href="/onboarding/staffing/template">Download the CSV template</a></div><input type="file" name="staffFile" accept=".csv,text/csv" required/><Button disabled={uploadPending}>{uploadPending ? "Validating..." : "Upload and review"}</Button>
      </form>
      {snapshot.activeBatch ? <ImportReview batch={snapshot.activeBatch} revision={sessionRevision} keyValue={idempotencyKeys[2]} currentUsage={snapshot.activeStaffCount} limit={snapshot.staffLimit}/> : null}
    </section>}

    <section className="staffing-safety"><AlertTriangle aria-hidden/><div><strong>Attendance remains off until later setup</strong><p>This step never creates a PIN, enables a kiosk, sends an invitation or starts the trial clock.</p></div></section>
    <form action={finishStaffingAction} className="onboarding-form-actions onboarding-form-actions--split"><HiddenCommand revision={sessionRevision} keyValue={idempotencyKeys[3]}/><Button variant="secondary" name="intent" value="skip">Skip for now</Button><Button name="intent" value="complete" disabled={snapshot.activeStaffCount === 0}>Continue with staffing</Button></form>
  </div>;
}

function ImportReview({ batch, revision, keyValue, currentUsage, limit }: { batch: NonNullable<StaffingSnapshot["activeBatch"]>; revision: string; keyValue: string; currentUsage: number; limit: number | null }) {
  const unresolved = batch.rows.filter((row) => row.decision === "needs_review").length;
  const [filter, setFilter] = useState<"all"|"errors"|"warnings"|"ready"|"excluded">("all");
  const isWarning = (codes: string[]) => codes.length > 0 && codes.every((code) => code === "probable_duplicate_name");
  const rows = batch.rows.filter((row) => filter === "all"
    || (filter === "excluded" && row.decision === "exclude")
    || (filter === "warnings" && isWarning(row.validationCodes))
    || (filter === "errors" && row.validationCodes.length > 0 && !isWarning(row.validationCodes))
    || (filter === "ready" && row.validationCodes.length === 0 && row.decision !== "exclude"));
  const expectedCreates = batch.rows.filter((row) => row.decision === "include" || row.decision === "confirm_new").length;
  return <div className="staffing-review"><div className="staffing-review__heading"><div><span>{batch.status === "expired" ? "Re-upload required" : "Review required"}</span><h2>{batch.safeFilename}</h2><p>{batch.status === "expired" ? "This private review batch has expired. Upload the source CSV again to create a fresh review. Already committed staff are unchanged." : `${batch.totalRows} rows, ${batch.includedRows} included, ${batch.excludedRows} excluded, ${unresolved} needing a decision.`}</p></div></div>
    <div className="staffing-review__metrics"><span><strong>{currentUsage}</strong> Before import</span><span><strong>{currentUsage + expectedCreates}</strong> After import</span><span><strong>{limit ?? "No fixed"}</strong> Plan limit</span></div>
    <div className="staffing-review__filters" aria-label="Filter import rows">{(["all","errors","warnings","ready","excluded"] as const).map((option) => <button type="button" aria-pressed={filter === option} onClick={() => setFilter(option)} key={option}>{option[0].toUpperCase()+option.slice(1)}</button>)}</div>
    <div className="staffing-review__table" role="region" aria-label="Import row review" tabIndex={0}><table><thead><tr><th>Person</th><th>Role</th><th>Attendance</th><th>Validation</th><th>Decision</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>
      <td data-label="Person"><strong>{row.fullName || "Missing name"}</strong><small>{row.externalStaffId || `Row ${row.sourceRowNumber}`}</small></td>
      <td data-label="Role">{row.jobRole}</td><td data-label="Attendance">{row.attendanceEligible ? "Eligible" : "Not eligible"}</td>
      <td data-label="Validation">{row.validationCodes.length ? row.validationCodes.map((code) => <span className="staffing-code" key={code}>{code.replaceAll("_", " ")}</span>) : <span className="staffing-valid">Ready</span>}</td>
      <td data-label="Decision">{row.decision === "needs_review" ? <form action={reviewStaffingRowAction}><HiddenCommand revision={revision} keyValue={row.id}/><input type="hidden" name="batchId" value={batch.id}/><input type="hidden" name="rowId" value={row.id}/><Button variant="secondary" name="decision" value="exclude">Exclude</Button>{row.validationCodes.every((code) => code === "probable_duplicate_name") ? <Button name="decision" value="confirm_new">Confirm new</Button> : null}</form> : <strong>{row.decision.replaceAll("_", " ")}</strong>}</td>
    </tr>)}</tbody></table>{rows.length === 0 ? <p className="staffing-review__empty">No rows match this filter.</p> : null}</div>
    <form action={commitStaffingImportAction} className="onboarding-form-actions"><HiddenCommand revision={revision} keyValue={keyValue}/><Button disabled={batch.status === "expired" || batch.status === "committed" || unresolved > 0 || batch.includedRows === 0}>{batch.status === "committed" ? "Import complete" : "Import reviewed rows"}</Button></form>
  </div>;
}
