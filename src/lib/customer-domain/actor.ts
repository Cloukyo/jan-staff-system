import { CommercialIdentityError } from "@/lib/commercial-identity/errors";

export type CustomerDomainActor<CommercialContext, LegacyAccount> =
  | { kind: "commercial"; context: CommercialContext }
  | { kind: "legacy"; account: LegacyAccount };

export async function resolveCustomerDomainActor<CommercialContext, LegacyAccount>(dependencies: {
  loadCommercial: () => Promise<CommercialContext>;
  loadLegacyManager: () => Promise<LegacyAccount>;
}): Promise<CustomerDomainActor<CommercialContext, LegacyAccount>> {
  try {
    return { kind: "commercial", context: await dependencies.loadCommercial() };
  } catch (error) {
    if (!(error instanceof CommercialIdentityError) || error.code !== "membership_required") throw error;
    return { kind: "legacy", account: await dependencies.loadLegacyManager() };
  }
}
