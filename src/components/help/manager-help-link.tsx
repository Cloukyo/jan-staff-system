import Link from "next/link";
import { CircleHelp } from "lucide-react";

export function ManagerHelpLink({ taskId }: { taskId: string }) {
  return (
    <Link
      href={`/help#${taskId}`}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-sm font-semibold text-purple-800 underline decoration-purple-300 underline-offset-4 hover:text-purple-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-purple-700"
    >
      <CircleHelp aria-hidden className="h-4 w-4 shrink-0" />
      Help with this task
    </Link>
  );
}
