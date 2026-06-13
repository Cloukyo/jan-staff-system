import { AppShell } from "@/components/layout/app-shell";
import { PayrollReviewScreen } from "@/components/payroll/payroll-review-screen";
import { requireAccount } from "@/lib/auth/permissions";
import { loadPayrollReview } from "@/lib/payroll/review";

export const dynamic = "force-dynamic";

export default async function PayrollReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccount(["manager"]);
  const params = await searchParams;
  const batchId = typeof params.batch === "string" ? params.batch : undefined;
  const review = await loadPayrollReview(batchId);
  return (
    <AppShell>
      <div className="mb-6">
        <p className="text-sm font-bold text-green-700">Production data | Manager only</p>
        <h1 className="mt-1 text-3xl font-black text-purple-950">Payroll import review</h1>
        <p className="mt-2 text-slate-600">Resolve private workbook rows before approving any effective-dated pay arrangements.</p>
      </div>
      <PayrollReviewScreen
        batches={review.batches}
        batch={review.batch}
        rows={review.rows}
        profiles={review.profiles}
        summary={review.validation?.summary ?? null}
        warningsByRow={review.validation?.warningsByRow ?? {}}
      />
    </AppShell>
  );
}
