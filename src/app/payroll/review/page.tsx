import { AppShell } from "@/components/layout/app-shell";
import { ManagerPageNav } from "@/components/layout/manager-page-nav";
import { PayrollReviewScreen } from "@/components/payroll/payroll-review-screen";
import { requireAccount } from "@/lib/auth/permissions";
import { loadPayrollReview } from "@/lib/payroll/review";

export const dynamic = "force-dynamic";

const payPageNav = [
  { id: "export", label: "Export pay hours", href: "/payroll" },
  { id: "import", label: "Import pay details", href: "/payroll/review" },
  { id: "details", label: "Pay details", href: "/payroll/arrangements" },
];

export default async function PayrollReviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAccount(["manager"]);
  const params = await searchParams;
  const batchId = typeof params.batch === "string" ? params.batch : undefined;
  const review = await loadPayrollReview(batchId);
  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="text-3xl font-black text-purple-950">Import pay details</h1>
        <p className="mt-2 text-slate-600">
          Advanced manager tool for checking a private workbook before adding dated pay details.
        </p>
      </div>
      <ManagerPageNav items={payPageNav} activeId="import" label="Pay hours sections" />
      <div className="pt-5">
        <PayrollReviewScreen
          batches={review.batches}
          batch={review.batch}
          rows={review.rows}
          profiles={review.profiles}
          summary={review.validation?.summary ?? null}
          warningsByRow={review.validation?.warningsByRow ?? {}}
        />
      </div>
    </AppShell>
  );
}
