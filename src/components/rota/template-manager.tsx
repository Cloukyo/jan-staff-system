import Link from "next/link";
import { Archive, Copy, Ellipsis, Plus } from "lucide-react";
import { RotaActionForm } from "@/components/rota/rota-action-form";
import { TemplateWeekGrid } from "@/components/rota/template-week-grid";
import { EmptyState, Field, Panel, StatusPill, inputClassName } from "@/components/ui/primitives";
import {
  archiveRotaTemplateAction,
  createRotaTemplateAction,
  duplicateRotaTemplateAction,
  updateRotaTemplateAction,
} from "@/lib/rota/template-actions";
import type { RotaTemplateDataset } from "@/lib/rota/template-types";

function hidden(name: string, value: string) {
  return <input type="hidden" name={name} value={value} />;
}

export function TemplateManager({ data }: { data: RotaTemplateDataset }) {
  const selected = data.selected;
  return (
    <>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
          <h1 className="mt-1 text-3xl font-black text-purple-950">Rota templates</h1>
          <p className="mt-2 text-slate-600">Build reusable staff patterns in the same weekly view as the live rota.</p>
        </div>
        <Link className="inline-flex min-h-11 items-center rounded-xl border border-purple-200 bg-white px-4 text-sm font-bold text-purple-900 hover:bg-purple-50" href="/rota">Back to rota</Link>
      </div>

      <div className="grid gap-5 xl:grid-cols-[18rem_minmax(0,1fr)]">
        <aside className="grid content-start gap-5">
          <Panel>
            <h2 className="flex items-center gap-2 text-lg font-black text-purple-950"><Plus className="h-5 w-5" /> New template</h2>
            <RotaActionForm action={createRotaTemplateAction} submitLabel="Create blank template" className="mt-4 grid gap-3">
              <Field label="Template name"><input className={inputClassName()} name="name" required /></Field>
              <Field label="Description"><textarea className={inputClassName("min-h-20")} name="description" /></Field>
            </RotaActionForm>
          </Panel>
          <Panel>
            <h2 className="text-lg font-black text-purple-950">Templates</h2>
            <nav className="mt-3 grid gap-2" aria-label="Rota templates">
              {data.templates.map((template) => (
                <Link key={template.id} href={`/rota/templates?template=${template.id}`} className={`rounded-xl border p-3 transition ${selected?.id === template.id ? "border-purple-600 bg-purple-50" : "border-purple-100 hover:border-purple-300"}`}>
                  <div className="flex items-start justify-between gap-2"><span className="font-bold text-purple-950">{template.name}</span><StatusPill tone={template.status === "active" ? "green" : "grey"}>{template.status}</StatusPill></div>
                  <p className="mt-1 text-xs font-semibold text-slate-500">{template.sourceType.replaceAll("_", " ")}</p>
                </Link>
              ))}
              {!data.templates.length ? <EmptyState title="No templates" body="Create a blank template to begin." /> : null}
            </nav>
          </Panel>
        </aside>

        {selected ? (
          <main className="min-w-0">
            <Panel className="mb-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h2 className="text-xl font-black text-purple-950">{selected.name}</h2><p className="mt-1 text-sm text-slate-600">{selected.description || "No description"}</p></div>
                <div className="flex items-center gap-2">
                  <StatusPill tone={selected.status === "active" ? "green" : "grey"}>{selected.status}</StatusPill>
                  {selected.status === "active" ? (
                    <details className="relative">
                      <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-xl border border-purple-200 px-4 text-sm font-bold text-purple-900 hover:bg-purple-50"><Ellipsis className="h-4 w-4" /> Template actions</summary>
                      <div className="absolute right-0 z-30 mt-2 w-80 rounded-2xl border border-purple-100 bg-white p-4 shadow-xl">
                        <RotaActionForm action={duplicateRotaTemplateAction} submitLabel="Duplicate template" variant="secondary" className="grid gap-3">
                          {hidden("templateId", selected.id)}
                          <Field label="New template name"><input className={inputClassName()} name="name" defaultValue={`${selected.name} copy`} required /></Field>
                        </RotaActionForm>
                        <div className="my-4 border-t border-purple-100" />
                        <RotaActionForm action={archiveRotaTemplateAction} submitLabel="Archive template" variant="danger" confirmMessage="Archive this template? Existing rota weeks will not be changed.">
                          {hidden("templateId", selected.id)}
                        </RotaActionForm>
                      </div>
                    </details>
                  ) : null}
                </div>
              </div>
              {selected.status === "active" ? (
                <RotaActionForm action={updateRotaTemplateAction} submitLabel="Save template details" className="mt-4 grid gap-3 lg:grid-cols-[1fr_2fr_auto] lg:items-end">
                  {hidden("templateId", selected.id)}
                  <Field label="Name"><input className={inputClassName()} name="name" defaultValue={selected.name} required /></Field>
                  <Field label="Description"><input className={inputClassName()} name="description" defaultValue={selected.description ?? ""} /></Field>
                </RotaActionForm>
              ) : <p className="mt-4 rounded-xl bg-slate-50 p-3 text-sm font-bold text-slate-600">Archived templates remain available for audit history and cannot be edited or applied.</p>}
            </Panel>
            {selected.status === "active" ? <TemplateWeekGrid data={data} /> : null}
          </main>
        ) : null}
      </div>
      <p className="mt-5 flex flex-wrap items-center gap-2 text-sm text-slate-500"><Archive className="h-4 w-4" /> Archiving never alters an existing rota week. <Copy className="ml-2 h-4 w-4" /> Duplicated templates are independent copies.</p>
    </>
  );
}
