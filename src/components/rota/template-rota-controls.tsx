import Link from "next/link";
import { AlertTriangle, CheckCircle2, ChevronDown, Eye, LayoutTemplate, MinusCircle, RefreshCw } from "lucide-react";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { applyRotaTemplateAction, saveRotaWeekAsTemplateAction } from "@/lib/rota/template-actions";
import { groupTemplatePreview, templateConfirmationLabel } from "@/lib/rota/grid";
import type { ProductionRotaDataset } from "@/lib/rota/types";
import type { RotaTemplate, RotaTemplateApplyMode, TemplateApplicationPreview } from "@/lib/rota/template-types";

const modeLabels: Record<RotaTemplateApplyMode, string> = {
  empty_days: "Apply only to empty days",
  replace: "Replace existing draft shifts",
  alongside: "Add alongside existing shifts",
};

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

const groupStyles = {
  green: "border-green-200 bg-green-50 text-green-900",
  grey: "border-slate-200 bg-slate-50 text-slate-800",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  red: "border-red-200 bg-red-50 text-red-900",
};

export function TemplateRotaControls({
  data,
  templates,
  preview,
  selectedTemplateId,
  selectedMode,
  requestKey,
}: {
  data: ProductionRotaDataset;
  templates: RotaTemplate[];
  preview: TemplateApplicationPreview | null;
  selectedTemplateId?: string;
  selectedMode: RotaTemplateApplyMode;
  requestKey: string;
}) {
  if (!data.week) return null;
  const groups = preview ? groupTemplatePreview(preview) : [];
  const confirmationLabel = preview ? templateConfirmationLabel(preview) : "";
  const noChanges = preview?.shiftsToCreate === 0;
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-xl font-black text-purple-950"><LayoutTemplate className="h-5 w-5" /> Save week as template</h2><p className="mt-1 text-sm text-slate-600">Create an independent reusable copy without changing this rota.</p></div>
          <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900 hover:bg-purple-50" href="/rota/templates">Manage templates</Link>
        </div>
        <RotaActionForm action={saveRotaWeekAsTemplateAction} submitLabel="Save week as template" className="mt-4 grid gap-3">
          {hidden("weekId", data.week.id)}
          <Field label="Template name"><input className={inputClassName()} name="name" required /></Field>
          <Field label="Description"><textarea className={inputClassName("min-h-20")} name="description" /></Field>
          <label className="flex min-h-11 items-center gap-2 font-bold text-purple-950"><input name="includeCancelled" type="checkbox" /> Include cancelled shifts</label>
        </RotaActionForm>
      </Panel>

      <Panel>
        <h2 className="flex items-center gap-2 text-xl font-black text-purple-950"><Eye className="h-5 w-5" /> Apply template</h2>
        <p className="mt-1 text-sm text-slate-600">Preview grouped changes and conflicts before writing any draft shifts.</p>
        <form className="mt-4 grid gap-3">
          {hidden("week", data.weekStart)}
          <Field label="Template">
            <select className={inputClassName()} name="template" defaultValue={selectedTemplateId ?? ""} required>
              <option value="" disabled>Select a template</option>
              {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
            </select>
          </Field>
          <Field label="Application mode">
            <select className={inputClassName()} name="templateMode" defaultValue={selectedMode}>
              <option value="empty_days">{modeLabels.empty_days}</option>
              <option value="alongside">{modeLabels.alongside}</option>
              <option value="replace">{modeLabels.replace}</option>
            </select>
          </Field>
          <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900 hover:bg-purple-50" type="submit"><RefreshCw className="h-4 w-4" /> Preview template</button>
        </form>
      </Panel>

      {preview ? (
        <Panel className="xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-black text-purple-950">Preview: {preview.template.name}</h2><p className="mt-1 text-sm text-slate-600">{modeLabels[preview.mode]}</p></div>
            <StatusPill tone={!preview.canApply ? "red" : noChanges ? "grey" : "green"}>{!preview.canApply ? "Blocked" : noChanges ? "No changes" : "Ready for confirmation"}</StatusPill>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-green-200 bg-green-50 p-4"><p className="text-sm font-bold text-green-800">Shifts to create</p><p className="mt-1 text-3xl font-black text-green-950">{preview.shiftsToCreate}</p></div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-sm font-bold text-slate-700">Existing identical shifts</p><p className="mt-1 text-3xl font-black text-slate-950">{preview.duplicateShifts}</p></div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-sm font-bold text-red-800">Shifts to replace</p><p className="mt-1 text-3xl font-black text-red-950">{preview.existingShiftsToArchive}</p></div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-4"><p className="text-sm font-bold text-amber-800">Warnings</p><p className="mt-1 text-3xl font-black text-amber-950">{preview.approvedLeaveConflicts + preview.pendingLeaveWarnings + preview.overlappingShifts + preview.inactiveStaff + preview.missingStaffProfiles + preview.expiredCertificateWarnings}</p></div>
          </div>

          <div className="mt-5 grid gap-3">
            {groups.map((group) => (
              <details key={group.key} className={`rounded-xl border ${groupStyles[group.tone]}`} open={group.key !== "unchanged" && group.rows.length <= 8}>
                <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-black">
                  <span>{group.rows.length} {group.label.toLowerCase()}</span><ChevronDown className="h-5 w-5" />
                </summary>
                <div className="border-t border-current/15 px-4 py-3">
                  <div className="grid gap-2">
                    {group.rows.map((row) => (
                      <div key={`${group.key}-${row.templateShiftId}`} className="grid gap-1 rounded-lg bg-white/70 p-3 text-sm sm:grid-cols-[9rem_1fr_auto] sm:items-center">
                        <span className="font-bold">{row.shiftDate}</span>
                        <span><strong>{row.staffName}</strong> · {row.startTime} to {row.endTime}</span>
                        <span className="text-xs font-semibold">{row.warnings.length ? row.warnings.join(", ") : row.outcome.replaceAll("_", " ")}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </details>
            ))}
          </div>

          {preview.canApply ? (
            <RotaActionForm
              action={applyRotaTemplateAction}
              submitLabel={confirmationLabel}
              submitDisabled={noChanges}
              className="mt-5 grid gap-3"
              confirmMessage={`Apply ${preview.template.name} using ${modeLabels[preview.mode].toLowerCase()}?`}
            >
              {hidden("templateId", preview.template.id)}{hidden("weekId", data.week.id)}{hidden("mode", preview.mode)}{hidden("requestKey", requestKey)}
              {preview.approvedLeaveConflicts ? <Field label="Approved leave override reason"><textarea className={inputClassName("min-h-20")} name="leaveOverrideReason" required /></Field> : null}
              {preview.overlappingShifts ? <Field label="Overlap override reason"><textarea className={inputClassName("min-h-20")} name="overlapOverrideReason" required /></Field> : null}
              {preview.mode === "replace" ? <label className="flex min-h-11 items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 font-bold text-red-800"><input name="confirmReplace" type="checkbox" required /> I confirm existing draft shifts on template days will be archived and replaced.</label> : null}
              {noChanges ? <p className="flex items-center gap-2 text-sm font-bold text-slate-600"><MinusCircle className="h-5 w-5" /> Every relevant shift is unchanged or skipped. Nothing will be written.</p> : <p className="flex items-center gap-2 text-sm font-bold text-green-700"><CheckCircle2 className="h-5 w-5" /> The confirmation label shows the exact result.</p>}
            </RotaActionForm>
          ) : <p className="mt-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle className="h-5 w-5" /> Resolve missing or inactive staff before applying this template.</p>}
        </Panel>
      ) : null}
    </div>
  );
}
