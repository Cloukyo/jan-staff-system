import { Button } from "@/components/ui/primitives";

export function Pagination({
  page,
  pageCount,
  total,
  onPrevious,
  onNext,
}: {
  page: number;
  pageCount: number;
  total: number;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-4 flex items-center justify-between gap-3">
      <Button variant="secondary" aria-label="Previous page" disabled={page <= 1} onClick={onPrevious}>Previous</Button>
      <p className="text-sm font-bold text-purple-950">Page {page} of {pageCount}. {total} matching records.</p>
      <Button variant="secondary" aria-label="Next page" disabled={page >= pageCount} onClick={onNext}>Next</Button>
    </div>
  );
}
