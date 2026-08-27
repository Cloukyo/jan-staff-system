import { BrandMark } from "@/components/ui/brand";
import { Button, EmptyState, Panel } from "@/components/ui/primitives";
import { selectCommercialOrganisation } from "@/lib/commercial-identity/actions";
import type { CommercialMembershipSummary } from "@/types/tenancy";

export function OrganisationSelector({
  memberships,
  continuation,
  stalePreference = false,
}: {
  memberships: CommercialMembershipSummary[];
  continuation: string;
  stalePreference?: boolean;
}) {
  const active = memberships.filter((membership) => membership.active && membership.status === "active");
  return (
    <main className="grid min-h-screen place-items-center bg-lavender px-4 py-10">
      <Panel className="w-full max-w-xl">
        <BrandMark />
        <h1 className="mt-8 text-3xl font-black text-purple-950">Choose an organisation</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Select the organisation you want to work in. Access is checked again whenever you continue.</p>
        {stalePreference ? <p className="mt-4 rounded-xl bg-amber-50 p-3 text-sm font-semibold text-amber-900">Your previous organisation access has changed. Please choose again.</p> : null}
        {active.length === 0 ? (
          <div className="mt-6"><EmptyState title="No organisation access" body="Ask an organisation administrator if you believe you should have access." /></div>
        ) : (
          <form action={selectCommercialOrganisation} className="mt-6 grid gap-4">
            <input type="hidden" name="continuation" value={continuation} />
            <fieldset className="grid gap-3">
              <legend className="text-sm font-bold text-purple-950">Available organisations</legend>
              {active.map((membership) => (
                <label key={membership.membershipId} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-purple-200 p-4 text-base font-bold text-purple-950 hover:bg-purple-50">
                  <input required type="radio" name="membershipId" value={membership.membershipId} className="h-5 w-5" />
                  {membership.organisationDisplayName}
                </label>
              ))}
            </fieldset>
            <Button type="submit" className="w-full">Continue</Button>
          </form>
        )}
      </Panel>
    </main>
  );
}
