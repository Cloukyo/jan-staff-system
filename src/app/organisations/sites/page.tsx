import Link from "next/link";
import { redirect } from "next/navigation";
import { BrandMark } from "@/components/ui/brand";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";
import { selectCommercialSite } from "@/lib/commercial-identity/actions";
import { CommercialIdentityError } from "@/lib/commercial-identity/errors";
import { safeCommercialContinuation } from "@/lib/commercial-identity/preference";
import { requireCommercialIdentity } from "@/lib/commercial-identity/server";
import { readCommercialPreference } from "@/lib/commercial-identity/session";
import { resolveSelectionMembership } from "@/lib/commercial-identity/site-navigation";
import { loadAuthorisedSiteOptions } from "@/lib/commercial-identity/site-options";

export const dynamic = "force-dynamic";

export default async function SiteSelectionPage({ searchParams }: { searchParams: Promise<{ next?: string; reason?: string }> }) {
  const params = await searchParams;
  const continuation = safeCommercialContinuation(params.next);
  let context;
  let preference;
  try {
    const identity = await requireCommercialIdentity();
    preference = await readCommercialPreference();
    context = resolveSelectionMembership(identity, preference?.membershipId ?? "");
  } catch (error) {
    if (!(error instanceof CommercialIdentityError)) throw error;
    if (error.code === "not_authenticated") redirect("/login");
    redirect(`/organisations/select?next=${encodeURIComponent(continuation)}`);
  }
  let sites: Array<{ id: string; name: string }> = [];
  let unavailable = false;
  try { sites = await loadAuthorisedSiteOptions(context); } catch { unavailable = true; }
  const accessChanged = params.reason === "access-changed" || preference?.authorisationRevision !== context.authorisationRevision;
  return (
    <main className="grid min-h-screen place-items-center bg-lavender px-4 py-10">
      <Panel className="w-full max-w-xl">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-black text-purple-950">Choose a site</h1>
        <p className="mt-2 break-words text-lg font-bold text-purple-950">{context.organisationDisplayName}</p>
        <p className="mt-2 text-sm leading-6 text-slate-600">Choose where you want to work. Only sites you currently have access to are shown.</p>
        {accessChanged ? <p role="status" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">Your site access has changed. Please choose again.</p> : null}
        {unavailable ? <div className="mt-6"><EmptyState title="Sites could not be loaded" body="Your access could not be checked. Please reload this page to try again." /></div>
          : sites.length === 0 ? <div className="mt-6"><EmptyState title="No accessible sites" body="Ask your organisation administrator to give you site access. You cannot open Home until a site is available." /></div>
          : <form action={selectCommercialSite} className="mt-6 grid gap-4">
            <input type="hidden" name="membershipId" value={context.membershipId} />
            <input type="hidden" name="authorisationRevision" value={context.authorisationRevision} />
            <input type="hidden" name="continuation" value={continuation} />
            <fieldset className="grid gap-3">
              <legend className="mb-2 text-sm font-bold text-purple-950">Available sites</legend>
              {sites.map((site) => <label key={site.id} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-purple-200 p-4 text-base font-bold text-purple-950 hover:bg-purple-50">
                <input required type="radio" name="siteId" value={site.id} defaultChecked={sites.length === 1} className="h-5 w-5 shrink-0" />
                <span className="break-words">{site.name}</span>
              </label>)}
            </fieldset>
            <Button type="submit" className="w-full">Continue</Button>
          </form>}
        <Link className="mt-6 inline-flex min-h-11 items-center text-sm font-semibold text-purple-800 underline" href={`/organisations/select?next=${encodeURIComponent(continuation)}`}>Choose another organisation</Link>
      </Panel>
    </main>
  );
}
