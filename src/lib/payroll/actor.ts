import { CommercialIdentityError } from "@/lib/commercial-identity/errors";

export type PayrollActor<CommercialContext, JanLegacyAccount> =
  | { kind: "commercial"; context: CommercialContext }
  | { kind: "jan_legacy"; account: JanLegacyAccount };

export async function resolvePayrollActor<CommercialContext, JanLegacyAccount>(
  dependencies: {
    loadCommercial: () => Promise<CommercialContext>;
    loadJanLegacy: () => Promise<JanLegacyAccount>;
  },
): Promise<PayrollActor<CommercialContext, JanLegacyAccount>> {
  try {
    return { kind: "commercial", context: await dependencies.loadCommercial() };
  } catch (error) {
    if (!(error instanceof CommercialIdentityError)
      || error.code !== "membership_required") {
      throw error;
    }
    return { kind: "jan_legacy", account: await dependencies.loadJanLegacy() };
  }
}
