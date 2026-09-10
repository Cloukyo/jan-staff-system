"use client";

import { addDays, format, parseISO } from "date-fns";
import {
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  Pencil,
  Plus,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { Button, Field, StatusPill, inputClassName } from "@/components/ui/primitives";
import {
  archiveRotaShiftAction,
  copyPreviousDayPatternAction,
  copyShiftHoursToDaysAction,
  saveRotaShiftAction,
} from "@/lib/rota/actions";
import { getActiveIndustryProfile } from "@/lib/platform/industry-profile";

const industryProfile = getActiveIndustryProfile();
import {
  dayCoverage,
  formatScheduledHours,
  laterWeekDates,
  previousDayShifts,
  scheduledMinutes,
  shiftWarningSummary,
} from "@/lib/rota/grid";
import { shiftAttentionItems, staffMayBeginWorkOn } from "@/lib/rota/presentation";
import type { ProductionRotaDataset, ProductionRotaShift, ProductionRotaStaff } from "@/lib/rota/types";

const weekdayLabels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

type EditorState = {
  staff: ProductionRotaStaff;
  date: string;
  shift?: ProductionRotaShift;
};

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

function ShiftEditorDrawer({
  data,
  editor,
  onClose,
}: {
  data: ProductionRotaDataset;
  editor: EditorState;
  onClose: () => void;
}) {
  const shift = editor.shift;
  const [selectedStaffId, setSelectedStaffId] = useState(editor.staff.id);
  const [selectedDate, setSelectedDate] = useState(editor.date);
  const [saveOperationId] = useState(() => crypto.randomUUID());
  const [archiveOperationId] = useState(() => crypto.randomUUID());
  const previousDate = format(addDays(parseISO(editor.date), -1), "yyyy-MM-dd");
  const previousShifts = previousDayShifts(editor.staff.id, editor.date, data.shifts);
  const laterDates = shift ? laterWeekDates(data.weekStart, editor.date) : [];
  const selectedStaff = data.staff.find((person) => person.id === selectedStaffId) ?? editor.staff;
  const mayBeginWork = staffMayBeginWorkOn(selectedStaff, selectedDate);
  const shiftAttention = shift ? shiftAttentionItems(shift, data.shifts, data.leave) : [];
  const previousDayConfirmation = previousShifts.length
    ? `This will replace existing shifts for ${editor.staff.fullName} on ${format(parseISO(editor.date), "EEEE d MMMM")} with the previous day's hours. Continue?`
    : `${editor.staff.fullName} was not working on ${format(parseISO(previousDate), "EEEE d MMMM")}. This will remove existing shifts on ${format(parseISO(editor.date), "EEEE d MMMM")}. Continue?`;
  return (
    <div className="fixed inset-0 z-50 bg-purple-950/35" role="presentation" onMouseDown={onClose}>
      <section
        aria-labelledby="shift-editor-title"
        aria-modal="true"
        className="absolute inset-y-0 right-0 flex w-full max-w-xl flex-col overflow-y-auto bg-white shadow-2xl"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-start justify-between border-b border-purple-100 bg-white px-5 py-4">
          <div>
            <p className="text-sm font-bold text-purple-700">{shift ? "Edit shift" : "Add shift"}</p>
            <h2 id="shift-editor-title" className="mt-1 text-xl font-black text-purple-950">
              {editor.staff.fullName}
            </h2>
            <p className="mt-1 text-sm font-bold text-purple-800">{editor.staff.employmentRole}</p>
            <p className="mt-1 text-sm text-slate-600">{format(parseISO(editor.date), "EEEE d MMMM yyyy")}</p>
          </div>
          <Button type="button" variant="ghost" aria-label="Close shift editor" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>

        <section className="border-b border-purple-100 bg-purple-50/60 p-5" aria-labelledby="copy-hours-title">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-white p-2 text-purple-700 shadow-sm"><Copy className="h-5 w-5" /></span>
            <div>
              <h3 id="copy-hours-title" className="font-black text-purple-950">Copy hours</h3>
              <p className="mt-1 text-sm text-slate-600">Copies start, finish and break only. {industryProfile.workAreaSingular}, role and notes stay separate.</p>
            </div>
          </div>

          {!data.organisationId ? <RotaActionForm
            action={copyPreviousDayPatternAction}
            submitLabel="Copy previous day"
            pendingLabel="Copying..."
            variant="secondary"
            className="mt-4 grid gap-3 rounded-xl border border-purple-100 bg-white p-4"
            confirmMessage={previousDayConfirmation}
            onSuccess={onClose}
            submitDisabled={!data.week || editor.date === data.weekStart}
          >
            {hidden("weekId", data.week?.id ?? "")}
            {hidden("staffId", editor.staff.id)}
            {hidden("targetDate", editor.date)}
            <p className="text-sm font-bold text-purple-950">
              {editor.date === data.weekStart
                ? "Previous-day copying is available from Tuesday onwards."
                : `Use ${format(parseISO(previousDate), "EEEE")}'s ${previousShifts.length ? previousShifts.map((item) => `${item.startTime} to ${item.endTime}`).join(" and ") : "not working"} pattern.`}
            </p>
          </RotaActionForm> : null}

          {!data.organisationId && shift && shift.status !== "cancelled" && laterDates.length ? (
            <RotaActionForm
              action={copyShiftHoursToDaysAction}
              submitLabel="Copy to other days"
              pendingLabel="Copying..."
              variant="secondary"
              className="mt-4 grid gap-3 rounded-xl border border-purple-100 bg-white p-4"
              confirmMessage={`This will replace existing shifts on the selected days with ${shift.startTime} to ${shift.endTime}. Continue?`}
              onSuccess={onClose}
            >
              {hidden("shiftId", shift.id)}
              <fieldset>
                <legend className="text-sm font-black text-purple-950">Choose later days this week</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {laterDates.map((date) => (
                    <label key={date} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-purple-100 px-3 py-2 text-sm font-bold text-purple-950 hover:bg-purple-50">
                      <input className="h-5 w-5 accent-purple-700" type="checkbox" name="targetDates" value={date} />
                      {format(parseISO(date), "EEEE d MMMM")}
                    </label>
                  ))}
                </div>
              </fieldset>
            </RotaActionForm>
          ) : null}
        </section>

        <RotaActionForm
          action={saveRotaShiftAction}
          submitLabel={shift ? "Save changes" : "Add shift"}
          className="grid flex-1 content-start gap-5 p-5"
          onSuccess={onClose}
          submitDisabled={mayBeginWork === false}
        >
          {hidden("rotaWeekId", data.week?.id ?? "")}
          {hidden("operationId", saveOperationId)}
          {shift ? hidden("shiftId", shift.id) : null}
          {shift?.revision ? hidden("revision", String(shift.revision)) : null}
          <div className="rounded-xl border border-purple-100 bg-purple-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><p className="font-black text-purple-950">{selectedStaff.fullName}</p><p className="text-sm text-slate-600">{format(parseISO(selectedDate), "EEEE d MMMM yyyy")}</p></div>
              {shift ? <StatusPill tone="purple">Current: {shift.status.replaceAll("_", " ")}</StatusPill> : <StatusPill tone="purple">New shift</StatusPill>}
            </div>
            {shift ? <p className="mt-3 text-sm font-bold text-purple-900">Current time: {shift.startTime} to {shift.endTime}</p> : null}
          </div>
          {mayBeginWork === false ? <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-950"><p className="font-black">Cannot work on this date</p><p className="mt-1">Recruitment requirements or manager authorisation are not effective. Review the staff record before saving a shift.</p><a className="mt-2 inline-block min-h-11 py-2 font-black underline" href={`/compliance/staff/${selectedStaff.id}`}>Review recruitment record</a></div> : null}
          {shiftAttention.length ? <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"><p className="font-black">This shift needs attention</p><ul className="mt-2 list-disc space-y-1 pl-5">{shiftAttention.map((item) => <li key={item.label}>{item.label}</li>)}</ul></div> : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Staff member">
              <select className={inputClassName()} name="staffId" value={selectedStaffId} onChange={(event) => setSelectedStaffId(event.target.value)} required>
                {data.staff.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.fullName}{person.active ? "" : " (inactive)"}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Date">
              <input
                className={inputClassName()}
                name="shiftDate"
                type="date"
                min={data.weekStart}
                max={format(addDays(parseISO(data.weekStart), 6), "yyyy-MM-dd")}
                value={selectedDate}
                onChange={(event) => setSelectedDate(event.target.value)}
                required
              />
            </Field>
            <Field label="Start time">
              <input className={inputClassName()} name="startTime" type="time" step={data.settings.shiftIntervalMinutes * 60} defaultValue={shift?.startTime ?? data.settings.openingTime} required />
            </Field>
            <Field label="Finish time">
              <input className={inputClassName()} name="endTime" type="time" step={data.settings.shiftIntervalMinutes * 60} defaultValue={shift?.endTime ?? data.settings.closingTime} required />
            </Field>
            <Field label="Break duration">
              <input className={inputClassName()} name="breakMinutes" type="number" min="0" step="5" defaultValue={shift?.breakUnspecified ? "" : shift?.breakMinutes ?? ""} placeholder="Not specified" />
            </Field>
            <Field label="Shift status">
              <select className={inputClassName()} name="status" defaultValue={shift?.status ?? "scheduled"}>
                <option value="scheduled">Scheduled</option>
                <option value="cancelled">Cancelled</option>
                <option value="completed">Completed</option>
              </select>
            </Field>
            <Field label={industryProfile.workAreaSingular}>
              {data.settings.workAreaOptions ? (
                <select className={inputClassName()} name="workAreaId" defaultValue={shift?.workAreaId ?? ""}>
                  <option value="">No work area</option>
                  {data.settings.workAreaOptions.map((area) => <option key={area.id} value={area.id}>{area.name}</option>)}
                </select>
              ) : <input className={inputClassName()} name="workArea" list="rota-work-areas" defaultValue={shift?.workArea ?? shift?.roomOrArea ?? ""} />}
            </Field>
            <Field label="Role on shift">
              <input className={inputClassName()} name="roleOnShift" defaultValue={shift?.roleOnShift ?? ""} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputClassName("min-h-24")} name="notes" defaultValue={shift?.notes ?? ""} />
          </Field>
          <details className="rounded-xl border border-purple-100 p-4" open={shiftAttention.length > 0}>
            <summary className="min-h-11 cursor-pointer font-black text-purple-950">Conflict and exception reasons</summary>
            <p className="mb-3 text-sm text-slate-600">Complete only when the system reports a conflict that the manager is authorised to resolve.</p>
            <div className="grid gap-4">
              <Field label="Leave override reason"><textarea className={inputClassName("min-h-20")} name="leaveOverrideReason" defaultValue={shift?.leaveOverrideReason ?? ""} /></Field>
              <Field label="Overlap override reason"><textarea className={inputClassName("min-h-20")} name="overlapOverrideReason" defaultValue={shift?.overlapOverrideReason ?? ""} /></Field>
              <Field label="Inactive staff override reason"><textarea className={inputClassName("min-h-20")} name="inactiveStaffOverrideReason" defaultValue={shift?.inactiveStaffOverrideReason ?? ""} /></Field>
            </div>
          </details>
          <p className="text-sm text-slate-600">Saving updates this person&apos;s shift for the selected date. Published rota visibility follows the week status.</p>
          <div className="sticky bottom-0 -mx-5 mt-auto flex flex-wrap justify-end gap-3 border-t border-purple-100 bg-white px-5 py-4">
            <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          </div>
        </RotaActionForm>

        {shift ? (
          <RotaActionForm
            action={archiveRotaShiftAction}
            submitLabel="Archive shift"
            variant="danger"
            className="border-t border-purple-100 p-5"
            confirmMessage={`Archive ${editor.staff.fullName}'s ${shift.startTime} to ${shift.endTime} shift on ${format(parseISO(shift.shiftDate), "EEEE d MMMM yyyy")}? It will no longer appear in the active rota.`}
            onSuccess={onClose}
          >
            {hidden("shiftId", shift.id)}
            {hidden("operationId", archiveOperationId)}
            {shift.revision ? hidden("revision", String(shift.revision)) : null}
          </RotaActionForm>
        ) : null}
      </section>
    </div>
  );
}

function WarningIcons({ shift, data }: { shift: ProductionRotaShift; data: ProductionRotaDataset }) {
  const warnings = shiftWarningSummary(shift, data.shifts, data.leave);
  return (
    <span className="flex items-center gap-1">
      {warnings.approvedLeave ? <AlertTriangle className="h-4 w-4 text-red-700" aria-label="Approved leave conflict" /> : null}
      {warnings.pendingLeave ? <CircleAlert className="h-4 w-4 text-amber-700" aria-label="Pending leave warning" /> : null}
      {warnings.overlap ? <AlertTriangle className="h-4 w-4 text-red-700" aria-label="Overlapping shift" /> : null}
      {shift.breakUnspecified ? <Clock3 className="h-4 w-4 text-amber-700" aria-label="Break duration not specified" /> : null}
    </span>
  );
}

function ShiftCellButton({
  shift,
  data,
  onEdit,
}: {
  shift: ProductionRotaShift;
  data: ProductionRotaDataset;
  onEdit: () => void;
}) {
  const total = scheduledMinutes(shift);
  const attention = shiftAttentionItems(shift, data.shifts, data.leave);
  const tone = shift.status === "cancelled"
    ? "border-slate-200 bg-slate-50"
    : shift.status === "completed"
      ? "border-green-200 bg-green-50/70"
      : "border-purple-200 bg-white hover:border-purple-500 hover:bg-purple-50/50";
  return (
    <button
      type="button"
      onClick={onEdit}
      className={`group min-h-28 w-full rounded-xl border p-3 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700 ${tone}`}
      aria-label={`Edit ${shift.startTime} to ${shift.endTime} shift`}
    >
      <span className="flex items-start justify-between gap-2">
        <span className="whitespace-nowrap text-sm font-black text-purple-950">{shift.startTime}–{shift.endTime}</span>
        <Pencil className="h-4 w-4 text-purple-400 group-hover:text-purple-700" aria-hidden />
      </span>
      <span className="mt-1 block text-xs font-semibold text-slate-600">
        {shift.breakUnspecified ? "Break not specified" : `${shift.breakMinutes} min break`} · {formatScheduledHours(total.minutes)}
      </span>
      {shift.workArea || shift.roomOrArea || shift.roleOnShift ? (
        <span className="mt-2 block text-sm font-bold text-purple-800">{shift.workArea || shift.roomOrArea || shift.roleOnShift}</span>
      ) : null}
      <span className="mt-2 flex items-center justify-between gap-2">
        <StatusPill tone={shift.status === "scheduled" ? "purple" : shift.status === "completed" ? "green" : "grey"}>{shift.status}</StatusPill>
        <WarningIcons shift={shift} data={data} />
      </span>
      {attention.length ? <span className={`mt-2 block text-xs font-black leading-snug ${attention.some((item) => item.tone === "danger") ? "text-red-700" : "text-amber-800"}`}>{attention.map((item) => item.label).join(" · ")}</span> : null}
    </button>
  );
}

function CoverageSummary({ dates, data }: { dates: string[]; data: ProductionRotaDataset }) {
  return (
    <section aria-labelledby="coverage-heading" className="border-b border-purple-100 bg-purple-50/60">
      <div className="flex items-center justify-between px-4 py-3">
        <h2 id="coverage-heading" className="font-black text-purple-950">Daily coverage</h2>
        <p className="text-xs font-semibold text-slate-600">Scheduled hours exclude specified unpaid breaks</p>
      </div>
      <div className="grid min-w-[760px] grid-cols-[13rem_repeat(5,minmax(8rem,1fr))_7rem] border-t border-purple-100">
        <div className="border-r border-purple-100 px-4 py-3 text-sm font-bold text-purple-800">Coverage summary</div>
        {dates.slice(0, 5).map((date) => {
          const coverage = dayCoverage(date, data.shifts, data.leave);
          return (
            <div key={date} className="border-r border-purple-100 px-3 py-3 text-xs text-slate-600">
              <p className="flex items-center gap-1 font-black text-purple-950"><Users className="h-4 w-4" /> {coverage.staffCount} staff · {coverage.shiftCount} shifts</p>
              <p className="mt-1">{coverage.earliestStart ?? "—"} to {coverage.latestFinish ?? "—"}</p>
              <p className="mt-1">{formatScheduledHours(coverage.minutes)} staffed</p>
              {coverage.approvedLeaveCount || coverage.conflicts || coverage.unknownBreaks ? (
                <p className="mt-1 font-bold text-amber-800">
                  {coverage.approvedLeaveCount ? `${coverage.approvedLeaveCount} leave · ` : ""}
                  {coverage.conflicts ? `${coverage.conflicts} conflict · ` : ""}
                  {coverage.unknownBreaks ? `${coverage.unknownBreaks} unknown break` : ""}
                </p>
              ) : null}
            </div>
          );
        })}
        <div className="px-3 py-3 text-xs font-bold text-purple-800">Week totals</div>
      </div>
    </section>
  );
}

export function ProductionRotaGrid({ data }: { data: ProductionRotaDataset }) {
  const [showWeekend, setShowWeekend] = useState(false);
  const [selectedDay, setSelectedDay] = useState(0);
  const [mobileView, setMobileView] = useState<"day" | "staff">("day");
  const [selectedStaffId, setSelectedStaffId] = useState(data.staff[0]?.id ?? "");
  const [editor, setEditor] = useState<EditorState | null>(null);
  const allDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => format(addDays(parseISO(data.weekStart), index), "yyyy-MM-dd")),
    [data.weekStart],
  );
  const dates = showWeekend ? allDates : allDates.slice(0, 5);
  const activeStaff = data.staff.filter((person) => person.active);
  const today = format(new Date(), "yyyy-MM-dd");
  const selectedStaff = activeStaff.find((person) => person.id === selectedStaffId) ?? activeStaff[0];

  const shiftsFor = (staffId: string, date: string) =>
    data.shifts.filter((shift) => shift.staffId === staffId && shift.shiftDate === date);

  return (
    <>
      <datalist id="rota-work-areas">{(data.settings.availableWorkAreas ?? data.settings.availableRooms).map((area) => <option key={area} value={area} />)}</datalist>
      <section className="overflow-hidden rounded-2xl border border-purple-100 bg-white shadow-soft" aria-label="Weekly staff rota grid">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-purple-100 px-4 py-3">
          <div>
            <h2 className="text-xl font-black text-purple-950">Staff schedule</h2>
            <p className="mt-1 text-sm text-slate-600">Select any cell to add or edit a shift.</p>
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm font-bold text-purple-950">
            <input className="h-5 w-5 accent-purple-700" type="checkbox" checked={showWeekend} onChange={(event) => setShowWeekend(event.target.checked)} />
            Show weekend
          </label>
        </div>

        <div className="hidden overflow-x-auto md:block">
          {!showWeekend ? <CoverageSummary dates={dates} data={data} /> : null}
          <table className={`w-full border-separate border-spacing-0 text-sm ${showWeekend ? "min-w-[1320px]" : "min-w-[980px]"}`}>
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 top-0 z-30 w-52 border-b border-r border-purple-100 bg-purple-50 px-4 py-3 text-left font-black text-purple-950">Staff member</th>
                {dates.map((date, index) => (
                  <th key={date} scope="col" className={`sticky top-0 z-20 min-w-36 border-b border-r border-purple-100 px-3 py-3 text-left ${date === today ? "bg-purple-100" : "bg-purple-50"}`}>
                    <span className="block font-black text-purple-950">{weekdayLabels[index]}</span>
                    <span className="mt-0.5 block text-xs font-semibold text-purple-700">{format(parseISO(date), "d MMM")}</span>
                  </th>
                ))}
                <th scope="col" className="sticky top-0 z-20 w-28 border-b border-purple-100 bg-purple-50 px-3 py-3 text-left font-black text-purple-950">Weekly hours</th>
              </tr>
            </thead>
            <tbody>
              {activeStaff.map((person) => {
                const weekly = data.shifts
                  .filter((shift) => shift.staffId === person.id && dates.includes(shift.shiftDate))
                  .reduce((sum, shift) => sum + scheduledMinutes(shift).minutes, 0);
                const hasUnknown = data.shifts.some((shift) => shift.staffId === person.id && dates.includes(shift.shiftDate) && shift.breakUnspecified);
                return (
                  <tr key={person.id}>
                    <th scope="row" className="sticky left-0 z-10 border-b border-r border-purple-100 bg-white px-4 py-3 text-left align-top">
                      <span className="block font-black text-purple-950">{person.fullName}</span>
                      <span className="mt-1 block text-xs font-semibold text-slate-500">{person.employmentRole}</span>
                    </th>
                    {dates.map((date) => {
                      const shifts = shiftsFor(person.id, date);
                      return (
                        <td key={date} className={`border-b border-r border-purple-100 p-2 align-top ${date === today ? "bg-purple-50/60" : "bg-white"}`}>
                          <div className="grid gap-2">
                            {shifts.map((shift) => (
                              <ShiftCellButton key={shift.id} shift={shift} data={data} onEdit={() => setEditor({ staff: person, date, shift })} />
                            ))}
                            <button
                              type="button"
                              onClick={() => setEditor({ staff: person, date })}
                              disabled={staffMayBeginWorkOn(person, date) === false}
                              className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-purple-200 px-3 text-sm font-bold text-purple-700 hover:border-purple-500 hover:bg-purple-50 disabled:cursor-not-allowed disabled:border-red-200 disabled:bg-red-50 disabled:text-red-700 ${shifts.length ? "opacity-70" : ""}`}
                              aria-label={`Add shift for ${person.fullName} on ${format(parseISO(date), "EEEE d MMMM")}`}
                            >
                              {staffMayBeginWorkOn(person, date) === false ? <><AlertTriangle className="h-4 w-4" /> Cannot schedule</> : <><Plus className="h-4 w-4" /> Add shift</>}
                            </button>
                          </div>
                        </td>
                      );
                    })}
                    <td className="border-b border-purple-100 px-3 py-3 align-top">
                      <p className="text-base font-black text-purple-950">{formatScheduledHours(weekly)}</p>
                      {hasUnknown ? <p className="mt-1 text-xs font-bold text-amber-800">Break total incomplete</p> : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="md:hidden">
          <div className="border-b border-purple-100 bg-white p-3">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-purple-50 p-1" role="group" aria-label="Choose mobile rota view">
              <button type="button" className={`min-h-11 rounded-lg px-3 text-sm font-black ${mobileView === "day" ? "bg-white text-purple-950 shadow-sm" : "text-purple-700"}`} aria-pressed={mobileView === "day"} onClick={() => setMobileView("day")}>Day</button>
              <button type="button" className={`min-h-11 rounded-lg px-3 text-sm font-black ${mobileView === "staff" ? "bg-white text-purple-950 shadow-sm" : "text-purple-700"}`} aria-pressed={mobileView === "staff"} onClick={() => setMobileView("staff")}>Staff</button>
            </div>
            <p className="mt-2 text-center text-xs text-slate-600">Day shows who is working. Staff shows one person&apos;s week.</p>
          </div>
          {mobileView === "day" ? <>
          <div className="flex items-center justify-between border-b border-purple-100 bg-purple-50 px-3 py-3">
            <Button type="button" variant="secondary" aria-label="Previous day" onClick={() => setSelectedDay((day) => Math.max(0, day - 1))} disabled={selectedDay === 0}>
              <ChevronLeft className="h-5 w-5" />
            </Button>
            <div className="text-center">
              <p className="font-black text-purple-950">{weekdayLabels[selectedDay]}</p>
              <p className="text-sm font-semibold text-purple-700">{format(parseISO(dates[selectedDay]), "d MMMM")}</p>
            </div>
            <Button type="button" variant="secondary" aria-label="Next day" onClick={() => setSelectedDay((day) => Math.min(dates.length - 1, day + 1))} disabled={selectedDay === dates.length - 1}>
              <ChevronRight className="h-5 w-5" />
            </Button>
          </div>
          {(() => {
            const coverage = dayCoverage(dates[selectedDay], data.shifts, data.leave);
            return (
              <div className="grid grid-cols-2 gap-px border-b border-purple-100 bg-purple-100 text-sm">
                <div className="bg-white p-3"><span className="font-black text-purple-950">{coverage.staffCount} staff</span><span className="block text-xs text-slate-500">{coverage.shiftCount} shifts</span></div>
                <div className="bg-white p-3"><span className="font-black text-purple-950">{coverage.earliestStart ?? "—"} to {coverage.latestFinish ?? "—"}</span><span className="block text-xs text-slate-500">Earliest to latest</span></div>
                <div className="bg-white p-3"><span className="font-black text-purple-950">{formatScheduledHours(coverage.minutes)}</span><span className="block text-xs text-slate-500">Staffed hours</span></div>
                <div className="bg-white p-3"><span className={`font-black ${coverage.conflicts ? "text-red-700" : "text-purple-950"}`}>{coverage.conflicts} conflicts</span><span className="block text-xs text-slate-500">{coverage.approvedLeaveCount} on approved leave</span></div>
              </div>
            );
          })()}
          <div className="divide-y divide-purple-100">
            {activeStaff.map((person) => {
              const date = dates[selectedDay];
              const shifts = shiftsFor(person.id, date);
              return (
                <div key={person.id} className="p-4">
                  <div className="mb-3">
                    <p className="font-black text-purple-950">{person.fullName}</p>
                    <p className="text-sm text-slate-500">{person.employmentRole}</p>
                  </div>
                  <div className="grid gap-2">
                    {shifts.map((shift) => <ShiftCellButton key={shift.id} shift={shift} data={data} onEdit={() => setEditor({ staff: person, date, shift })} />)}
                    {!shifts.length ? <p className="text-sm text-slate-500">No shift scheduled</p> : null}
                    <Button type="button" variant="secondary" className="w-full" disabled={staffMayBeginWorkOn(person, date) === false} onClick={() => setEditor({ staff: person, date })}>
                      {staffMayBeginWorkOn(person, date) === false ? <><AlertTriangle className="h-4 w-4" /> Cannot schedule</> : <><Plus className="h-4 w-4" /> Add shift</>}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
          </> : selectedStaff ? <div className="p-4">
            <label className="grid gap-1 text-sm font-bold text-purple-950">Staff member<select className={inputClassName("min-h-12 text-base")} value={selectedStaff.id} onChange={(event) => setSelectedStaffId(event.target.value)}>{activeStaff.map((person) => <option key={person.id} value={person.id}>{person.fullName}</option>)}</select></label>
            <div className="mt-4 space-y-3">{dates.map((date) => {
              const shifts = shiftsFor(selectedStaff.id, date);
              const mayWork = staffMayBeginWorkOn(selectedStaff, date);
              return <article key={date} className="rounded-xl border border-purple-100 p-4"><div className="flex items-start justify-between gap-3"><div><p className="font-black text-purple-950">{format(parseISO(date), "EEEE")}</p><p className="text-sm text-slate-600">{format(parseISO(date), "d MMMM yyyy")}</p></div>{mayWork === false ? <StatusPill tone="red">Cannot work</StatusPill> : null}</div>{mayWork === false ? <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-900">Recruitment requirements are not effective for this date.</p> : null}<div className="mt-3 grid gap-2">{shifts.map((shift) => <ShiftCellButton key={shift.id} shift={shift} data={data} onEdit={() => setEditor({ staff: selectedStaff, date, shift })} />)}{!shifts.length ? <p className="text-sm text-slate-500">No shift scheduled</p> : null}<Button type="button" variant="secondary" className="w-full" disabled={mayWork === false} onClick={() => setEditor({ staff: selectedStaff, date })}>{mayWork === false ? <><AlertTriangle className="h-4 w-4" /> Cannot schedule</> : <><Plus className="h-4 w-4" /> Add shift</>}</Button></div></article>;
            })}</div>
          </div> : <div className="p-4"><p className="text-sm text-slate-600">No active staff are available for this site.</p></div>}
        </div>
      </section>
      {editor ? <ShiftEditorDrawer data={data} editor={editor} onClose={() => setEditor(null)} /> : null}
    </>
  );
}
