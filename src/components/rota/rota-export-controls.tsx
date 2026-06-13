import { Download } from "lucide-react";
import { Field, inputClassName } from "@/components/ui/primitives";

export function RotaExportControls({ weekStart }: { weekStart: string }) {
  return (
    <details className="relative">
      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900 hover:bg-purple-50">
        <Download className="h-4 w-4" /> Export Excel
      </summary>
      <form action="/rota/export" method="get" className="absolute right-0 z-40 mt-2 grid w-[22rem] gap-3 rounded-2xl border border-purple-100 bg-white p-4 shadow-xl">
        <input type="hidden" name="week" value={weekStart} />
        <Field label="Workbook format">
          <select className={inputClassName()} name="format" defaultValue="compact">
            <option value="compact">Compact rota</option>
            <option value="detailed">Detailed rota</option>
          </select>
        </Field>
        <div className="grid grid-cols-2 gap-2 text-sm font-semibold text-purple-950">
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="breaks" value="1" /> Breaks</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="weekends" value="1" /> Weekends</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="rooms" value="1" /> Rooms</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="roles" value="1" /> Roles</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="warnings" value="1" defaultChecked /> Warnings</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" name="archived" value="1" /> Cancelled or archived</label>
        </div>
        <button className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" type="submit">
          <Download className="h-4 w-4" /> Download workbook
        </button>
      </form>
    </details>
  );
}
