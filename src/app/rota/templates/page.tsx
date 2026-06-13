import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";
import { TemplateManager } from "@/components/rota/template-manager";
import { Panel } from "@/components/ui/primitives";
import { getAppMode } from "@/lib/app-mode";
import { requireAccount } from "@/lib/auth/permissions";
import { loadRotaTemplateManager } from "@/lib/rota/template-server";

export const dynamic = "force-dynamic";

export default async function RotaTemplatesPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (getAppMode() === "demo") {
    return <AppShell><Panel><h1 className="text-3xl font-black text-purple-950">Rota templates</h1><p className="mt-2 text-slate-600">Production templates remain isolated from browser demo data.</p><Link className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 font-bold text-white" href="/rota">Back to demo rota</Link></Panel></AppShell>;
  }
  await requireAccount(["manager"]);
  const params = await searchParams;
  const selectedId = typeof params.template === "string" ? params.template : undefined;
  const data = await loadRotaTemplateManager(selectedId);
  return <AppShell><TemplateManager data={data} /></AppShell>;
}
