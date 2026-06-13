import Link from "next/link";
import { EmptyState, Panel, StatusPill } from "@/components/ui/primitives";
import type { ProductionProfile } from "@/lib/profile/server";
import { formatDateUk } from "@/lib/dates/format";

export function ProductionProfileScreen({ data }: { data: ProductionProfile }) {
  return (
    <div className="grid gap-5">
      <div>
        <p className="text-sm font-bold text-green-700">Production data | Supabase</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">My profile</h1>
        <p className="mt-2 text-slate-600">Your account and limited staff record summary.</p>
      </div>
      <Panel>
        <dl className="grid gap-4 sm:grid-cols-2">
          <div><dt className="text-sm font-bold text-slate-500">Name</dt><dd className="mt-1 font-black text-purple-950">{data.profile.fullName}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Email</dt><dd className="mt-1 font-black text-purple-950">{data.account.email}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Nursery role</dt><dd className="mt-1 font-black text-purple-950">{data.profile.employmentRole}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">System role</dt><dd className="mt-1 capitalize font-black text-purple-950">{data.account.role}</dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Account</dt><dd className="mt-1"><StatusPill tone={data.account.active ? "green" : "grey"}>{data.account.active ? "Active" : "Inactive"}</StatusPill></dd></div>
          <div><dt className="text-sm font-bold text-slate-500">Staff profile</dt><dd className="mt-1"><StatusPill tone={data.profile.active ? "green" : "grey"}>{data.profile.active ? "Active" : "Inactive"}</StatusPill></dd></div>
        </dl>
        <div className="mt-5 flex flex-wrap gap-3">
          <Link className="inline-flex min-h-11 items-center rounded-xl bg-purple-700 px-4 text-sm font-bold text-white" href="/leave">My leave</Link>
          <Link className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href="/leave/request">Request leave</Link>
          <Link className="inline-flex min-h-11 items-center rounded-xl bg-white px-4 text-sm font-bold text-purple-900 ring-1 ring-purple-200" href="/change-password">Change password</Link>
        </div>
      </Panel>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Qualifications</h2>
          <div className="mt-4 grid gap-3">
            {data.qualifications.length ? data.qualifications.map((item) => <div key={item.id}><p className="font-bold text-purple-950">{item.qualificationName}</p><p className="text-sm text-slate-600">{item.qualificationLevel ?? "Level not recorded"}</p></div>) : <EmptyState title="No qualifications listed" body="A manager can update qualification records." />}
          </div>
        </Panel>
        <Panel>
          <h2 className="text-xl font-black text-purple-950">Training and certificates</h2>
          <div className="mt-4 grid gap-3">
            {data.certificates.length ? data.certificates.map((item) => <div key={item.id}><p className="font-bold text-purple-950">{item.customTitle || item.certificateType}</p><p className="text-sm text-slate-600">{item.expiryDate ? `Expires ${formatDateUk(item.expiryDate)}` : "No expiry recorded"}</p></div>) : <EmptyState title="No certificates listed" body="A manager can update training records." />}
          </div>
        </Panel>
      </div>
    </div>
  );
}
