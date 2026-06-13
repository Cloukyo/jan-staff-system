import Link from "next/link";
import { AlertTriangle, Eye, LayoutTemplate } from "lucide-react";
import { Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { applyRotaTemplateAction, saveRotaWeekAsTemplateAction } from "@/lib/rota/template-actions";
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
  return (
    <div className="mt-5 grid gap-5 xl:grid-cols-2">
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div><h2 className="flex items-center gap-2 text-xl font-black text-purple-950"><LayoutTemplate className="h-5 w-5" /> Save week as template</h2><p className="mt-1 text-sm text-slate-600">Creates an independent reusable copy. This rota week will not change.</p></div>
          <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900" href="/rota/templates">Manage templates</Link>
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
        <p className="mt-1 text-sm text-slate-600">Preview conflicts before any draft shifts are written.</p>
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
          <button className="min-h-11 rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900" type="submit">Preview template</button>
        </form>
      </Panel>

      {preview ? (
        <Panel className="xl:col-span-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-xl font-black text-purple-950">Preview: {preview.template.name}</h2><p className="text-sm text-slate-600">{modeLabels[preview.mode]}</p></div>
            <StatusPill tone={preview.canApply ? "green" : "red"}>{preview.canApply ? "Ready for manager confirmation" : "Blocked"}</StatusPill>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
            {[
              ["Create", preview.shiftsToCreate],
              ["Archive", preview.existingShiftsToArchive],
              ["Approved leave", preview.approvedLeaveConflicts],
              ["Pending leave", preview.pendingLeaveWarnings],
              ["Overlaps", preview.overlappingShifts],
              ["Duplicates", preview.duplicateShifts],
              ["Inactive", preview.inactiveStaff],
              ["Missing staff", preview.missingStaffProfiles],
              ["Expired certificates", preview.expiredCertificateWarnings],
            ].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-purple-50 p-3"><p className="text-xs font-bold text-purple-700">{label}</p><p className="mt-1 text-2xl font-black text-purple-950">{value}</p></div>)}
          </div>
          <div className="mt-4 max-h-80 overflow-auto rounded-lg border border-purple-100">
            <table className="w-full text-left text-sm">
              <thead><tr>{["Staff", "Date", "Time", "Outcome", "Warnings"].map((heading) => <th key={heading} className="sticky top-0 bg-purple-50 p-3 font-black text-purple-950">{heading}</th>)}</tr></thead>
              <tbody>{preview.rows.map((row) => (
                <tr key={row.templateShiftId} className="border-t border-purple-100">
                  <td className="p-3 font-bold">{row.staffName}</td><td className="p-3">{row.shiftDate}</td><td className="p-3">{row.startTime} to {row.endTime}</td>
                  <td className="p-3">{row.outcome.replaceAll("_", " ")}</td>
                  <td className="p-3">{row.warnings.length ? row.warnings.join(", ") : "None"}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          {preview.canApply ? (
            <RotaActionForm action={applyRotaTemplateAction} submitLabel="Confirm and apply template" className="mt-5 grid gap-3" confirmMessage={`Apply ${preview.template.name} to this draft rota using ${modeLabels[preview.mode].toLowerCase()}?`}>
              {hidden("templateId", preview.template.id)}{hidden("weekId", data.week.id)}{hidden("mode", preview.mode)}{hidden("requestKey", requestKey)}
              {preview.approvedLeaveConflicts ? <Field label="Approved leave override reason"><textarea className={inputClassName("min-h-20")} name="leaveOverrideReason" required /></Field> : null}
              {preview.overlappingShifts ? <Field label="Overlap override reason"><textarea className={inputClassName("min-h-20")} name="overlapOverrideReason" required /></Field> : null}
              {preview.mode === "replace" ? <label className="flex min-h-11 items-center gap-2 rounded-lg bg-red-50 p-3 font-bold text-red-800"><input name="confirmReplace" type="checkbox" required /> I confirm existing draft shifts on template days will be archived and replaced.</label> : null}
            </RotaActionForm>
          ) : <p className="mt-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-800"><AlertTriangle className="h-5 w-5" /> Resolve missing or inactive staff before applying this template.</p>}
        </Panel>
      ) : null}
    </div>
  );
}
