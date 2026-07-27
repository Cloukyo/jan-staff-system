import Link from "next/link";
import { addDays, addWeeks, format, parseISO } from "date-fns";
import {
  Archive,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Copy,
  Ellipsis,
  Send,
} from "lucide-react";
import { ManagerHelpLink } from "@/components/help/manager-help-link";
import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import { ProductionRotaGrid } from "@/components/rota/production-rota-grid";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { RotaExportControls } from "@/components/rota/rota-export-controls";
import { TemplateRotaControls } from "@/components/rota/template-rota-controls";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import { formatDateUk, isoDate } from "@/lib/dates/format";
import {
  clearRotaDayAction,
  copyPreviousRotaWeekAction,
  copyRotaDayAction,
  createRotaWeekAction,
  setRotaWeekStatusAction,
} from "@/lib/rota/actions";
import type { RotaTemplate, RotaTemplateApplyMode, TemplateApplicationPreview } from "@/lib/rota/template-types";
import type { ProductionRotaDataset } from "@/lib/rota/types";

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

export function ProductionRota({
  data,
  templates,
  templatePreview,
  selectedTemplateId,
  selectedTemplateMode,
  templateRequestKey,
}: {
  data: ProductionRotaDataset;
  templates: RotaTemplate[];
  templatePreview: TemplateApplicationPreview | null;
  selectedTemplateId?: string;
  selectedTemplateMode: RotaTemplateApplyMode;
  templateRequestKey: string;
}) {
  const start = parseISO(data.weekStart);
  const dates = Array.from({ length: 7 }, (_, index) => isoDate(addDays(start, index)));
  const previousWeek = isoDate(addWeeks(start, -1));
  const nextWeek = isoDate(addWeeks(start, 1));
  const activeStaffCount = data.staff.filter((person) => person.active).length;
  const rotaPageNav = [
    { id: "weekly", label: "Weekly rota", href: "#weekly-rota" },
    { id: "copy", label: "Copy tools", href: "#copy-tools" },
    { id: "templates", label: "Templates", href: "#apply-template" },
    { id: "download", label: "Download", href: "#download" },
  ];

  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-purple-950">Weekly rota</h1>
          <p className="mt-2 text-slate-600">Compare each employee&apos;s week and daily nursery coverage in one schedule.</p>
          <ManagerHelpLink taskId="edit-rota" />
        </div>
        {data.week ? <StatusPill tone={data.week.status === "published" ? "green" : "amber"}>{data.week.status}</StatusPill> : null}
      </div>

      <ManagerPageNav items={rotaPageNav} activeId="weekly" label="Rota sections" />

      <div id="weekly-rota" className="scroll-mt-32 pt-5">
      <Panel className="mb-5 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-purple-200 bg-white px-3 text-purple-900 hover:bg-purple-50" href={`/rota?week=${previousWeek}`} aria-label="Previous week">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900 hover:bg-purple-50" href="/rota">This week</Link>
          <Link className="inline-flex min-h-11 items-center justify-center rounded-xl border border-purple-200 bg-white px-3 text-purple-900 hover:bg-purple-50" href={`/rota?week=${nextWeek}`} aria-label="Next week">
            <ChevronRight className="h-5 w-5" />
          </Link>
          <form className="flex flex-wrap items-end gap-2">
            <Field label="Go to week">
              <input className={inputClassName("w-40")} name="week" type="date" defaultValue={data.weekStart} />
            </Field>
            <button className="min-h-11 rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900 hover:bg-purple-50" type="submit">Go</button>
          </form>
          <p className="mr-auto min-w-48 px-2 text-sm font-black text-purple-950">Week commencing {formatDateUk(data.weekStart)}</p>

          {data.week ? (
            <>
              {data.week.status === "draft" ? (
                <RotaActionForm action={setRotaWeekStatusAction} submitLabel="Publish rota" className="inline-flex" confirmMessage="Publish this rota for staff viewing?">
                  {hidden("weekId", data.week.id)}{hidden("status", "published")}
                </RotaActionForm>
              ) : null}
              <details className="relative">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900 hover:bg-purple-50">
                  <Ellipsis className="h-4 w-4" /> More actions
                </summary>
                <div className="absolute right-0 z-40 mt-2 w-80 rounded-2xl border border-purple-100 bg-white p-4 shadow-xl">
                  {data.week.status === "published" ? (
                    <>
                      <RotaActionForm action={setRotaWeekStatusAction} submitLabel="Return to draft" variant="secondary" className="grid" confirmMessage="Return this published rota to draft?">
                        {hidden("weekId", data.week.id)}{hidden("status", "draft")}
                      </RotaActionForm>
                      <div className="my-4 border-t border-purple-100" />
                    </>
                  ) : null}
                  <RotaActionForm action={clearRotaDayAction} submitLabel="Clear day" variant="danger" className="grid gap-3" confirmMessage="Archive every draft shift on this day?">
                    {hidden("weekId", data.week.id)}
                    <Field label="Day to clear"><select className={inputClassName()} name="shiftDate">{dates.map((date) => <option key={date} value={date}>{format(parseISO(date), "EEEE d MMMM")}</option>)}</select></Field>
                  </RotaActionForm>
                  <div className="my-4 border-t border-purple-100" />
                  <RotaActionForm action={setRotaWeekStatusAction} submitLabel="Archive week" variant="danger" className="grid" confirmMessage="Archive this rota week?">
                    {hidden("weekId", data.week.id)}{hidden("status", "archived")}
                  </RotaActionForm>
                </div>
              </details>
            </>
          ) : null}
        </div>
      </Panel>
      </div>

      {!data.week ? (
        <Panel>
          <EmptyState title="No rota for this week" body={`${activeStaffCount} active staff profiles are available. Create a draft to start scheduling.`} />
          <RotaActionForm action={createRotaWeekAction} submitLabel="Create draft rota" className="mt-5 grid gap-4">
            {hidden("weekStart", data.weekStart)}
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Title"><input className={inputClassName()} name="title" placeholder="Optional" /></Field>
              <Field label="Notes"><input className={inputClassName()} name="notes" placeholder="Optional manager note" /></Field>
            </div>
          </RotaActionForm>
          <RotaActionForm action={copyPreviousRotaWeekAction} submitLabel="Copy previous week" variant="secondary" className="mt-4">
            {hidden("weekStart", data.weekStart)}
          </RotaActionForm>
        </Panel>
      ) : (
        <>
          <ProductionRotaGrid data={data} />
          <div id="copy-tools" className="scroll-mt-32 pt-5">
            <Panel>
              <div className="flex items-start gap-3">
                <Copy className="mt-0.5 h-5 w-5 text-purple-700" aria-hidden />
                <div>
                  <h2 className="text-lg font-black text-purple-950">Copy tools</h2>
                  <p className="mt-1 text-sm text-slate-600">Reuse a previous week or copy one day within this week.</p>
                </div>
              </div>
              <div className="mt-4 grid gap-5 lg:grid-cols-2">
                <RotaActionForm action={copyPreviousRotaWeekAction} submitLabel="Copy previous week" variant="secondary" className="grid content-start">
                  {hidden("weekStart", data.weekStart)}
                </RotaActionForm>
                <RotaActionForm action={copyRotaDayAction} submitLabel="Copy day" variant="secondary" className="grid gap-3">
                  {hidden("weekId", data.week.id)}
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="Source"><select className={inputClassName()} name="sourceDate">{dates.map((date) => <option key={date} value={date}>{format(parseISO(date), "EEE d MMM")}</option>)}</select></Field>
                    <Field label="Target"><select className={inputClassName()} name="targetDate" defaultValue={dates[1]}>{dates.map((date) => <option key={date} value={date}>{format(parseISO(date), "EEE d MMM")}</option>)}</select></Field>
                  </div>
                </RotaActionForm>
              </div>
            </Panel>
          </div>
          <div id="apply-template" className="scroll-mt-32 pt-5">
            <TemplateRotaControls
              data={data}
              templates={templates}
              preview={templatePreview}
              selectedTemplateId={selectedTemplateId}
              selectedMode={selectedTemplateMode}
              requestKey={templateRequestKey}
            />
          </div>
          <div id="download" className="scroll-mt-32 pt-5">
            <Panel>
              <h2 className="text-lg font-black text-purple-950">Download</h2>
              <p className="mt-1 text-sm text-slate-600">Download this rota as an Excel workbook.</p>
              <div className="mt-4">
                <RotaExportControls weekStart={data.weekStart} />
              </div>
            </Panel>
          </div>
        </>
      )}

      <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <Archive className="h-4 w-4" /> Archived shifts remain in the audit history.
        <Copy className="ml-2 h-4 w-4" /> Copy actions skip identical shifts.
        <CalendarDays className="ml-2 h-4 w-4" /> Weekends are hidden by default.
        <Send className="ml-2 h-4 w-4" /> Publishing controls staff access.
      </p>
    </>
  );
}
