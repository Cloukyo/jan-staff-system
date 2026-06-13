import Link from "next/link";
import type { AppRole } from "@/types";

export function LeaveNavigation({ role, current }: { role: AppRole; current: "mine" | "request" | "manage" }) {
  const links = role === "manager"
    ? [
        { href: "/leave/requests", label: "Review requests", key: "manage" },
        { href: "/leave", label: "My requests", key: "mine" },
        { href: "/leave/request", label: "Request leave", key: "request" },
        { href: "/rota", label: "Rota conflicts", key: "conflicts" },
      ]
    : [
        { href: "/leave", label: "My requests", key: "mine" },
        { href: "/leave/request", label: "Request leave", key: "request" },
      ];

  return (
    <nav className="flex flex-wrap gap-2" aria-label="Leave">
      {links.map((link) => (
        <Link
          key={link.key}
          href={link.href}
          aria-current={link.key === current ? "page" : undefined}
          className={`inline-flex min-h-11 items-center rounded-xl px-4 text-sm font-bold ${
            link.key === current ? "bg-purple-700 text-white" : "bg-white text-purple-900 ring-1 ring-purple-200"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
