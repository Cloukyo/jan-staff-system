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
import {
  dayCoverage,
  formatScheduledHours,
  laterWeekDates,
  previousDayShifts,
  scheduledMinutes,
  shiftWarningSummary,
} from "@/lib/rota/grid";
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
  const previousDate = format(addDays(parseISO(editor.date), -1), "yyyy-MM-dd");
  const previousShifts = previousDayShifts(editor.staff.id, editor.date, data.shifts);
  const laterDates = shift ? laterWeekDates(data.weekStart, editor.date) : [];
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
              <p className="mt-1 text-sm text-slate-600">Copies start, finish and break only. Room, role and notes stay separate.</p>
            </div>
          </div>

          <RotaActionForm
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
          </RotaActionForm>

          {shift && shift.status !== "cancelled" && laterDates.length ? (
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
        >
          {hidden("rotaWeekId", data.week?.id ?? "")}
          {shift ? hidden("shiftId", shift.id) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Staff member">
              <select className={inputClassName()} name="staffId" defaultValue={editor.staff.id} required>
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
                defaultValue={editor.date}
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
            <Field label="Room or area">
              <input className={inputClassName()} name="roomOrArea" list="rota-rooms" defaultValue={shift?.roomOrArea ?? ""} />
            </Field>
            <Field label="Role on shift">
              <input className={inputClassName()} name="roleOnShift" defaultValue={shift?.roleOnShift ?? ""} />
            </Field>
          </div>
          <Field label="Notes">
            <textarea className={inputClassName("min-h-24")} name="notes" defaultValue={shift?.notes ?? ""} />
          </Field>
          <Field label="Leave override reason">
            <textarea className={inputClassName("min-h-20")} name="leaveOverrideReason" defaultValue={shift?.leaveOverrideReason ?? ""} />
          </Field>
          <Field label="Overlap override reason">
            <textarea className={inputClassName("min-h-20")} name="overlapOverrideReason" defaultValue={shift?.overlapOverrideReason ?? ""} />
          </Field>
          <Field label="Inactive staff override reason">
            <textarea className={inputClassName("min-h-20")} name="inactiveStaffOverrideReason" defaultValue={shift?.inactiveStaffOverrideReason ?? ""} />
          </Field>
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
            confirmMessage="Archive this shift? It will no longer appear in the active rota."
            onSuccess={onClose}
          >
            {hidden("shiftId", shift.id)}
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
      {shift.roomOrArea || shift.roleOnShift ? (
        <span className="mt-2 block text-sm font-bold text-purple-800">{shift.roomOrArea || shift.roleOnShift}</span>
      ) : null}
      <span className="mt-2 flex items-center justify-between gap-2">
        <StatusPill tone={shift.status === "scheduled" ? "purple" : shift.status === "completed" ? "green" : "grey"}>{shift.status}</StatusPill>
        <WarningIcons shift={shift} data={data} />
      </span>
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
  const [editor, setEditor] = useState<EditorState | null>(null);
  const allDates = useMemo(
    () => Array.from({ length: 7 }, (_, index) => format(addDays(parseISO(data.weekStart), index), "yyyy-MM-dd")),
    [data.weekStart],
  );
  const dates = showWeekend ? allDates : allDates.slice(0, 5);
  const activeStaff = data.staff.filter((person) => person.active);
  const today = format(new Date(), "yyyy-MM-dd");

  const shiftsFor = (staffId: string, date: string) =>
    data.shifts.filter((shift) => shift.staffId === staffId && shift.shiftDate === date);

  return (
    <>
      <datalist id="rota-rooms">{data.settings.availableRooms.map((room) => <option key={room} value={room} />)}</datalist>
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
                              className={`flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-purple-200 px-3 text-sm font-bold text-purple-700 hover:border-purple-500 hover:bg-purple-50 ${shifts.length ? "opacity-70" : ""}`}
                              aria-label={`Add shift for ${person.fullName} on ${format(parseISO(date), "EEEE d MMMM")}`}
                            >
                              <Plus className="h-4 w-4" /> Add shift
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
                    <Button type="button" variant="secondary" className="w-full" onClick={() => setEditor({ staff: person, date })}>
                      <Plus className="h-4 w-4" /> Add shift
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>
      {editor ? <ShiftEditorDrawer data={data} editor={editor} onClose={() => setEditor(null)} /> : null}
    </>
  );
}
