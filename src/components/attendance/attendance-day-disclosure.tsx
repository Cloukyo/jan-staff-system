"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { attendanceDayHref } from "@/lib/attendance/day-route";

export function AttendanceDayDisclosure({
  day,
  open,
  summary,
  children,
}: {
  day: string;
  open?: boolean;
  summary: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  return (
    <details
      className="border-b border-purple-100"
      open={open}
      onToggle={(event) => {
        if (event.target !== event.currentTarget) return;
        const href = attendanceDayHref(searchParams.toString(), day, event.currentTarget.open);
        router.replace(pathname === "/attendance" ? href : `${pathname}${href.slice("/attendance".length)}`);
      }}
    >
      {summary}
      {children}
    </details>
  );
}
